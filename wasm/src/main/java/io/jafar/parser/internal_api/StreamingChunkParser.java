package io.jafar.parser.internal_api;

import io.jafar.parser.api.ParserContext;
import io.jafar.parser.internal_api.metadata.MetadataEvent;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.BufferUnderflowException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * GraalVM Web Image-compatible replacement for jafar's {@code StreamingChunkParser}.
 *
 * <p>Why this exists: jafar's upstream eagerly constructs an {@code ExecutorService} via
 * {@code Executors.newFixedThreadPool(...)} with a thread factory that calls
 * {@code Thread.setDaemon(true)} on the freshly created thread. In GraalVM Web Image WASM,
 * threads cannot be created at all — the constructor throws
 * {@code IllegalThreadStateException} the moment the parser is instantiated, before any
 * work happens.
 *
 * <p>Approach: shadow the class on the classpath. The wasm module's compiled class lands
 * ahead of {@code jafar-parser-0.24.0.jar} on the native-image classpath, so this version
 * wins. The signature is byte-for-byte identical to upstream — same public methods, same
 * {@code AutoCloseable} interface — so jafar's internal call sites (and our
 * {@code BasicParallelImporter}) link to this version transparently.
 *
 * <p>The only behavioral change is {@code submitParsingTask}: rather than dispatch to a
 * thread pool, we run the task synchronously on the calling thread and return a
 * pre-completed {@code Future}. JFR chunks are parsed sequentially. This is slower than
 * the upstream parallel path, but the WASM runtime is single-threaded anyway, so there's
 * no real cost — and it avoids constructing a thread pool that can't run.
 */
public final class StreamingChunkParser implements AutoCloseable {
  private static final Logger log = LoggerFactory.getLogger(StreamingChunkParser.class);

  private boolean closed = false;
  private final ParserContextFactory contextFactory;

  public StreamingChunkParser(ParserContextFactory contextFactory) {
    this.contextFactory = contextFactory;
  }

  public void parse(Path path, ChunkParserListener listener) throws IOException {
    if (closed) {
      throw new IOException("Parser is closed");
    }
    CompressionDetector.Format fmt = CompressionDetector.detect(path);
    if (fmt != CompressionDetector.Format.NONE) {
      throw new IOException(
          "JFR file is "
              + fmt.label
              + "-compressed and cannot be parsed directly. "
              + fmt.hint
              + " (file: "
              + path
              + ")");
    }
    try (RecordingStream stream = new RecordingStream(path, contextFactory.newContext())) {
      parse(stream, listener);
    }
  }

  public void parse(InputStream inputStream, ChunkParserListener listener) throws IOException {
    if (closed) {
      throw new IOException("Parser is closed");
    }
    try {
      listener.onRecordingStart(null);

      if (inputStream.available() == 0) {
        return;
      }

      byte[] magicBytes = new byte[4];
      for (int i = 0; i < 4; i++) {
        int b = inputStream.read();
        if (b == -1) throw new IOException("Unexpected EOF while reading JFR magic");
        magicBytes[i] = (byte) b;
      }
      int magic =
          (magicBytes[0] & 0xFF)
              | ((magicBytes[1] & 0xFF) << 8)
              | ((magicBytes[2] & 0xFF) << 16)
              | ((magicBytes[3] & 0xFF) << 24);
      if (magic != 0x00524C46) {
        throw new IOException("Invalid JFR Magic Number: 0x" + Integer.toHexString(magic));
      }

      byte[] restHeader = new byte[64];
      int read = 0;
      while (read < 64) {
        int b = inputStream.read();
        if (b == -1) throw new IOException("Unexpected EOF while reading chunk header");
        restHeader[read++] = (byte) b;
      }
      byte[] headerBytes = new byte[68];
      System.arraycopy(magicBytes, 0, headerBytes, 0, 4);
      System.arraycopy(restHeader, 0, headerBytes, 4, 64);

      RecordingStream headerStream =
          new RecordingStream(
              new BufferedRecordingStreamReader(headerBytes),
              contextFactory.newContext());
      ChunkHeader parsedHeader = new ChunkHeader(headerStream, 1);
      int headerSize = (int) headerStream.position();

      int totalSize = parsedHeader.size;
      int payloadSize = totalSize - headerSize;
      if (payloadSize < 0) {
        throw new IOException("Chunk size " + totalSize + " is smaller than header " + headerSize);
      }
      byte[] chunkData = new byte[totalSize];
      System.arraycopy(headerBytes, 0, chunkData, 0, headerSize);
      read = 0;
      while (read < payloadSize) {
        int got = inputStream.read(chunkData, headerSize + read, payloadSize - read);
        if (got == -1) break;
        read += got;
      }
      if (read < payloadSize) {
        throw new IOException("Unexpected end of stream while reading chunk");
      }

      RecordingStream chunkStream =
          new RecordingStream(
              new BufferedRecordingStreamReader(chunkData),
              contextFactory.newContext());
      processChunk(chunkStream, parsedHeader, listener, headerSize);
    } finally {
      listener.onRecordingEnd(null);
    }
  }

  private void processChunk(
      RecordingStream chunkStream,
      ChunkHeader chunkHeader,
      ChunkParserListener listener,
      long headerSize)
      throws IOException {
    int chunkCounter = chunkHeader.order;
    ParserContext chunkContext = chunkStream.getContext();
    try {
      if (chunkHeader.size <= headerSize) {
        listener.onChunkStart(chunkContext, chunkCounter, chunkHeader);
        listener.onChunkEnd(chunkContext, chunkCounter, true);
        return;
      }
      if (!listener.onChunkStart(chunkContext, chunkCounter, chunkHeader)) {
        log.debug(
            "'onChunkStart' returned false. Skipping metadata and events for chunk {}",
            chunkCounter);
        listener.onChunkEnd(chunkContext, chunkCounter, true);
        return;
      }
      if (!readMetadata(chunkStream, chunkHeader, listener, false)) {
        log.debug("'onMetadata' returned false. Skipping events for chunk {}", chunkCounter);
        listener.onChunkEnd(chunkContext, chunkCounter, true);
        return;
      }
      if (!readConstantPool(chunkStream, chunkHeader, listener)) {
        log.debug("'onCheckpoint' returned false. Skipping the rest of the chunk {}", chunkCounter);
        listener.onChunkEnd(chunkContext, chunkCounter, true);
        return;
      }
      chunkStream.position(headerSize);
      while (chunkStream.position() < chunkHeader.size) {
        long eventStartPos = chunkStream.position();
        chunkStream.mark();
        int eventSize;
        try {
          eventSize = (int) chunkStream.readVarint();
        } catch (BufferUnderflowException e) {
          log.warn(
              "Buffer underflow reading event size at position {}, stopping chunk", eventStartPos);
          break;
        }
        if (eventSize > 0) {
          if (eventStartPos + eventSize > chunkHeader.size) {
            log.warn(
                "Event size {} at position {} exceeds chunk boundary, stopping",
                eventSize,
                eventStartPos);
            break;
          }
          long eventType;
          try {
            eventType = chunkStream.readVarint();
          } catch (BufferUnderflowException e) {
            log.warn(
                "Buffer underflow reading event type at position {}, stopping chunk",
                chunkStream.position());
            break;
          }
          if (eventType > 1) {
            long currentPos = chunkStream.position();
            if (!listener.onEvent(
                chunkContext,
                eventType,
                eventStartPos,
                eventSize,
                eventSize - (currentPos - eventStartPos))) {
              log.debug(
                  "'onEvent({}, stream, {})' returned false. Skipping the rest of the chunk {}",
                  eventType,
                  eventSize - (currentPos - eventStartPos),
                  chunkCounter);
              listener.onChunkEnd(chunkContext, chunkCounter, true);
              return;
            }
          }
          chunkStream.position(eventStartPos + eventSize);
        }
      }
      listener.onChunkEnd(chunkContext, chunkCounter, false);
    } catch (IOException e) {
      throw e;
    } catch (Throwable t) {
      throw new RuntimeException(t);
    }
  }

  @Override
  public void close() throws Exception {
    if (!closed) {
      closed = true;
    }
  }

  // Synchronous: runs on the calling thread. Returns a pre-completed Future so the
  // caller-side `f.get()` loop in `parse(stream, listener)` keeps working unchanged.
  private Future<Boolean> submitParsingTask(
      ChunkHeader chunkHeader,
      RecordingStream chunkStream,
      ChunkParserListener listener,
      long headerSize) {
    try {
      processChunk(chunkStream, chunkHeader, listener, headerSize);
      return CompletableFuture.completedFuture(true);
    } catch (Throwable t) {
      CompletableFuture<Boolean> failed = new CompletableFuture<>();
      failed.completeExceptionally(t);
      return failed;
    }
  }

  private void parse(RecordingStream stream, ChunkParserListener listener) throws IOException {
    if (stream.available() == 0) {
      return;
    }
    List<Future<Boolean>> results = new ArrayList<>();
    try {
      listener.onRecordingStart(stream.getContext());
      int chunkCounter = 1;
      while (stream.available() > 0) {
        ChunkHeader header = new ChunkHeader(stream, chunkCounter);
        long headerSize = (stream.position() - header.offset);

        RecordingStream chunkStream =
            stream.slice(
                header.offset,
                header.size,
                contextFactory.newContext(stream.getContext(), chunkCounter));
        stream.position(header.offset + header.size);

        results.add(submitParsingTask(header, chunkStream, listener, headerSize));
        chunkCounter++;
      }
      results.forEach(
          f -> {
            try {
              f.get();
            } catch (Throwable t) {
              throw new RuntimeException("Failed to process chunk", t);
            }
          });
    } catch (EOFException e) {
      results.forEach(f -> f.cancel(true));
      throw new IOException("Invalid buffer encountered during parsing", e);
    } catch (Throwable t) {
      results.forEach(f -> f.cancel(true));
      throw new IOException("Error occurred while parsing JFR recording", t);
    } finally {
      listener.onRecordingEnd(stream.getContext());
    }
  }

  private boolean readMetadata(
      RecordingStream stream,
      ChunkHeader header,
      ChunkParserListener listener,
      boolean forceConstantPools)
      throws IOException {
    stream.mark();
    stream.position(header.metaOffset);
    MetadataEvent m = new MetadataEvent(stream, forceConstantPools);

    ParserContext ctx = stream.getContext();
    contextFactory.onChunkMetadata(ctx, header);

    if (!listener.onMetadata(ctx, m)) {
      return false;
    }
    ctx.onMetadataReady();
    stream.reset();
    return true;
  }

  private boolean readConstantPool(
      RecordingStream stream, ChunkHeader header, ChunkParserListener listener) throws IOException {
    return readConstantPool(stream, header.cpOffset, listener);
  }

  private boolean readConstantPool(
      RecordingStream stream, int position, ChunkParserListener listener) throws IOException {
    while (true) {
      stream.position(position);
      CheckpointEvent event = new CheckpointEvent(stream);
      event.readConstantPools();
      if (!listener.onCheckpoint(stream.getContext(), event)) {
        return false;
      }
      int delta = event.nextOffsetDelta;
      if (delta != 0) {
        position += delta;
      } else {
        break;
      }
    }
    stream.getContext().onConstantPoolsReady();
    return true;
  }
}

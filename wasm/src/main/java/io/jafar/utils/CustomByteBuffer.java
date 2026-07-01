package io.jafar.utils;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * GraalVM Web Image-compatible replacement for jafar's {@code CustomByteBuffer}.
 *
 * <p>Why this exists: jafar's upstream {@code CustomByteBuffer.map(Path)} uses
 * {@code RandomAccessFile} + {@code FileChannel.map}, which throws
 * {@code UnsupportedOperationException("RandomAccessFile.initIDs")} in GraalVM Web Image
 * because that runtime stubs the JNI bridge. We can't substitute via {@code @TargetClass}
 * because the GraalVM 25 distribution we build with no longer ships those annotations.
 *
 * <p>Approach: shadow the class on the classpath. The wasm module's compiled class lands
 * ahead of {@code jafar-parser-0.24.0.jar} on the native-image classpath, so this version
 * wins. The interface signature is byte-for-byte identical to upstream — same abstract
 * methods, same nested {@code ByteBufferWrapper} class — so all of jafar's internal call
 * sites (e.g. {@code MappedRecordingStreamReader}, {@code BufferBackedRecordingStreamReader})
 * link to this version transparently.
 *
 * <p>The only behavioral change is in {@code map(Path)}: rather than memory-map the file via
 * {@code RandomAccessFile}, we read all bytes via {@code Files.readAllBytes} (which goes
 * through {@code FileInputStream} — implemented in the Web Image VFS) and wrap them in a
 * heap {@code ByteBuffer}. This is technically slower than mmap, but JFR files we receive
 * via browser upload are already fully in memory anyway, so there's no real cost.
 *
 * <p>Limitation: we drop the {@code SplicedMappedByteBuffer} fallback used for files
 * larger than {@code Integer.MAX_VALUE}. A 2 GB+ JFR upload would need a different strategy
 * (chunked import); not supported in WASM mode today.
 */
public interface CustomByteBuffer {

    /** Holds bytes to be injected directly into map() without going through the VFS. */
    final class InlineHolder {
        public static byte[] bytes = null;
        private InlineHolder() {}
    }

    static CustomByteBuffer wrap(byte[] bytes) {
        return new ByteBufferWrapper(ByteBuffer.wrap(bytes));
    }

    static CustomByteBuffer map(Path path) throws IOException {
        return map(path, Integer.MAX_VALUE);
    }

    static CustomByteBuffer map(Path path, int spliceSize) throws IOException {
        byte[] inline = InlineHolder.bytes;
        if (inline != null) {
            InlineHolder.bytes = null;
            return new ByteBufferWrapper(ByteBuffer.wrap(inline));
        }
        long size = Files.size(path);
        if (size > spliceSize) {
            throw new IOException(
                    "WASM CustomByteBuffer can't map files larger than " + spliceSize
                            + " bytes (got " + size + ")");
        }
        byte[] bytes = Files.readAllBytes(path);
        return new ByteBufferWrapper(ByteBuffer.wrap(bytes));
    }

    CustomByteBuffer slice();

    CustomByteBuffer slice(long pos, long len);

    CustomByteBuffer order(ByteOrder bigEndian);

    ByteOrder order();

    boolean isNativeOrder();

    void position(long position);

    long position();

    long remaining();

    void get(byte[] buffer, int offset, int length);

    byte get();

    short getShort();

    int getInt();

    float getFloat();

    double getDouble();

    void mark();

    void reset();

    long getLong();

    long limit();

    byte get(long offset);

    int getInt(long offset);

    long getLong(long offset);

    void close() throws IOException;

    class ByteBufferWrapper implements CustomByteBuffer {
        private final ByteBuffer delegate;
        private final boolean nativeOrder;

        public ByteBufferWrapper(ByteBuffer delegate) {
            this.delegate = delegate;
            this.nativeOrder = delegate.order() == ByteOrder.nativeOrder();
            delegate.order(ByteOrder.nativeOrder());
        }

        @Override
        public boolean isNativeOrder() {
            return nativeOrder;
        }

        @Override
        public CustomByteBuffer slice(long pos, long len) {
            return new ByteBufferWrapper(delegate.slice((int) pos, (int) len));
        }

        @Override
        public CustomByteBuffer slice() {
            return new ByteBufferWrapper(delegate.slice());
        }

        @Override
        public CustomByteBuffer order(ByteOrder order) {
            delegate.order(order);
            return this;
        }

        @Override
        public ByteOrder order() {
            return delegate.order();
        }

        @Override
        public void position(long position) {
            delegate.position((int) position);
        }

        @Override
        public long position() {
            return delegate.position();
        }

        @Override
        public long remaining() {
            return delegate.remaining();
        }

        @Override
        public void get(byte[] buffer, int offset, int length) {
            delegate.get(buffer, offset, length);
        }

        @Override
        public byte get() {
            return delegate.get();
        }

        @Override
        public short getShort() {
            return delegate.getShort();
        }

        @Override
        public int getInt() {
            return delegate.getInt();
        }

        @Override
        public float getFloat() {
            return delegate.getFloat();
        }

        @Override
        public double getDouble() {
            return delegate.getDouble();
        }

        @Override
        public void mark() {
            delegate.mark();
        }

        @Override
        public void reset() {
            delegate.reset();
        }

        @Override
        public long getLong() {
            return delegate.getLong();
        }

        @Override
        public long limit() {
            return delegate.limit();
        }

        @Override
        public byte get(long offset) {
            return delegate.get((int) offset);
        }

        @Override
        public int getInt(long offset) {
            return delegate.getInt((int) offset);
        }

        @Override
        public long getLong(long offset) {
            return delegate.getLong((int) offset);
        }

        @Override
        public void close() throws IOException {
            // No-op: heap ByteBuffer needs no cleanup
        }
    }
}

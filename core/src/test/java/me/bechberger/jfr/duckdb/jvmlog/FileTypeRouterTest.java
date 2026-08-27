package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.*;

class FileTypeRouterTest {
    @Test void jfr() { assertThat(FileTypeRouter.detect(Path.of("recording.jfr"))).isEqualTo(FileTypeRouter.FileType.JFR); }
    @Test void cjfr() { assertThat(FileTypeRouter.detect(Path.of("recording.cjfr"))).isEqualTo(FileTypeRouter.FileType.CJFR); }
    @Test void logExtension() { assertThat(FileTypeRouter.detect(Path.of("/var/log/gc.log"))).isEqualTo(FileTypeRouter.FileType.JVMLOG); }
    @Test void txtExtension() { assertThat(FileTypeRouter.detect(Path.of("jvm.txt"))).isEqualTo(FileTypeRouter.FileType.JVMLOG); }
    @Test void duckdb() { assertThat(FileTypeRouter.detect(Path.of("data.duckdb"))).isEqualTo(FileTypeRouter.FileType.DUCKDB); }
    @Test void dbAlias() { assertThat(FileTypeRouter.detect(Path.of("data.db"))).isEqualTo(FileTypeRouter.FileType.DUCKDB); }
    @Test void unknownExtension() { assertThatThrownBy(() -> FileTypeRouter.detect(Path.of("mystery.xyz"))).isInstanceOf(IllegalArgumentException.class).hasMessageContaining(".xyz"); }
    @Test void caseInsensitive() { assertThat(FileTypeRouter.detect(Path.of("recording.JFR"))).isEqualTo(FileTypeRouter.FileType.JFR); }
}

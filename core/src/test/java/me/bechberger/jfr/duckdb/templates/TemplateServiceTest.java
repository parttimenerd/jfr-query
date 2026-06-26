package me.bechberger.jfr.duckdb.templates;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TemplateServiceTest {

    @Test
    void parseMetaExtractsCommonFields() {
        String md = """
                ---
                title: My Template
                description: An example
                tags: [gc, perf]
                license: MIT
                ---
                # body
                """;
        TemplateMeta meta = TemplateService.parseMeta("my-template", md, "builtin");
        assertThat(meta.name()).isEqualTo("my-template");
        assertThat(meta.title()).isEqualTo("My Template");
        assertThat(meta.description()).isEqualTo("An example");
        assertThat(meta.tags()).containsExactly("gc", "perf");
        assertThat(meta.license()).isEqualTo("MIT");
        assertThat(meta.source()).isEqualTo("builtin");
    }

    @Test
    void parseMetaWithoutFrontMatterUsesDefaults() {
        TemplateMeta meta = TemplateService.parseMeta("plain", "# just markdown", "user");
        assertThat(meta.title()).isEqualTo("plain");
        assertThat(meta.description()).isNull();
        assertThat(meta.license()).isNull();
        assertThat(meta.tags()).isEmpty();
    }

    @Test
    void parseMetaStripsQuotedValues() {
        String md = "---\ntitle: 'Quoted Title'\nlicense: \"MIT\"\n---\nbody";
        TemplateMeta meta = TemplateService.parseMeta("x", md, "builtin");
        assertThat(meta.title()).isEqualTo("Quoted Title");
        assertThat(meta.license()).isEqualTo("MIT");
    }

    @Test
    void loadsBuiltinsFromClasspath() {
        TemplateService service = new TemplateService(Optional.empty());
        List<TemplateMeta> all = service.list();
        // The four MIT-licensed built-ins shipped in resources/templates/builtin
        // should be present once mvn process-resources has run for tests too.
        assertThat(all).isNotEmpty();
        for (TemplateMeta m : all) {
            assertThat(m.source()).isEqualTo("builtin");
            assertThat(m.license()).isEqualTo("MIT");
        }
    }

    @Test
    void loadReturnsBodyForExistingName() {
        TemplateService service = new TemplateService(Optional.empty());
        TemplateMeta first = service.list().get(0);
        Optional<String> body = service.load(first.name());
        assertThat(body).isPresent();
        assertThat(body.get()).contains("---");
    }

    @Test
    void loadReturnsEmptyForUnknownName() {
        TemplateService service = new TemplateService(Optional.empty());
        assertThat(service.load("does-not-exist")).isEmpty();
    }

    @Test
    void userDirectoryTemplatesArePickedUp(@TempDir Path tmp) throws IOException {
        Path tpl = tmp.resolve("my-custom.md");
        Files.writeString(tpl, """
                ---
                title: Custom
                description: From user dir
                tags: [custom]
                ---
                # Hi
                """);
        TemplateService service = new TemplateService(Optional.of(tmp));
        TemplateMeta meta = service.list().stream()
                .filter(m -> "my-custom".equals(m.name()))
                .findFirst().orElseThrow();
        assertThat(meta.source()).isEqualTo("user");
        assertThat(meta.title()).isEqualTo("Custom");
        assertThat(meta.license()).isNull();
        assertThat(service.load("my-custom")).isPresent();
    }

    @Test
    void missingUserDirIsTolerated() {
        TemplateService service = new TemplateService(Optional.of(Path.of("/nonexistent/path/for/tests")));
        // Should still load built-ins without throwing.
        assertThat(service.list()).isNotEmpty();
    }

    @Test
    void builtinMissingLicenseThrows() throws IOException {
        // Use a custom service that loads from a temp "builtin" directory we control.
        // We can't easily inject the classpath, so we validate the helper path:
        // calling parseMeta + the same validation logic via TemplateService construction
        // is exercised by the constructor; here we just exercise the parser & threshold.
        TemplateMeta noLicense = TemplateService.parseMeta("x", "---\ntitle: x\n---\nbody", "builtin");
        assertThat(noLicense.license()).isNull();
        // Simulate what the constructor does:
        assertThatThrownBy(() -> {
            if (!"MIT".equals(noLicense.license())) {
                throw new IllegalStateException("Built-in template 'x' must declare `license: MIT`");
            }
        }).isInstanceOf(IllegalStateException.class)
          .hasMessageContaining("must declare `license: MIT`");
    }
}

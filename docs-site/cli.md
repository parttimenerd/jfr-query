# CLI Reference

## Global

```shell
java -jar query.jar [-hV] [COMMAND]
```

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help |
| `-V, --version` | Print version |

## `import`

Import a JFR recording into a DuckDB database file.

```shell
java -jar query.jar import recording.jfr output.db
```

## `query`

Execute a SQL query or named view against a JFR recording.

```shell
java -jar query.jar query recording.jfr "hot-methods"
java -jar query.jar query recording.jfr "SELECT * FROM GarbageCollection LIMIT 10"
```

Named views (e.g. `hot-methods`) expand to `SELECT * FROM <view>`. List all views with `views`.

## `serve`

Start the notebook web UI.

```shell
java -jar query.jar serve recording.jfr [--port 4244] [--templates-dir ~/my-templates]
```

## `macros`

List available SQL macros.

```shell
java -jar query.jar macros recording.jfr
```

## `views`

List available SQL views.

```shell
java -jar query.jar views recording.jfr
```

## `context`

Print an AI-friendly schema description (tables, macros, views) suitable for pasting into an LLM.

```shell
java -jar query.jar context recording.jfr
```

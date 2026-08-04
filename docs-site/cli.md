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

Import a JFR or CJFR recording into a DuckDB database file.

```shell
java -jar query.jar import recording.jfr output.db
java -jar query.jar import recording.cjfr output.db
```

## `query`

Execute a SQL query or named view against a JFR recording.

```shell
java -jar query.jar query recording.jfr "hot-methods"
java -jar query.jar query recording.jfr "SELECT * FROM GarbageCollection LIMIT 10"
java -jar query.jar query recording.jfr "hot-methods" --csv -o results.csv
```

Named views (e.g. `hot-methods`) expand to `SELECT * FROM <view>`. List all views with `views`.

| Flag | Description |
|------|-------------|
| `--csv` | Output in CSV format instead of the default table. |
| `-o FILE`, `--output FILE` | Write output to a file instead of stdout. |
| `-n`, `--no-cache` | Skip the `.db` cache — re-import from the `.jfr` file every time. |

When called without a query argument, `query` prints the list of available tables and views for the recording.

## `serve`

Start the notebook web UI. Accepts a `.jfr` or `.cjfr` recording, or an existing `.db` file.

```shell
java -jar query.jar serve recording.jfr
java -jar query.jar serve recording.cjfr
java -jar query.jar serve recording.db --port 4244 --templates-dir ~/my-templates
```

| Flag | Description |
|------|-------------|
| `-p PORT`, `--port PORT` | HTTP port (default: 4244). |
| `--no-open` | Don't open the browser automatically on startup. |
| `--templates-dir DIR` | Extra directory of `.md` notebook templates shown in the gallery. |

## `macros`

List available SQL macros.

```shell
java -jar query.jar macros
```

## `views`

List available SQL views.

```shell
java -jar query.jar views
```

## `context`

Print an AI-friendly schema description (tables, macros, views) suitable for pasting into an LLM.

```shell
java -jar query.jar context recording.jfr
```

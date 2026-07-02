# Web UI & Notebooks

Start the UI with `java -jar query.jar serve recording.jfr`, then open `http://localhost:4244`.

## Notebook cells

A notebook is a sequence of cells. Each cell contains a SQL query and optionally renders its
result as a chart. Cells can reference each other's results via named aliases.

## Built-in templates

Open the template gallery with **New from template** in the top bar. Built-in templates cover:

| Template | What it shows |
|----------|--------------|
| GC Analysis | Pause times, GC cause breakdown, heap after GC |
| Heap Allocation | Top allocating methods, allocation over time |
| Threading | Thread count, lock contention, blocked threads |
| Exceptions | Exception frequency and stack traces |

Choose **Replace**, **Append**, or **Insert at top** when applying a template.

## Variable controls

Add `variables` in the notebook front-matter to expose sliders/inputs in the sidebar:

```yaml
variables:
  $$threshold_ms: '100'
```

Reference them in SQL as `$$threshold_ms`.

## Inline scalars

Embed query results inline in prose:

```
There were ${SELECT count(*) FROM GarbageCollection} GC events.
```

## Conditional blocks

Show a section only when a condition holds:

````
```{if SELECT max(duration_ms) > $$threshold_ms FROM gc_pauses}
### Warning: long pauses detected
```
````

## Custom templates

Pass `--templates-dir ~/my-templates` to `serve`. Any `.md` file at the top level is listed
in the gallery under a "user" badge. See the [template syntax](cli.md) section of the CLI docs.

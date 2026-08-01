# Web UI & Notebooks

The jfr-query web UI is a browser-based notebook environment for analysing Java Flight Recorder (JFR) files using SQL, DuckDB, and a declarative plot DSL.

Open a notebook, drop a `.jfr` file, and start writing SQL cells that query the recording. Each cell can render a table or one or more plots described with the plot DSL.

## Layout

- **Left sidebar** — file explorer, variable controls, schema browser, and AI chat.
- **Main area** — the notebook itself: a stack of cells with SQL, plots, and Markdown.

## Cells

A cell is a self-contained unit that can contain:

- Markdown prose (rendered on the fly).
- One or more `sql` code blocks (executed against DuckDB).
- One or more `plot` code blocks (rendered from the query results).
- Inline scalar expressions `${...}` embedded in Markdown.
- Conditional blocks that only render when a SQL predicate holds.

Cells are separated by an HTML comment delimiter:

```html
<!-- @cell name=my_handle -->
```

The `name=` attribute gives the cell a stable handle that can be referenced from other cells and from `cellConditions` in the front matter.

## Working with data

1. Drop a `.jfr` file onto the sidebar or use the file ingest UI.
2. jfr-query parses the recording into DuckDB tables. The schema browser lists every event type and column.
3. Write a SQL cell. Aliases (`-- alias name`) let downstream cells and plots reference the result set by name.
4. Add a plot cell using the plot DSL. By default a plot uses the query immediately preceding it.

## Live coupling

Interactive plots write back to variables:

- `BRUSH $var MODE X` writes the selected X range to `$var.lo` / `$var.hi`.
- `ON HOVER TOOLTIP "..."` can update variables that downstream SQL cells read.

When a variable changes, dependent SQL cells re-run automatically, and their plots re-render.

## AI chat

The left-sidebar AI chat panel lets you explore a recording conversationally.

- Type a question or choose a contextual starter prompt (the toolbar shows data-aware chips based on which JFR event types are present — GC, CPU, allocations, contention, I/O, or memory leaks).
- The AI can run SQL queries, preview charts, and propose cells to add to your notebook.
- Mutations (adding or editing cells) always require explicit approval before they take effect.

### Slash commands

| Command | Effect |
|---------|--------|
| `/normal` | Default chat mode — all tools available, mutations require approval. |
| `/plan` | Propose-only mode — the AI drafts a structured plan without modifying the notebook. Approve individual steps from the plan card. |
| `/btw` | Normal chat plus "by the way" suggestion cards after each reply. |
| `/verbose` | Show full reasoning — intermediate query results, hypotheses, and step-by-step analysis before conclusions. |
| `/compact` | Summarise and compress the conversation history to free up context window. |
| `/model [name]` | Show or switch the current model. |
| `/provider [name]` | Show or switch the AI provider (anthropic, openai, local, browser). |
| `/skills` | List available skills. |
| `/skill-name` | Activate a skill (e.g. `/gc-analysis`). |
| `/skill-name off` | Deactivate a skill. |
| `/help` | Show all available commands. |

### Multi-channel chat

Open multiple chat channels (the `+` button in the chat header) to keep independent analyses separate. Each channel has its own conversation history, mode, and model. Switch between them at any time — the notebook shared across all channels.

### Data visibility

The AI's access to your data is controlled by the visibility mode (shown in the chat header):

- **No data** — the AI sees only the schema (table and column names). Queries can still be run with user approval.
- **Sanitized** — the AI sees recent rows with string values redacted.
- **Full** — the AI sees recent rows in full. Use for analyses that require inspecting actual values.

## Sharing notebooks with embedded data

Notebooks are plain Markdown files. By default they contain only SQL and plot config — opening them requires the original `.jfr` file.

To share results without the JFR file:

1. With a JFR loaded, click the **Export with data** button (↑ icon) in the notebook toolbar.
2. jfr-query re-runs every SQL cell and embeds the results as a base64 blob in the front matter.
3. Share the downloaded `notebook-shared.md` file.

Recipients open the file in jfr-query without loading a JFR. A **Snapshot** badge appears in the header to indicate embedded data is being displayed. Live queries are not available until a JFR file is loaded.

Row counts are capped at 500 per SQL block to keep file sizes reasonable.

## Reference documentation

For complete reference material see:

- [Notebook Format](notebook-format.md) — front matter, cell delimiters, SQL blocks, inline scalars, conditional blocks, variable blocks.
- [Plot DSL](plot-dsl.md) — all plot types, inner arguments, tail clauses, composite plots, query references.
- [Variables](variables.md) — cell-local and notebook-level variables, substitution rules, live coupling.
- [Built-in Views & Macros](views-macros.md) — every canned view and macro shipped with jfr-query.
- [AI Providers](ai-providers.md) — configure Anthropic, OpenAI, local models (Ollama, llama.cpp, SAP proxy), or in-browser inference.

# JFR Query

![JFR Query Notebook UI](page-full.png)

Analyse Java Flight Recorder files with SQL. JFR Query transforms a `.jfr` recording into a
[DuckDB](https://duckdb.org/) database and lets you query it with the full power of SQL —
through a notebook-style web UI or from the command line.

**[→ Open the live web app](https://parttimenerd.github.io/jfr-query/)**

## Features

- **Notebook-style analysis** — compose SQL cells, prose, and charts in one document
- **Built-in templates** — ready-made analyses for GC, heap allocation, threading, and exceptions
- **Interactive charts** — line, bar, scatter, heatmap, and flame graphs with brushable time ranges
- **Variable controls** — parameterised queries with sliders, dropdowns, and text inputs
- **Inline scalars** — embed `${SELECT …}` expressions directly in prose
- **AI-assisted queries** — context-aware SQL suggestions powered by Google Gemini

## Quick Start

```shell
# Download and run the web UI
java -jar query.jar serve myrecording.jfr
# Open http://localhost:4244
```

See [Getting Started](getting-started.md) for full install instructions.

# JFR Query

![JFR Query Notebook UI](../page-full.png)

Analyse Java Flight Recorder files with SQL. JFR Query transforms a `.jfr` recording into a
[DuckDB](https://duckdb.org/) database and lets you query it with the full power of SQL —
or explore it through a notebook-style web UI.

## Features

- **Notebook-style analysis** — compose SQL cells, prose, and charts in one document
- **Built-in templates** — ready-made analyses for GC, heap allocation, threading, and exceptions
- **Interactive charts** — line, bar, scatter, heatmap, and flame graphs with brushable time ranges
- **Variable controls** — parameterised queries with sliders, dropdowns, and text inputs
- **Inline scalars** — embed `${SELECT …}` expressions directly in prose
- **AI-assisted queries** — context-aware SQL suggestions powered by Google Gemini
- **Live demo** — try the UI in a browser after deploying via CI: [Open demo →](https://parttimenerd.github.io/jfr-query/app/)

## Quick Start

```shell
# Download and run
java -jar query.jar serve myrecording.jfr
```

See [Getting Started](getting-started.md) for full install instructions.

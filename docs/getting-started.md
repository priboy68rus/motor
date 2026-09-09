# Getting started

## Requirements

- Python 3.11 or newer.
- A modern browser with Web Workers, WebAssembly, and `DecompressionStream`.

Node.js is needed only when changing the browser runtime itself. It is not
needed to install motor or build reports.

## Install

Create an isolated environment and install the package from PyPI:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install motor-reports
motor --help
```

For reproducible installations, pin the version with
`python -m pip install "motor-reports==0.1.0"`. The distribution name is
`motor-reports`; the installed command is `motor`.

## Minimal report

Create `report.md` and a UTF-8 CSV file at `data/orders.csv`:

````md
---
title: Orders
slug: orders
timezone: UTC
data:
  orders:
    path: ./data/orders.csv
---

```sql name=summary kind=query
select sum(amount) as amount
from orders
```

<BigValue
  query="summary"
  value="amount"
  title="Total amount"
/>
````

The YAML indentation is ordinary YAML indentation. Two spaces per nesting
level are recommended but not required; nested keys only need to be indented
consistently beneath their parent.

## Validate, build, and inspect

```bash
motor validate report.md
motor build report.md --out report.html
motor inspect report.html
```

Open `report.html` directly in a browser. The artifact embeds the CSV data,
DuckDB-WASM, Vega-Lite, and the motor runtime, so it needs neither a server nor
a network connection.

Use the reference pages while extending the report:

1. Declare sources and metadata in [Report file reference](report-file.md).
2. Add interactive state using [Parameters and filters](parameters.md).
3. Build datasets using [SQL reference](sql.md).
4. Render them using [Components reference](components.md).
5. Arrange the report using [Layout reference](layout.md).

The repository's
[`examples/revenue/report.md`](../examples/revenue/report.md) demonstrates all
major features together.

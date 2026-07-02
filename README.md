# motor

motor compiles Markdown/YAML/SQL report specifications and CSV data into one
self-contained HTML artifact. The compiler validates a report's parameters,
named SQL dependency graph, components, source identity, and freshness before
packaging the source data.

## Install from GitHub

Python 3.11 or newer and Git are required. Node.js is not required to build
reports; the compiled browser runtime is included in the Python package.

Install motor into an isolated virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install "git+https://github.com/priboy68rus/motor.git@master"
motor --help
```

For a reproducible installation, replace `master` with a specific commit SHA:

```bash
python -m pip install "git+https://github.com/priboy68rus/motor.git@<commit-sha>"
```

Alternatively, install the `motor` command globally with
[pipx](https://pipx.pypa.io/):

```bash
pipx install "git+https://github.com/priboy68rus/motor.git@master"
```

### Build a report

Source paths in `report.md` are resolved relative to that file. Validate the
specification and its CSV files before building:

```bash
motor validate path/to/report.md
motor build path/to/report.md --out report.html
motor inspect report.html
```

Open `report.html` directly in a modern browser. The generated report contains
its runtime and data and does not require a server or network connection.

To update an existing virtual-environment installation from `master`:

```bash
python -m pip install --force-reinstall \
  "git+https://github.com/priboy68rus/motor.git@master"
```

## Development

Python 3.11 or newer is required.

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/motor validate examples/revenue/report.md
.venv/bin/motor build examples/revenue/report.md --out revenue.html
.venv/bin/motor inspect revenue.html
```

Open `revenue.html` directly in a browser. It has no network dependencies.

The browser runtime is maintained separately and its generated assets are
packaged with the Python project:

```bash
cd runtime
npm install
npm run check
npm run build
```

## Current authoring contract

- Parameters are declared in frontmatter. `select` and `multiselect` parameters
  load their choices from an explicit `options.source` and `options.column`.
- SQL blocks use ```` ```sql name=<id> kind=view|query ````. A `view` is a
  reusable filtered dataset; a `query` is a component-facing result.
- SQL templates currently support `in_filter("column", param)` and
  `between_filter("column", param)`. Parameter values will be safely rendered by
  the runtime; arbitrary template expressions are rejected.
- Shared filters are explicit: downstream queries read from a filtered view.
  motor never injects a hidden `WHERE` clause into arbitrary SQL.
- Components are self-closing declarations. `LineChart` and `BarChart` require
  `query`, `x`, and `y`; `BigValue` requires `query` and `value`; `Table`
  requires `query`; `Filters` requires a comma-separated `params` attribute.
- Components inside `<Row>...</Row>` share one line in equal-width columns.
  Top-level components occupy their own full-width line. Row attributes and
  nested rows are intentionally unsupported in the MVP.
- Query dependencies on sources, other SQL blocks, and parameters are inferred
  and embedded in the compiled report spec. Components may reference `query`
  blocks, but not intermediate `view` blocks.
- Filter changes rerun only dependent SQL blocks and components. Runtime updates
  are serialized, stale results are discarded, and prior query results are
  cached in memory. Date ranges include the complete end date.
- The generated HTML starts an embedded DuckDB-WASM instance, loads the
  packaged CSV files, creates declared views, runs queries, and renders
  `BigValue`, `Table`, `LineChart`, and `BarChart` components. Charts use the
  isolated Vega-Lite adapter.
- CSV files are UTF-8, comma-delimited, and contain a header row.
- Source paths are resolved relative to the report file.
- Manifest datetimes are ISO 8601 with a timezone.
- A missing report timezone defaults to UTC and produces a warning.
- Naive datetimes in CSV data are interpreted as UTC and produce a warning.
- Invalid CSV/freshness data stops the build. Stale data builds successfully
  with a visible warning.
- `artifact.content_sha256` identifies canonical report content: the report
  source, source file hashes, and tool/runtime versions. It excludes build
  time. The SHA-256 of the finished HTML is reported by the CLI but cannot be
  embedded in that same file without creating a self-reference.

The generated artifact embeds the source CSV. Anyone who can open the HTML can
extract its full data. Do not use it to distribute data the recipient should
not possess.

For multiselect filters, `All` disables the predicate. Clearing every option
uses the parameter's explicit `empty_behavior`: `all` disables the predicate,
while `none` produces no rows.

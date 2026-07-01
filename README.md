# motor

motor compiles Markdown/YAML/SQL report specifications and CSV data into one
self-contained HTML artifact. The compiler validates a report's parameters,
named SQL dependency graph, components, source identity, and freshness before
packaging the source data.

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
- Query dependencies on sources, other SQL blocks, and parameters are inferred
  and embedded in the compiled report spec. Components may reference `query`
  blocks, but not intermediate `view` blocks.
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

The runtime currently evaluates parameter defaults so filtered views can run,
but filter controls are not interactive yet. Interactive filter state,
dependency-aware reruns, caching, and stale-result protection are the next
implementation phase.

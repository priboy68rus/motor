# CLI, artifacts, and runtime

## CLI commands

The executable is `motor`. All commands return exit code `0` on success and
`2` for a handled motor validation or inspection error.

### `motor validate`

```bash
motor validate path/to/report.md
```

Reads the report and all configured CSV files, validates the full report
contract, compiles source passports, and runs freshness checks without writing
HTML. On success it prints:

- report title;
- artifact ID;
- build time;
- aggregate check status;
- row count and SHA-256 for every source.

Warnings are represented in the compiled manifest summary but do not produce a
non-zero exit code.

### `motor build`

```bash
motor build path/to/report.md --out path/to/report.html
```

`report` and `--out` are required. Parent output directories are created. The
HTML is written atomically through a temporary file and replacement, so a
failed write does not intentionally leave a partial target.

Success output includes:

- output path;
- artifact ID;
- SHA-256 of the finished HTML.

Validation/freshness warning messages are also printed to standard error.

### `motor inspect`

```bash
motor inspect report.html
motor inspect report.html --json
```

Reads the embedded manifest without starting the browser runtime. The default
output is the same concise report/source summary used by validation. `--json`
prints the complete manifest as formatted JSON. A file without a valid motor
manifest is rejected.

## Self-contained HTML artifact

The generated file embeds:

- report manifest and compiled report specification;
- every complete source CSV, gzip-compressed and base64-encoded;
- DuckDB WebAssembly and its Web Worker;
- Vega, Vega-Lite, and Vega Embed;
- motor's browser JavaScript and CSS.

No CDN or application server is required. The report can be opened with a
`file://` URL and queried interactively offline.

Because source files are embedded in full, anyone who receives the HTML can
extract all source rows, including columns not selected by visible queries.
Do not distribute an artifact to someone who should not possess its complete
input data. SQL filtering is a presentation rule, not access control.

## Browser requirements

The runtime requires a modern browser with:

- WebAssembly;
- Web Workers;
- Blob/object URLs;
- `DecompressionStream` with gzip support;
- SVG and standard modern JavaScript APIs.

If initialization fails, the page displays `Report runtime failed` with the
error message. DuckDB query and chart errors are isolated to affected
components when possible.

## Runtime startup

When the page opens, motor:

1. decodes and decompresses every embedded CSV;
2. creates the embedded DuckDB worker and database;
3. loads CSVs into `main` tables with header and type detection enabled;
4. reads distinct parameter options from source tables;
5. runs initially visible query dependency closures;
6. mounts layout and components;
7. reacts to parameter and tab changes until the page closes.

Closing or navigating away terminates the DuckDB connection and worker and
revokes temporary object URLs.

## Manifest

The embedded manifest records:

- report title, slug, specification version, and effective timezone;
- artifact ID, canonical content SHA-256, and local status;
- build timestamp, motor version, and runtime version;
- aggregate freshness values and status;
- source file name, size, row/column count, column names and inferred types,
  source SHA-256, timestamps, and freshness status;
- every passed check and warning.

## Artifact identity and reproducibility

`artifact.content_sha256` is calculated from:

- SHA-256 of the complete `report.md` source;
- SHA-256 of every configured source file;
- motor package version;
- browser runtime version.

The artifact ID is `<slug>__<first 12 digest characters>`. Build time is
excluded, so rebuilding identical content with identical tool/runtime versions
produces the same artifact ID and content identity.

The finished HTML SHA-256 printed by `motor build` can differ between builds
because the HTML manifest contains build timestamps. Use artifact identity for
logical report content and HTML SHA-256 for exact file-byte verification.

## Warnings versus failures

Warnings currently include:

- report timezone omitted, with UTC used;
- naive freshness timestamps interpreted as UTC;
- freshness lag exceeding `max_lag_hours`.

Warnings appear in the manifest and CLI output but do not block building.
Structural configuration, CSV, dependency, and syntax errors stop the command.

## Development commands

Install the Python project for development:

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
.venv/bin/python -m build
```

When changing the browser runtime:

```bash
cd runtime
npm install
npm run check
npm run build
```

The runtime build writes packaged assets consumed by the Python distribution.
Node.js is otherwise unnecessary for report authors.

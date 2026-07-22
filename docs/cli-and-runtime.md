# CLI, artifacts, and runtime

## CLI commands

The executable is `motor`. All commands return exit code `0` on success and
`2` for a handled motor validation or inspection error.

### `motor validate`

```bash
motor validate path/to/report.md
```

Reads the report and all configured CSV/Parquet files, validates the full report
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
motor build path/to/report.md --out path/to/report.html --update-registry ~/.motor/update-registry
```

`report` and `--out` are required. `--update-registry` is optional and defaults
to the `MOTOR_UPDATE_REGISTRY` environment variable when it is set. Parent
output directories are created. The HTML is written atomically through a
temporary file and replacement, so a failed write does not intentionally leave a
partial target.

Success output includes:

- output path;
- artifact ID;
- SHA-256 of the finished HTML.

Validation/freshness warning messages are also printed to standard error.

If an update registry is configured, build also writes:

```text
<registry>/reports/<slug>.json
```

That JSON is the source of truth served by `motor server`. A report only reads
it when the report frontmatter contains `update_check`. If `update_check` is
configured but no registry is provided through `--update-registry` or
`MOTOR_UPDATE_REGISTRY`, the HTML still builds and a warning is printed.

### `motor inspect`

```bash
motor inspect report.html
motor inspect report.html --json
```

Reads the embedded manifest without starting the browser runtime. The default
output is the same concise report/source summary used by validation. `--json`
prints the complete manifest as formatted JSON. A file without a valid motor
manifest is rejected.

### `motor server`

```bash
motor server --registry ~/.motor/update-registry --host 0.0.0.0 --port 8765
```

Serves latest-version metadata for report update badges. `--registry` points to
the same directory used by `motor build --update-registry` and defaults to the
`MOTOR_UPDATE_REGISTRY` environment variable when set. `--host` defaults to
`127.0.0.1`; use `0.0.0.0` when other machines on the network must reach the
server. `--port` defaults to `8765`.

Server configuration:

| Setting | Required | Default | Description |
| --- | --- | --- | --- |
| `--registry` | yes, unless `MOTOR_UPDATE_REGISTRY` is set | `MOTOR_UPDATE_REGISTRY` | Local directory containing `reports/<slug>.json` files. Use the same value for `motor build --update-registry`. |
| `MOTOR_UPDATE_REGISTRY` | no | — | Environment-variable fallback for both `motor build` and `motor server`. |
| `--host` | no | `127.0.0.1` | Bind address. Use `127.0.0.1` for local-only checks, or `0.0.0.0` to listen on all interfaces so other machines can reach the server. |
| `--port` | no | `8765` | TCP port used by the browser `update_check.endpoint`. |

Typical LAN setup:

```bash
export MOTOR_UPDATE_REGISTRY="$HOME/.motor/update-registry"
motor server --host 0.0.0.0 --port 8765
```

Then configure reports with the address that report viewers can reach:

```yaml
update_check:
  endpoint: http://192.168.1.10:8765
  distribution_url: https://nextcloud.example/s/reports
```

Build each new artifact with the same registry:

```bash
export MOTOR_UPDATE_REGISTRY="$HOME/.motor/update-registry"
motor build path/to/report.md --out path/to/report.html
```

Equivalent explicit build command:

```bash
motor build path/to/report.md --out path/to/report.html \
  --update-registry "$HOME/.motor/update-registry"
```

The server exposes:

| Route | Response |
| --- | --- |
| `GET /health` | `{"status":"ok"}` |
| `GET /reports/{slug}.json` | Contents of `<registry>/reports/{slug}.json`. |
| `OPTIONS *` | Empty CORS preflight response. |

Every response includes:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: *
Cache-Control: no-store
```

The route only accepts slugs matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Missing
reports return `404`; invalid slugs return `400`.

## Self-contained HTML artifact

The generated file embeds:

- report manifest and compiled report specification;
- every complete source file, gzip-compressed and base64-encoded;
- DuckDB WebAssembly and its Web Worker;
- Vega, Vega-Lite, and Vega Embed;
- motor's transparent PNG favicon, using the `samokat` accent color
  `#ff3b65`, as an inline data URL;
- motor's browser JavaScript and CSS, including SheetJS for local XLSX
  generation.

No CDN or application server is required. The report can be opened with a
`file://` URL and queried interactively offline.

Because source files are embedded in full, anyone who receives the HTML can
extract all source rows, including columns not selected by visible queries.
Do not distribute an artifact to someone who should not possess its complete
input data. SQL filtering is a presentation rule, not access control.
Component CSV/XLSX downloads expose only the current visible result fields,
but do not change this security model: the complete embedded sources remain
available to anyone who has the HTML artifact.

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

1. decodes and decompresses every embedded source file;
2. creates the embedded DuckDB worker and database;
3. loads CSVs with header/type detection and Parquet files with `read_parquet`
   into `main` tables;
4. reads distinct parameter options from source tables, including SQL `NULL`
   by default when present;
5. runs initially visible query dependency closures;
6. mounts layout and components;
7. starts the optional update check if `update_check` is configured;
8. reacts to parameter and tab changes until the page closes.

Closing or navigating away terminates the DuckDB connection and worker and
revokes temporary object URLs.

## Update notification server

Reports with `update_check` configured ask the update server for:

```text
{endpoint}/reports/{slug}.json
```

Expected JSON:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | no | Metadata schema version written by motor. The runtime currently ignores unknown schema versions. |
| `slug` | string | yes | Must match the current report slug, otherwise the response is ignored. |
| `title` | string | no | Human-readable report title. |
| `artifact_id` | string | yes | Latest known artifact ID for the slug. A different value shows the update badge. |
| `built_at` | string | no | Build timestamp for display/debugging. |
| `tool_version` | string | no | motor package version that wrote the metadata. |
| `runtime_version` | string | no | Browser runtime version that contributed to artifact identity. |

The browser check is intentionally fail-soft:

- network errors, timeouts, CORS failures, `404`, invalid JSON, and invalid
  payloads do not show an error;
- the report remains fully usable offline;
- no time-based staleness rule is applied;
- only a different `artifact_id` for the same `slug` shows the fixed top-right
  link to `distribution_url`.

The update server does not upload files to Mattermost, Nextcloud, or any other
external storage and does not know where the latest HTML artifact is stored.
For the current contract, `distribution_url` is the user-facing distribution
location.

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

The artifact ID is `<slug>__<first 12 digest characters>`. The motor package
version and browser runtime version intentionally affect the ID. Upgrading
motor can therefore produce a different artifact ID even when `report.md` and
the data files did not change. Build time is excluded, so rebuilding identical
content with identical tool/runtime versions produces the same artifact ID and
content identity.

The finished HTML SHA-256 printed by `motor build` can differ between builds
because the HTML manifest contains build timestamps. Use artifact identity for
logical report content and HTML SHA-256 for exact file-byte verification.

## Warnings versus failures

Warnings currently include:

- report timezone omitted, with UTC used;
- naive freshness timestamps interpreted as UTC;
- freshness lag exceeding `max_lag_hours`;
- `update_check` configured during build without an update registry.

Freshness and timezone warnings appear in the manifest and CLI output. The
missing update-registry warning is build-output-only because the HTML artifact
is still valid and self-contained. Warnings do not block building. Structural
configuration, source file, dependency, and syntax errors stop the command.

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

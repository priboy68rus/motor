# motor

motor compiles Markdown/YAML report specifications and CSV data into one
self-contained HTML artifact. The first implementation slice focuses on the
artifact manifest, source identity, freshness, and offline packaging.

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

## Current authoring contract

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

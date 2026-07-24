# motor

<img src="src/motor/static/motor-logo.png" alt="motor logo" width="160">

motor compiles a Markdown/YAML/SQL report and its CSV/Parquet sources into an
interactive HTML artifact. Reports run reactive SQL in the browser with
DuckDB-Wasm.

The default artifact is self-contained and works without a server or network
connection. An optional smaller CDN build reuses browser-cached DuckDB assets.

## Documentation

[`docs/`](docs/README.md) is the canonical reference for report fields,
defaults, allowed values, validation rules, CLI behavior, artifacts, and the
browser runtime.

- [Getting started](docs/getting-started.md)
- [Complete documentation index](docs/README.md)
- [Example report](examples/revenue/report.md)

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install "git+https://github.com/priboy68rus/motor.git@master"
motor --help
```

Python 3.11+ and Git are required. Node.js is not required to build reports.
For reproducible installations, replace `master` with a commit SHA:

```bash
python -m pip install "git+https://github.com/priboy68rus/motor.git@<commit-sha>"
```

## Quick start

```bash
motor validate examples/revenue/report.md
motor build examples/revenue/report.md --out revenue.html
motor inspect revenue.html
```

```bash
# Self-contained and offline (default)
motor build report.md --out report.html

# Smaller; requires DuckDB assets from the CDN or browser cache
motor build report.md --out report.html --asset-mode cdn
```

Open the generated HTML directly in a modern browser. See
[CLI, artifacts, and runtime](docs/cli-and-runtime.md) for build modes,
environment variables, inspection, and the optional update notification
server.

Both artifact modes contain the complete rows of their source datasets. Do not
share an artifact with anyone who must not have access to its source data.

## Development

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
.venv/bin/python -m build
```

To change the browser runtime:

```bash
cd runtime
npm install
npm run check
npm test
npm run build
```

The generated runtime is copied into `src/motor/static/` and distributed with
the Python package. See the
[development commands](docs/cli-and-runtime.md#development-commands) for the
full workflow.

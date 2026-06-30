motor: implementation brief for coding agent

1. What this project is

motor is a local-first reporting tool for product analysts.

It compiles a declarative analytical report into a single self-contained HTML artifact.

Input:

* Markdown/YAML report specification
* SQL query blocks
* CSV data sources
* Optional source metadata

Output:

* One interactive HTML file
* Embedded data
* Embedded report manifest
* Embedded JS/CSS runtime
* Filters, parameters, charts, tables and metric cards
* Data freshness/status UI
* Artifact identity, version metadata and build provenance

The product is not intended to replace Tableau or Power BI as a full BI platform. It is intended to solve a narrower and painful problem:

Build trusted, portable, interactive analytical reports that can be opened in a browser, shared with product teams, versioned, audited and understood by humans and LLM agents.

2. Why this exists

Product analysts often need to share analytical results with product managers and other analysts. Existing options are usually flawed:

* Power BI/Tableau require platform access, workspaces, permissions and sometimes specific OS/runtime constraints.
* Notebooks are good for analysis but poor as final business-facing artifacts.
* PDF/screenshots are portable but not interactive.
* HTML chart exports are interactive but usually lack report-level metadata, freshness, versioning and source identity.
* Email attachments create chaos: people open stale copies and are not sure whether they are looking at the same version.

motor solves the packaging and trust layer.

A report should answer these questions directly in the UI:

1. Is this the latest official version?
2. What data is inside?
3. When were the data sources processed?
4. When was the report built?
5. Did data checks pass?
6. What exact artifact am I viewing?
7. Are my colleague and I looking at the same artifact ID?

3. Core product principles

1. Single-file artifact
    The primary deliverable is one HTML file that can be opened in a browser.
2. Local-first
    The report should work without a BI server. Optional online checks are allowed, but the artifact must remain useful offline.
3. CSV-only for MVP
    Data sources are CSV files only. Database connectors are out of scope for the first version.
4. Report as code
    Reports are declared in Markdown/YAML/SQL, not configured through hidden UI state.
5. LLM-friendly
    The report spec should be readable, editable and reviewable by LLM agents. Avoid hidden state and huge unreadable JSON when possible.
6. Trust and provenance first
    The report must carry metadata about data freshness, source hashes, build time, tool version and artifact identity.
7. One-way reactivity
    Runtime state should flow in one direction:
    params → queries → components
    Avoid hidden Power BI-style filter context in the MVP.
8. Do not build a charting library
    Use an existing chart renderer. motor should provide a BI-friendly component API and translate it into a chart library specification.

4. Working name and ecosystem context

Working name: motor.

This is intended as the third project in an analyst tooling suite:

* rotor: VS Code extension improving the Jupyter notebook experience
* stator: library for database connections
* motor: compiler/runtime for portable analytical report artifacts

Suggested CLI shape:

motor build report.md --out report.html
motor preview report.md
motor inspect report.html
motor publish report.html
motor diff old.html new.html

5. MVP scope

The first version should support:

* Markdown report file with YAML frontmatter
* CSV data sources
* Optional metadata columns or companion metadata files
* SQL query blocks
* Basic parameters:
    * select
    * multiselect
    * date range
* Basic components:
    * DataStatus
    * VersionBadge
    * BigValue / metric card
    * Table
    * LineChart
    * BarChart
* Export to one self-contained HTML file
* Embedded manifest
* Source row counts and hashes
* Data processed time
* Data through time
* Report built time
* Tool/runtime version
* Artifact ID/hash
* Basic data freshness checks
* Basic runtime reactivity:
    * user changes parameter
    * affected queries rerun
    * affected components rerender

Out of scope for MVP:

* Drag-and-drop dashboard editor
* Power BI-style semantic model
* Database connectors
* Authentication and permissions
* Row-level security
* Scheduled refresh
* Server-side rendering
* Cross-filtering between charts
* Cascading filters
* Complex layout designer
* Full report hub UI
* PDF export
* Pixel-perfect dashboard canvas

6. Recommended technical architecture

The system has two phases:

Build-time:
  report.md + CSV files
      ↓
  Python compiler
      ↓
  single report.html
Runtime:
  browser opens report.html
      ↓
  JS runtime loads embedded data/spec/manifest
      ↓
  query engine runs SQL
      ↓
  chart renderer draws components

Recommended stack:

Python side:
  - Python 3.11+
  - pydantic for validated internal models
  - markdown/frontmatter parser
  - Jinja or a safe template layer for SQL parameter rendering
  - DuckDB Python for validation and optional build-time queries
  - gzip/base64 for data packaging
  - Jinja2 or similar for HTML template generation
Browser side:
  - TypeScript
  - DuckDB-WASM for runtime SQL
  - Vega-Lite + Vega-Embed or Apache ECharts for charts
  - small custom reactive store
  - custom UI components for filters/status/cards/tables

Preferred chart renderer for first implementation:

* Use Vega-Lite if the priority is declarative specs and LLM-friendliness.
* Use Apache ECharts if the priority is polished BI-like visuals quickly.

Default recommendation: start with Vega-Lite, but keep a chart adapter layer so the renderer can be swapped later.

7. High-level architecture

┌─────────────────────────────┐
│ report.md                    │
│ - YAML frontmatter           │
│ - Markdown content           │
│ - SQL blocks                 │
│ - component declarations     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Python compiler              │
│ - parse                      │
│ - validate                   │
│ - load CSV metadata          │
│ - build source manifests     │
│ - build dependency graph     │
│ - package data               │
│ - emit HTML                  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ report.html                  │
│ - HTML shell                 │
│ - CSS                        │
│ - JS runtime                 │
│ - chart renderer             │
│ - embedded report spec       │
│ - embedded manifest          │
│ - embedded compressed data   │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Browser runtime              │
│ - initialize state           │
│ - register data tables       │
│ - run queries                │
│ - render components          │
│ - handle filter changes      │
│ - show version/data status   │
└─────────────────────────────┘

8. Authoring format

Example report.md:

---
title: Revenue Overview
slug: revenue-overview
spec_version: 0.1.0
data:
  orders:
    path: ./data/orders.csv
    freshness:
      data_time_column: created_at
      processed_time_column: __processed_at
      max_lag_hours: 36
params:
  country:
    type: multiselect
    source: orders.country
    default: all
    empty_behavior: all
  date_range:
    type: date_range
    default: last_30_days
---
# Revenue Overview
<DataStatus />
<VersionBadge />
```sql revenue_by_month
select
  date_trunc('month', created_at) as month,
  sum(revenue) as revenue
from orders
where {{ in_filter("country", country) }}
  and {{ between_filter("created_at", date_range) }}
group by 1
order by 1
```
<LineChart
  data={revenue_by_month}
  x="month"
  y="revenue"
  title="Revenue by month"
  format="currency"
/>
```sql top_countries
select
  country,
  sum(revenue) as revenue
from orders
where {{ between_filter("created_at", date_range) }}
group by 1
order by 2 desc
limit 10
```
<BarChart
  data={top_countries}
  x="country"
  y="revenue"
  title="Top countries by revenue"
  format="currency"
/>

9. Internal compiled report spec

The compiler should transform the author-facing Markdown into a strict JSON-like internal model.

Example:

{
  "report": {
    "title": "Revenue Overview",
    "slug": "revenue-overview",
    "spec_version": "0.1.0"
  },
  "params": {
    "country": {
      "type": "multiselect",
      "source": "orders.country",
      "default": "all",
      "empty_behavior": "all"
    },
    "date_range": {
      "type": "date_range",
      "default": "last_30_days"
    }
  },
  "queries": {
    "revenue_by_month": {
      "sql_template": "select ...",
      "depends_on": {
        "sources": ["orders"],
        "params": ["country", "date_range"]
      },
      "mode": "runtime"
    }
  },
  "components": [
    {
      "id": "component_001",
      "type": "LineChart",
      "query": "revenue_by_month",
      "props": {
        "x": "month",
        "y": "revenue",
        "title": "Revenue by month",
        "format": "currency"
      }
    }
  ]
}

The internal model should be validated with pydantic or an equivalent schema validation layer.

10. Data source metadata contract

Each CSV source should have a source passport.

The builder must compute automatically:

* file name
* file size
* row count
* column count
* column names
* inferred column types
* SHA-256 hash
* loaded_into_report_at

If configured, the builder should also compute:

* data_min_at
* data_max_at
* processed_at

There are two supported metadata modes.

Mode A: metadata columns inside CSV

Example:

order_id,user_id,revenue,created_at,__processed_at
1,42,10.5,2026-06-25 13:10:00,2026-06-26 08:03:22
2,43,25.0,2026-06-25 14:20:00,2026-06-26 08:03:22

Recommended reserved fields:

__processed_at
__snapshot_id
__source_name

The report spec maps business time and processing time:

freshness:
  data_time_column: created_at
  processed_time_column: __processed_at

Mode B: companion metadata file

Example file layout:

data/
  orders.csv
  orders.meta.yml

Example orders.meta.yml:

source: orders
file: orders.csv
processed_at: 2026-06-26T08:03:22+02:00
data_min_at: 2024-01-01T00:00:00+02:00
data_max_at: 2026-06-25T23:59:59+02:00
producer: airflow.orders_export
environment: prod
snapshot_id: orders_2026_06_26_0803

11. Report manifest

Every generated HTML must include a manifest.

Example:

{
  "report": {
    "slug": "revenue-overview",
    "title": "Revenue Overview",
    "spec_version": "0.1.0"
  },
  "artifact": {
    "id": "revenue-overview__20260626T081510__9ab12c",
    "sha256": "9ab12c...",
    "status": "published"
  },
  "build": {
    "built_at": "2026-06-26T08:15:10+02:00",
    "tool_name": "motor",
    "tool_version": "0.1.0",
    "runtime_version": "0.1.0",
    "build_mode": "local"
  },
  "freshness": {
    "status": "passed",
    "data_through": "2026-06-25T23:59:59+02:00",
    "processed_at": "2026-06-26T08:03:22+02:00"
  },
  "sources": [
    {
      "name": "orders",
      "file_name": "orders.csv",
      "rows": 182391,
      "columns": 18,
      "file_size_bytes": 14829312,
      "sha256": "8f31ac...",
      "data_min_at": "2024-01-01T00:00:00+02:00",
      "data_max_at": "2026-06-25T23:59:59+02:00",
      "processed_at": "2026-06-26T08:03:22+02:00",
      "freshness_status": "passed"
    }
  ],
  "checks": {
    "status": "passed",
    "tests": [
      {
        "name": "required_columns_present",
        "status": "passed"
      },
      {
        "name": "data_freshness",
        "status": "passed"
      }
    ]
  }
}

All datetimes in manifests must use ISO 8601 with timezone.

12. Data status UI

Every report should have a visible data/status block.

Default compact version:

✅ Published · Latest · Checks passed
Data through: 25 Jun 2026 23:59
Data processed: 26 Jun 2026 08:03
Report built: 26 Jun 2026 08:15
Spec: v0.1.0 · Tool: motor v0.1.0 · Artifact: 9ab12c

If stale:

⚠️ Data freshness warning
events.csv is stale: data through 23 Jun 2026, expected 25 Jun 2026 or later.

If not latest:

⚠️ You are viewing an older version
Current artifact: 9ab12c
Latest artifact: f3d991
Open latest

For MVP, latest checking can be optional and only work when a latest_manifest_url is present in the manifest.

13. Data checks

Implement basic checks first:

* CSV file exists
* CSV can be parsed
* required columns exist
* row count > 0
* configured freshness columns exist
* data_max_at is not older than configured max_lag_hours
* processed time can be parsed
* no duplicate query IDs
* no duplicate component IDs
* every component references an existing query
* every query references existing sources
* every SQL template parameter is declared

Later checks:

* uniqueness checks
* value range checks
* null-rate checks
* row-count anomaly checks
* metric sanity checks
* comparison to previous artifact

14. Data packaging

MVP packaging:

CSV file
  ↓
UTF-8 text
  ↓
gzip
  ↓
base64
  ↓
embedded into HTML

HTML structure:

<script type="application/json" id="motor-manifest">
  { ... }
</script>
<script type="application/json" id="motor-report-spec">
  { ... }
</script>
<script
  type="application/octet-stream"
  id="motor-data-orders"
  data-source-name="orders"
  data-encoding="base64+gzip+csv">
  H4sI...
</script>

The browser runtime must decode the embedded data and register it with the query engine.

Future packaging formats:

* Arrow IPC
* Parquet
* pre-aggregated JSON datasets
* hybrid raw + precomputed extracts

15. Runtime query engine

Recommended: DuckDB-WASM.

Runtime initialization:

1. Load manifest
2. Load report spec
3. Decode embedded data blocks
4. Start DuckDB-WASM
5. Register each CSV as a virtual file
6. Create DuckDB tables/views from CSV
7. Initialize default params
8. Run initial queries
9. Render components

The runtime should expose a query runner abstraction:

interface QueryRunner {
  initialize(sources: SourceData[]): Promise<void>
  runQuery(queryId: string, sql: string): Promise<QueryResult>
}

This abstraction allows replacing DuckDB-WASM later if needed.

16. SQL templates and parameters

Queries should be SQL templates.

Example:

select
  country,
  sum(revenue) as revenue
from orders
where {{ in_filter("country", country) }}
  and {{ between_filter("created_at", date_range) }}
group by 1

Template helper behavior:

in_filter("country", country)
  country = all  → true
  country = [] with empty_behavior=all → true
  country = ["DE", "FR"] → country in ('DE', 'FR')
between_filter("created_at", date_range)
  → created_at between '2026-06-01' and '2026-06-25'

Do not concatenate unsafe raw user input directly into SQL. Parameter values must be escaped or bound safely.

17. Reactivity model

MVP reactivity is one-way:

params → queries → components

Do not implement chart-to-chart crossfiltering in MVP.

Runtime state should include:

{
  "params": {},
  "queryResults": {},
  "componentStates": {},
  "stateVersion": 0
}

Update cycle:

1. User changes parameter
2. Runtime increments stateVersion
3. Runtime identifies affected queries from dependency graph
4. Affected components become loading/stale
5. Runtime runs affected queries
6. If an old query result returns late, discard it
7. Commit results only if stateVersion still matches
8. Rerender affected components

Important correctness rule:

Never allow an old async query result to overwrite a newer state.

Each query should have dependencies:

{
  "query_id": "revenue_by_month",
  "depends_on": {
    "sources": ["orders"],
    "params": ["country", "date_range"]
  }
}

The compiler should infer dependencies from SQL templates where possible, but allow explicit dependency declarations later.

18. Caching

Implement simple query result cache.

Cache key:

query_id
+ normalized_sql
+ parameter_values_hash
+ data_snapshot_hash
+ runtime_version

If the user switches filters back to a previous state, reuse cached results.

Cache should be in-memory only for MVP.

19. Rendering and chart adapter

Do not expose raw Vega-Lite or ECharts specs as the primary user API.

Author writes:

<LineChart data={revenue_by_month} x="month" y="revenue" title="Revenue by month" />

Compiler produces internal component spec:

{
  "type": "LineChart",
  "query": "revenue_by_month",
  "props": {
    "x": "month",
    "y": "revenue",
    "title": "Revenue by month"
  }
}

Runtime does:

query result + component spec
  ↓
chart adapter
  ↓
Vega-Lite spec or ECharts option
  ↓
rendered chart

Keep chart adapter isolated:

runtime/src/charts/
  adapter.ts
  vegaAdapter.ts
  formatters.ts

Initial components:

BigValue

Input:

<BigValue data={summary} value="revenue" title="Revenue" format="currency" />

Render as HTML/CSS, not chart library.

Table

Input:

<Table data={top_countries} />

Render as HTML table.

LineChart

Render through chart adapter.

BarChart

Render through chart adapter.

20. Layout

Use document-like layout, not a freeform Power BI canvas.

Supported MVP layout:

# Overview
<Grid columns=3>
  <BigValue ... />
  <BigValue ... />
  <BigValue ... />
</Grid>
<Grid columns=2>
  <LineChart ... />
  <BarChart ... />
</Grid>

If implementing a custom component parser is too expensive for MVP, support a simpler syntax first and generate a default vertical layout.

Do not implement drag-and-drop layout in MVP.

21. HTML output requirements

The output HTML must:

* open in a normal browser
* contain no external network dependencies by default
* contain manifest/spec/data/runtime inline
* show visible data/build/version status
* support filters
* render basic charts
* preserve artifact identity
* have deterministic build output where possible

Preferred file naming:

revenue-overview__data-2026-06-25__spec-v0.1.0__9ab12c.html

For local builds:

revenue-overview__local__20260626T081510__9ab12c.html

22. Distribution and versioning

MVP can be filesystem-based.

Recommended output structure for published reports:

dist/
  revenue-overview/
    latest.html
    manifest.json
    versions/
      2026-06-26_0815_9ab12c.html
      2026-06-25_0812_21ff9a.html

Important distinction:

* latest.html points to the current published version.
* versions/<artifact>.html is immutable.

Email should be treated as a notification channel, not the source of truth.

A release notification should contain:

Revenue Overview updated
Data through: 2026-06-25
Built: 2026-06-26 08:15
Checks: passed
Spec: v0.1.0
Artifact: 9ab12c
Open latest:
<latest URL>
Open this exact version:
<immutable version URL>

For MVP, actual email sending can be out of scope. Implement publish output layout first.

23. CLI commands

MVP CLI:

motor build report.md --out report.html

Builds a self-contained HTML report.

motor inspect report.html

Prints embedded manifest summary.

motor validate report.md

Validates report spec, CSV sources and checks without building final HTML.

Near-future CLI:

motor preview report.md

Starts a local preview server.

motor publish report.md --dist ./dist

Builds artifact, stores immutable version and updates latest pointer.

motor diff old.html new.html

Compares two manifests and reports data/spec/check differences.

24. Suggested repository structure

motor/
  pyproject.toml
  README.md
  motor/
    __init__.py
    cli.py
    compiler.py
    parser.py
    models.py
    data_sources.py
    manifest.py
    checks.py
    packager.py
    html.py
    inspect.py
    publish.py
    templates/
      report.html.j2
  runtime/
    package.json
    tsconfig.json
    vite.config.ts
    src/
      main.ts
      state.ts
      manifest.ts
      dataLoader.ts
      duckdbRunner.ts
      queryTemplates.ts
      dependencyGraph.ts
      components/
        App.ts
        DataStatus.ts
        VersionBadge.ts
        FilterBar.ts
        BigValue.ts
        Table.ts
        Chart.ts
      charts/
        adapter.ts
        vegaAdapter.ts
        formatters.ts
      styles/
        base.css
  examples/
    revenue/
      report.md
      data/
        orders.csv
  tests/
    test_parser.py
    test_manifest.py
    test_packager.py
    test_checks.py
    fixtures/
      simple_report/

25. Implementation plan

Phase 0: skeleton

Goal: project compiles and CLI exists.

Tasks:

* Create Python package.
* Create motor build, motor validate, motor inspect commands.
* Create minimal HTML template.
* Create minimal runtime bundle placeholder.
* Add one example report.

Acceptance criteria:

* motor build examples/revenue/report.md --out report.html produces an HTML file.
* HTML opens and shows static title/manifest.

Phase 1: parse and validate report spec

Goal: turn report markdown into internal model.

Tasks:

* Parse YAML frontmatter.
* Parse SQL fenced blocks with IDs.
* Parse simple component declarations.
* Validate:
    * unique query IDs
    * known data sources
    * components reference existing queries
    * parameters are declared
* Create pydantic models.

Acceptance criteria:

* Invalid specs fail with useful errors.
* Valid example compiles to internal JSON spec.

Phase 2: CSV source passports

Goal: read CSV metadata and build manifest.

Tasks:

* Load configured CSV files.
* Compute row count, columns, file size, SHA-256.
* Infer basic column types.
* Support freshness columns.
* Compute data_min_at, data_max_at, processed_at.
* Implement basic checks.

Acceptance criteria:

* Manifest includes source metadata.
* Missing freshness column gives a useful error or warning.
* Stale source produces warning/failure according to config.

Phase 3: single-file packaging

Goal: embed all required data into HTML.

Tasks:

* gzip/base64 encode CSV files.
* Embed report spec, manifest and data blocks into HTML.
* Bundle runtime JS/CSS inline.
* Ensure output has no external dependency for basic load.

Acceptance criteria:

* HTML contains embedded manifest/spec/data.
* motor inspect report.html can extract and print manifest.
* HTML can be opened locally.

Phase 4: runtime data loading

Goal: browser runtime can decode embedded data.

Tasks:

* Implement JS/TS loader for manifest/spec/data blocks.
* Decode base64+gzip.
* Initialize runtime state.
* Display DataStatus and VersionBadge from manifest.

Acceptance criteria:

* Report shows data processed time, data through time, report built time, tool version and artifact ID.

Phase 5: query execution

Goal: execute SQL queries in browser.

Tasks:

* Add DuckDB-WASM integration.
* Register embedded CSV sources.
* Run initial SQL queries.
* Store query results in runtime state.
* Show query errors locally in components.

Acceptance criteria:

* A query over embedded CSV returns rows in the browser.
* Query failure does not crash whole report.

Phase 6: render basic components

Goal: actual report UI.

Tasks:

* BigValue component.
* Table component.
* LineChart component through chart adapter.
* BarChart component through chart adapter.
* Basic number/date formatting.

Acceptance criteria:

* Example report renders cards, table and charts from SQL results.

Phase 7: filters and reactivity

Goal: interactive report.

Tasks:

* Render filter controls from param definitions.
* Implement multiselect and date range.
* Implement SQL template helpers.
* Build dependency graph.
* Re-run affected queries when params change.
* Add loading/stale states.
* Add query result cache.
* Prevent old async results from overwriting newer state.

Acceptance criteria:

* Changing a filter updates only affected components.
* Rapid filter changes do not result in inconsistent chart state.
* Empty multiselect semantics are explicit and correct.

Phase 8: publish layout

Goal: basic versioned distribution.

Tasks:

* Implement motor publish.
* Write immutable artifact file.
* Update latest.html.
* Write external manifest.json.
* Include latest manifest URL in artifact when configured.

Acceptance criteria:

* Published report directory contains latest + versions.
* Opening an older report can show “not latest” if online manifest is reachable.

Phase 9: polish and docs

Goal: make it usable by another analyst.

Tasks:

* Improve errors.
* Add README.
* Add example reports.
* Add authoring guide.
* Add manifest documentation.
* Add troubleshooting guide.
* Add tests.

Acceptance criteria:

* New user can build example report from README.
* Common errors produce actionable messages.

26. Key engineering risks

DuckDB-WASM and direct file opening

Opening via file:// may create browser restrictions around workers/WASM loading. The implementation must test this early.

If direct file opening fails with DuckDB-WASM, consider:

* inlining WASM as base64 and creating Blob URLs
* using a workerless mode if available
* requiring motor preview for full runtime but keeping static fallback
* starting MVP with build-time queries while DuckDB-WASM packaging is solved

File size

Self-contained HTML can become large.

MVP should warn when output exceeds configurable thresholds, for example:

warning: output HTML is 85 MB; this may be slow to open or email

SQL templating safety

Parameter substitution must be safe. Avoid raw string concatenation where possible.

Reactivity correctness

Must prevent stale async query results from overwriting current state.

Chart library lock-in

Keep chart adapter separate from component API.

Scope creep

Do not implement full BI semantic modeling, drag-and-drop editing or complex cross-filtering in MVP.

27. Testing strategy

Python tests:

* parser tests
* frontmatter validation tests
* SQL block extraction tests
* component parsing tests
* source manifest tests
* freshness checks
* packager tests
* inspect command tests

Runtime tests:

* manifest loading
* data decoding
* parameter state updates
* dependency graph invalidation
* query cache keys
* chart adapter output

End-to-end tests:

* build example report
* open HTML in headless browser
* assert DataStatus is visible
* assert initial chart renders
* change filter
* assert chart updates

Golden files:

* Store expected manifests for small example reports.
* Avoid brittle full HTML snapshots unless normalized.

28. Definition of done for MVP

MVP is done when:

1. A user can create a report from Markdown/YAML/SQL and CSV.
2. motor build produces one HTML file.
3. The HTML opens and renders without Python.
4. The report shows data processed time, data through time, report built time, tool version and artifact ID.
5. The report renders at least:
    * one metric card
    * one table
    * one line chart
    * one bar chart
6. A multiselect filter updates at least one chart.
7. A date range filter updates at least one chart.
8. The manifest includes source row counts and hashes.
9. Data freshness checks are visible in the report.
10. Basic validation errors are understandable.
11. There is an example report in the repository.
12. There is a README with build instructions.

29. Product positioning to preserve during implementation

Do not describe this as “a Tableau clone” or “Power BI replacement”.

The intended positioning:

motor is a compiler for trusted portable BI artifacts.

Alternative wording:

Markdown + SQL + CSV in, one interactive HTML report out.

Or:

.html as the new .pbix, but readable, git-friendly, offline and AI-editable.

The core value is not chart rendering. The core value is trusted packaging:

* embedded data
* explicit spec
* visible freshness
* artifact identity
* reproducible build
* version-aware distribution
* LLM-friendly report-as-code

30. Immediate next step for the agent

Start with the smallest vertical slice:

1. Create package skeleton.
2. Add motor build.
3. Parse one report title and one CSV source.
4. Compute source manifest.
5. Embed manifest and CSV into one HTML.
6. Show a static DataStatus block in the HTML.

Do not start with complex charts or DuckDB-WASM until the basic artifact and manifest pipeline works.

First successful demo:

motor build examples/revenue/report.md --out revenue.html
open revenue.html

The page should show:

Revenue Overview
Data processed: ...
Report built: ...
Tool: motor v0.1.0
Artifact: ...
Sources:
- orders.csv: N rows, sha256 ...

After this vertical slice is stable, add runtime query execution and charts.

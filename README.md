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

## Writing `report.md`

A report is one UTF-8 Markdown file containing:

1. YAML frontmatter between two `---` lines.
2. Named SQL fenced blocks.
3. Self-closing component declarations and optional `Row` layout blocks.

The current runtime renders the report title and declared components. Ordinary
Markdown headings and prose in the body are preserved in the compiled spec but
are not rendered yet.

### Frontmatter

The following fields are supported. Unknown fields are rejected.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `title` | yes | — | Non-empty report title shown in the HTML. |
| `slug` | yes | — | Stable ID using lowercase letters, digits, and single hyphens, for example `revenue-overview`. |
| `data` | yes | — | Mapping with at least one named CSV source. |
| `spec_version` | no | `0.1.0` | Version of the authoring specification. |
| `timezone` | no | `UTC` | Valid IANA timezone such as `UTC` or `Europe/Moscow`. Omitting it produces a warning. |
| `params` | no | `{}` | Named interactive filter parameters. |

Data-source and parameter names must be valid identifiers. ASCII names such as
`orders`, `country`, and `date_range` are recommended because they are also
used as SQL identifiers.

Minimal frontmatter:

```yaml
---
title: Orders
slug: orders
timezone: UTC
data:
  orders:
    path: ./data/orders.csv
---
```

### CSV data sources

Each entry under `data` creates a DuckDB table with the same name.

| Field | Required | Description |
| --- | --- | --- |
| `path` | yes | CSV path relative to `report.md`. |
| `freshness` | no | Freshness and processing-time configuration. |

CSV requirements:

- UTF-8 encoding; an optional UTF-8 BOM is accepted.
- Comma delimiter and a header row.
- Non-empty, unique column names.
- At least one data row.

Example with freshness metadata:

```yaml
data:
  orders:
    path: ./data/orders.csv
    freshness:
      data_time_column: created_at
      processed_time_column: __processed_at
      max_lag_hours: 36
```

Freshness fields are optional:

| Field | Description |
| --- | --- |
| `data_time_column` | ISO 8601 timestamp used to calculate data minimum, maximum, and age. |
| `processed_time_column` | ISO 8601 timestamp showing when rows were processed. The maximum value is displayed. |
| `max_lag_hours` | Positive freshness threshold. Exceeding it produces a warning but does not stop the build. It is meaningful when `data_time_column` is configured. |

Configured freshness columns must exist and contain at least one value. Invalid
timestamps stop the build. Timestamps without an offset are interpreted as UTC
and produce a warning; the report timezone does not currently change that
interpretation.

### Parameters and filters

Parameters are declared under `params` and become visible when referenced by a
`Filters` component.

Supported parameter types:

| Type | `options` | Default `default` | Default `empty_behavior` |
| --- | --- | --- | --- |
| `select` | required | `all` | `none` |
| `multiselect` | required | `all` | `none` |
| `date_range` | forbidden | `all` | forbidden |

For `select` and `multiselect`, `options.source` must name a configured CSV
source and `options.column` must exist in that source. The browser loads sorted
distinct non-null values from that column. Filter options are currently static,
not cascading.

```yaml
params:
  country:
    type: multiselect
    options:
      source: orders
      column: country

  date_range:
    type: date_range
    default:
      start: "2026-06-01"
      end: "2026-06-30"
```

Selection semantics:

- `default` and `empty_behavior` may be omitted. The defaults are `all` and
  `none`, respectively, for `select` and `multiselect`.
- `date_range` also defaults to `all`, which disables its SQL predicate until
  both dates are selected. It does not support `empty_behavior`.
- `default: all` disables the corresponding SQL predicate.
- An empty multiselect with `empty_behavior: all` also disables the predicate.
- An empty multiselect with `empty_behavior: none` produces no rows.
- Date ranges include the complete end date.

Render controls in the given order:

```md
<Filters params="date_range,country" title="Report filters" />
```

### SQL blocks

SQL is executed by DuckDB-WASM in the browser. Use named fenced blocks:

````md
```sql name=filtered_orders kind=view
select *
from orders
```
````

SQL metadata:

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | yes | — | Unique identifier for the block. |
| `kind` | no | `query` | Either `view` or `query`. |

Use `kind=view` for reusable intermediate datasets, especially shared filtered
datasets. Use `kind=query` for final result sets consumed by components.
Components cannot reference a `view` directly.

Every SQL block must depend, directly or through another named SQL block, on a
configured data source. Relations after `FROM` and `JOIN` must be configured
sources, named SQL blocks, or local CTEs. Duplicate names, unknown relations,
cycles, and names conflicting with data sources are build errors.

Example dependency chain:

````md
```sql name=filtered_orders kind=view
select *
from orders
where {{ in_filter("country", country) }}
  and {{ between_filter("created_at", date_range) }}
```

```sql name=revenue_by_country kind=query
select country, sum(revenue) as revenue
from filtered_orders
group by country
order by revenue desc
```
````

motor infers source, parameter, and SQL-block dependencies. When a filter
changes, only affected views, queries, and components are updated.

### SQL template helpers

Arbitrary Jinja/template expressions are not supported. Only these helpers are
accepted:

```sql
{{ in_filter("column_name", selection_param) }}
{{ between_filter("timestamp_column", date_range_param) }}
```

`in_filter` accepts a `select` or `multiselect` parameter and produces an
escaped `IN (...)` predicate, `TRUE`, or `FALSE` according to the selection and
`empty_behavior`. `between_filter` accepts a `date_range` parameter and creates
an inclusive calendar-date predicate. The first argument must be a simple or
dotted SQL column identifier.

Shared filters are explicit. Put helpers in a named filtered view and read from
that view in downstream queries. motor never inserts hidden `WHERE` clauses
into unrelated SQL.

### Components and visualizations

All components are self-closing and may have an optional unique `id`. Without
one, motor assigns `component_001`, `component_002`, and so on. Attribute values
should be quoted, and declarations may span multiple lines.

| Component | Required attributes | Optional attributes | Behavior |
| --- | --- | --- | --- |
| `Filters` | `params` | `title` | Interactive controls for comma-separated parameter names. Defaults to the title `Filters`. |
| `DataStatus` | — | — | Check status, data-through time, processing time, and build time. |
| `VersionBadge` | — | — | Tool version and artifact ID. |
| `BigValue` | `query`, `value` | `title`, `format`, `currency` | First row of one query column. `format="currency"` uses the ISO currency code from `currency`. |
| `Table` | `query` | `title`, `columns` | HTML table. `columns` is a comma-separated projection/order for display. |
| `LineChart` | `query`, `x`, `y` | `title`, `group`, `color`, `format`, `currency`, `stack` | Vega-Lite line chart. Date-like values on `x` use a temporal axis. |
| `BarChart` | `query`, `x`, `y` | `title`, `group`, `color`, `format`, `currency`, `stack` | Vega-Lite bar chart. Date-like values on `x` use a temporal axis. |

`query` must reference an existing `kind=query` SQL block. Referenced column
names such as `value`, `x`, and `y` must exist in its result.

For charts, `group` or `color` creates a color series. The `format`, `currency`,
and `stack` chart attributes are accepted for forward compatibility but are not
yet applied by the current Vega adapter. Number and currency formatting is
currently implemented for `BigValue`; table cells use basic automatic number
formatting.

Examples:

```md
<BigValue
  query="revenue_summary"
  value="revenue"
  title="Total revenue"
  format="currency"
  currency="EUR"
/>

<LineChart
  query="revenue_by_day"
  x="day"
  y="revenue"
  group="country"
  title="Revenue by day"
/>

<Table
  query="revenue_by_country"
  columns="country,revenue"
  title="Country detail"
/>
```

### Layout with `Row`

Top-level components occupy their own full-width line. Direct children of a
`Row` share one line in equal-width columns:

```md
<Row>
  <BigValue query="summary" value="revenue" />
  <LineChart query="daily" x="day" y="revenue" />
  <BarChart query="countries" x="country" y="revenue" />
</Row>

<Table query="countries" />
```

`Row` accepts no attributes, may contain only component declarations, must not
be empty, and cannot be nested. Rows collapse to two columns below 900 px and
one column below 600 px.

### Complete example

A complete `report.md` may look like this:

````md
---
title: Revenue Overview
slug: revenue-overview
timezone: UTC
data:
  orders:
    path: ./data/orders.csv
    freshness:
      data_time_column: created_at
      max_lag_hours: 36
params:
  country:
    type: multiselect
    options:
      source: orders
      column: country
---

<Filters params="country" title="Report filters" />
<DataStatus />
<VersionBadge />

```sql name=filtered_orders kind=view
select *
from orders
where {{ in_filter("country", country) }}
```

```sql name=revenue_summary kind=query
select sum(revenue) as revenue
from filtered_orders
```

```sql name=revenue_by_country kind=query
select country, sum(revenue) as revenue
from filtered_orders
group by country
order by revenue desc
```

<Row>
  <BigValue
    query="revenue_summary"
    value="revenue"
    title="Total revenue"
    format="currency"
    currency="EUR"
  />
  <BarChart
    query="revenue_by_country"
    x="country"
    y="revenue"
    title="Revenue by country"
  />
</Row>

<Table query="revenue_by_country" columns="country,revenue" />
````

The repository's [revenue example](examples/revenue/report.md) demonstrates
freshness, multiselect and date filters, a shared filtered view, dependent
queries, all current visualization types, and Row layout.

Validate and build while authoring:

```bash
motor validate examples/revenue/report.md
motor build examples/revenue/report.md --out revenue.html
motor inspect revenue.html
```

### Current validation rules and limitations

- Unknown frontmatter fields, parameter fields, component types, and component
  attributes are rejected.
- Query and component IDs must be unique.
- Components must reference existing `kind=query` blocks.
- Filter parameters, option sources, and option columns must exist.
- Malformed CSV, missing files/columns, invalid freshness timestamps, malformed
  templates, unknown SQL relations, and dependency cycles stop the build.
- Stale data, an omitted report timezone, and timezone-naive CSV timestamps are
  warnings rather than build failures.
- The generated HTML embeds the complete source CSV. Anyone who can open the
  report can extract its data; do not distribute data the recipient should not
  possess.
- `artifact.content_sha256` identifies canonical report content using the
  report source, source hashes, and tool/runtime versions. It excludes build
  time. The CLI separately reports the SHA-256 of the finished HTML.

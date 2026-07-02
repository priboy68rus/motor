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

| Type | Purpose | Required configuration | Default |
| --- | --- | --- | --- |
| `select` | One data-value filter | `options` | `all` |
| `multiselect` | Multiple data-value filter | `options` | `all` |
| `date_range` | Inclusive calendar-date filter | — | `all` |
| `dimension` | Selects a SQL field used for grouping or coloring | `default`, `choices` | none; must be explicit |

Parameter fields:

| Field | Applies to | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `type` | all | yes | — | `select`, `multiselect`, `date_range`, or `dimension`. |
| `label` | all | no | parameter name | Label displayed by the control. |
| `default` | all | only `dimension` | `all` for other types | Initial value. A dimension default must name a choice, or `none` when enabled. |
| `options` | `select`, `multiselect` | yes | — | Data source and column used to load filter values. |
| `empty_behavior` | `select`, `multiselect` | no | `none` | Result of an empty selection: `all` disables the predicate; `none` returns no rows. |
| `control` | `multiselect` | no | `auto` | Multiselect presentation: `auto`, `checkboxes`, or `dropdown`. |
| `choices` | `dimension` | yes | — | Static allowlist of selectable SQL fields. |
| `allow_none` | `dimension` | no | `false` | Adds a `Nothing` option that produces one empty-string group. |

For `select` and `multiselect`, `options.source` must name a configured CSV
source and `options.column` must exist in that source. The browser loads sorted
distinct non-null values from that column. Filter options are currently static,
not cascading.

`multiselect` also accepts an optional `control` field:

| `control` | Behavior |
| --- | --- |
| `auto` | Default. Uses checkboxes for up to 8 options and a searchable dropdown for 9 or more. |
| `checkboxes` | Always renders inline checkboxes. |
| `dropdown` | Always renders a searchable dropdown with a selected-value summary. |

The dropdown keeps `All` and `empty_behavior` semantics unchanged and limits
the visible option list with an internal scrollbar.

Each entry in dimension `choices` supports:

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `field` | yes | — | Simple or dotted SQL identifier emitted by `dimension()`. |
| `label` | no | `field` | Text displayed in the dimension select. |

```yaml
params:
  country:
    type: multiselect
    control: dropdown
    options:
      source: orders
      column: country

  date_range:
    type: date_range
    default:
      start: "2026-06-01"
      end: "2026-06-30"

  breakdown:
    type: dimension
    label: Group by
    default: none
    allow_none: true
    choices:
      country:
        label: Country
        field: country
      product_type:
        field: product_type
      transaction_type:
        label: Purchase / return
        field: transaction_type
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
- A `dimension` is not a filter: changing it substitutes another declared field
  into dependent SQL and reruns only affected queries.
- Dimension choice names must be identifiers. The name `none` is reserved.
- Dimension fields must be simple or dotted SQL identifiers. Raw SQL and user
  input cannot be used as dimension expressions.
- Every dimension choice requires `field`. Its `label` is optional and defaults
  to the exact `field` string shown in the control.
- `default: none` is valid only with `allow_none: true`.

Render controls in the given order:

```md
<Filters params="date_range,country,breakdown" title="Report controls" />
```

Reports may contain multiple `Filters` blocks. All controls read and write one
shared parameter state, so repeated controls for the same parameter stay
synchronized. Placement does not create SQL scope: a parameter affects exactly
the queries that reference it directly or through a dependent view.

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
{{ dimension(dimension_param) }}
```

`in_filter` accepts a `select` or `multiselect` parameter and produces an
escaped `IN (...)` predicate, `TRUE`, or `FALSE` according to the selection and
`empty_behavior`. `between_filter` accepts a `date_range` parameter and creates
an inclusive calendar-date predicate. The first argument must be a simple or
dotted SQL column identifier.

`dimension` accepts only a `dimension` parameter. It resolves the selected
choice through the compiled `choices` allowlist and emits a quoted SQL field.
When the selected value is `none`, it emits the SQL string literal `''`.
The helper must be followed immediately by an explicit stable `AS alias`:

```sql
select
  date_trunc('month', created_at) as month,
  {{ dimension(breakdown) }} as breakdown,
  sum(revenue) as revenue
from filtered_orders
group by month, breakdown
order by month, breakdown
```

The chart continues to reference the stable `breakdown` result column while a
parameter change reruns this query with another allowlisted source field.
The compiler records the alias-to-parameter binding. When that alias is used by
chart `group` or `color`, the legend title updates automatically. For example,
it becomes `Group by: Country`, using the parameter `label` and selected choice
`label`; each missing label falls back to its parameter name or `field`.

Shared filters are explicit. Put helpers in a named filtered view and read from
that view in downstream queries. motor never inserts hidden `WHERE` clauses
into unrelated SQL.

### Components and visualizations

All components are self-closing and may have an optional unique `id`. Without
one, motor assigns `component_001`, `component_002`, and so on. Attribute values
should be quoted, and declarations may span multiple lines.

| Component | Required attributes | Optional attributes | Behavior |
| --- | --- | --- | --- |
| `Filters` | `params` | `title`, `placement` | Interactive controls for comma-separated parameter names. `placement` is `content` (default) or `sidebar`. |
| `DataStatus` | — | — | Check status, data-through time, processing time, and build time. |
| `VersionBadge` | — | — | Tool version and artifact ID. |
| `BigValue` | `query`, `value` | `title`, `format`, `currency` | First row of one query column. `format="currency"` uses the ISO currency code from `currency`. |
| `Table` | `query` | `title`, `columns` | HTML table. `columns` is a comma-separated projection/order for display. |
| `LineChart` | `query`, `x`, `y` | `title`, `group`, `color`, `format`, `currency` | Vega-Lite line chart. Date-like values on `x` use a temporal axis. |
| `BarChart` | `query`, `x`, `y` | `title`, `group`, `color`, `format`, `currency`, `stack`, `bar_width` | Vega-Lite bar chart. Date-like values on `x` use a temporal axis. |

`query` must reference an existing `kind=query` SQL block. Referenced column
names such as `value`, `x`, and `y` must exist in its result.

For charts, `group` splits rows into series and assigns each series a color. On
a line chart this produces separate colored lines. On a bar chart it also
controls the bar layout through `stack`. `color` applies a categorical color
encoding without changing the grouped-bar layout; when both are present,
`group` takes precedence.

`BarChart` stack modes:

| `stack` | Behavior |
| --- | --- |
| `zero` | Default. Group values are stacked from zero; bar height is the total. |
| `none` | Bars from each `group` are displayed side by side on a discrete X scale. |
| `normalize` | Group values are stacked and normalized to 100%. |

Vega-Lite calls the ordinary accumulated mode `zero` because every stack starts
from the zero baseline.

Bars on a continuous temporal X axis default to `bar_width="18"` pixels. Set a
positive custom width when the time series is especially dense or sparse:

```md
<BarChart
  query="revenue_by_day"
  x="day"
  y="revenue"
  group="country"
  bar_width="24"
/>
```

On a discrete X axis, Vega-Lite calculates the band width automatically unless
`bar_width` is explicitly configured.

`normalize` requires `group` or `color`. Without either series field, `zero`
produces a normal single-series bar chart. `LineChart` does not accept `stack`.
With a dimension parameter set to `none`, all rows use the empty-string group,
so the chart has one series and may show a blank legend item. Its dynamic
legend title ends in `Nothing`.

The chart `format` and `currency` attributes remain reserved for future axis
formatting and are not yet applied by the Vega adapter. Number and currency
formatting is implemented for `BigValue`; table cells use basic automatic
number formatting.

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

### Sticky filter sidebar

Move global controls into a persistent sidebar with `placement="sidebar"`:

```md
<Filters
  params="date_range,country"
  title="Global filters"
  placement="sidebar"
/>
```

Multiple sidebar filter blocks are collected into one `<aside>`. On desktop it
stays visible while report content scrolls and receives its own vertical
scrollbar when necessary. Below 900 px it moves above the content and becomes a
collapsible `Report controls` section.

Sidebar filters must be top-level components. They cannot be placed inside a
`Row` or `Tab`. Regular `placement="content"` filters may appear at top level or
inside a tab.

### Tabs

Use `Tabs` and `Tab` to split a long report into sections:

```md
<Tabs>
  <Tab title="Overview">
    <Filters params="breakdown" title="Breakdown" />

    <Row>
      <BigValue query="summary" value="revenue" />
      <BarChart
        query="revenue_by_day"
        x="day"
        y="revenue"
        group="breakdown"
      />
    </Row>
  </Tab>

  <Tab title="Details">
    <Filters params="product_type" title="Detail filters" />
    <Table query="detail" />
  </Tab>
</Tabs>
```

Tab rules:

- `Tabs` accepts no attributes and contains one or more `Tab` blocks.
- `Tab` requires a non-empty `title` and may contain components and `Row`.
- `Tabs` and `Tab` cannot be nested.
- Parameter values persist when switching tabs.
- Only queries required by initially visible content run at startup.
- Opening a tab runs its query dependency closure. Switching back can reuse the
  in-memory query cache.
- A parameter change reruns affected queries in active content only. Hidden
  tabs use the latest values when opened.

Filters inside a tab are local only by convention. To make one truly affect
only that tab, reference its parameter only from that tab's SQL dependency
graph. motor never injects layout-based predicates or hidden scoping rules.

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
queries, a reactive dimension parameter with `none`, grouped and stacked
charts, all current visualization types, and Row layout.

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

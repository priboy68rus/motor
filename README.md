# motor

<img src="src/motor/static/motor-logo.png" alt="motor logo" width="160">

motor compiles Markdown/YAML/SQL report specifications and CSV/Parquet data into one
self-contained HTML artifact. The compiler validates a report's parameters,
named SQL dependency graph, components, source identity, and freshness before
packaging the source data.

## Documentation

The complete authoring and runtime contract lives in [`docs/`](docs/README.md):

- [report file and frontmatter](docs/report-file.md);
- [parameters and filters](docs/parameters.md);
- [SQL blocks and template helpers](docs/sql.md);
- [all components and attributes](docs/components.md);
- [rows, tabs, and sidebar layout](docs/layout.md);
- [CLI, artifact, and runtime behavior](docs/cli-and-runtime.md).

These reference pages specify which fields are required, their defaults and
allowed values, and their exact behavior. The sections below remain a shorter
guide with examples.

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
specification and its CSV/Parquet files before building:

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

### Optional update notifications

Reports can show a fixed top-right badge when a newer artifact exists for the
same `slug`. Add `update_check` to frontmatter:

```yaml
update_check:
  endpoint: http://192.168.1.10:8765
  distribution_url: https://nextcloud.example/s/reports
```

Use one registry directory for both build and server:

```bash
export MOTOR_UPDATE_REGISTRY="$HOME/.motor/update-registry"
motor server --host 0.0.0.0 --port 8765
```

In another shell, build the report:

```bash
export MOTOR_UPDATE_REGISTRY="$HOME/.motor/update-registry"
motor build path/to/report.md --out report.html
```

Equivalent explicit commands:

```bash
motor build path/to/report.md --out report.html \
  --update-registry "$HOME/.motor/update-registry"
motor server --registry "$HOME/.motor/update-registry" --host 0.0.0.0 --port 8765
```

The browser requests `{endpoint}/reports/{slug}.json`. If the returned
`artifact_id` differs from the current artifact ID, the badge links to
`distribution_url`. This URL can point to a Mattermost channel, a Nextcloud
folder or file, or any other distribution location. Server failures, CORS
failures, and offline usage are ignored; there is no time-based staleness rule. See
[`docs/cli-and-runtime.md`](docs/cli-and-runtime.md#update-notification-server)
for the complete contract.

Server configuration details, including `--registry`, `MOTOR_UPDATE_REGISTRY`,
`--host`, and `--port`, are documented in
[`docs/cli-and-runtime.md`](docs/cli-and-runtime.md#motor-server).

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

The motor package version and browser runtime version are part of artifact
identity. Updating motor can change the artifact ID even when report SQL and
source data are unchanged.

## Writing `report.md`

A report is one UTF-8 Markdown file containing:

1. YAML frontmatter between two `---` lines.
2. Named SQL fenced blocks.
3. Self-closing component declarations and optional `Row`/`Tabs` layout blocks.
4. Optional Markdown comments for temporarily disabling body content.

The current runtime renders the report title and declared components. Ordinary
Markdown headings and prose in the body are preserved in the compiled spec but
are not rendered yet; use `Text` for visible prose.

### Commenting out report code

Use standard Markdown/HTML comments to exclude any body fragment from the
compiled report:

````md
<!--
<BigValue query="old_summary" value="revenue" />

```sql name=old_summary kind=query
select sum(revenue) as revenue from orders
```
-->
````

Everything between `<!--` and `-->` is ignored, including components, layout
tags, and complete SQL blocks. Comments may also be inline, cannot be nested,
and must be closed. They apply only after YAML frontmatter; use YAML `#`
comments inside frontmatter. Comment markers written inside a fenced code block
are kept as code rather than interpreted by motor.

### Frontmatter

The following fields are supported. Unknown fields are rejected.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `title` | yes | — | Non-empty report title shown in the HTML. |
| `slug` | yes | — | Stable ID using lowercase letters, digits, and single hyphens, for example `revenue-overview`. |
| `data` | yes | — | Mapping with at least one named CSV or Parquet source. |
| `spec_version` | no | `0.1.0` | Version of the authoring specification. |
| `timezone` | no | `UTC` | Valid IANA timezone such as `UTC` or `Europe/Moscow`. Omitting it produces a warning. |
| `theme` | no | `{accent: blue}` | Interface accent preset; chart palettes are unchanged. |
| `update_check` | no | — | Optional latest-version check endpoint and distribution link. |
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

Choose an optional interface accent without changing chart palettes:

```yaml
theme:
  accent: kuper
```

Supported accents are `blue` (default), `violet`, `teal`, `green`, `amber`,
`coral`, `rose`, `graphite`, `samokat` (`#ff3b65`), and `kuper` (`#61f67a`).
See the complete [theme contract](docs/report-file.md#theme).

### Data sources

Each entry under `data` creates a DuckDB table with the same name.

| Field | Required | Description |
| --- | --- | --- |
| `path` | yes | Source path relative to `report.md`; `.csv` and `.parquet` are supported. |
| `freshness` | no | Freshness and processing-time configuration. |

CSV requirements:

- UTF-8 encoding; an optional UTF-8 BOM is accepted.
- Comma delimiter and a header row.
- Non-empty, unique column names.
- At least one data row.

Parquet requirements:

- Valid Parquet magic bytes, footer metadata, row count, and schema.
- At least one column and one data row.

Source type is inferred from the file extension. CSV and Parquet sources can be
mixed in one report and joined normally in SQL.

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
| `data_time_column` | ISO 8601 date or datetime used to calculate data minimum, maximum, and age. |
| `processed_time_column` | ISO 8601 date or datetime showing when rows were processed. The maximum value is displayed. |
| `max_lag_hours` | Positive freshness threshold. Exceeding it produces a warning but does not stop the build. It is meaningful when `data_time_column` is configured. |

Configured freshness columns must exist and contain at least one value. Invalid
timestamps stop the build. Date-only values such as `2026-07-01` are accepted
without timezone warnings. Datetime values without an offset are interpreted as
UTC and produce a warning; the report timezone does not currently change that
interpretation. The report timezone is used for displaying runtime metadata
timestamps in `<DataStatus />`, which renders one freshness row per source.

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
| `control` | `select`, `multiselect` | no | type-specific | Select presentation: `auto`, `radio`, or `dropdown`; multiselect presentation: `auto`, `checkboxes`, or `dropdown`. |
| `choices` | `dimension` | yes | — | Static allowlist of selectable SQL fields. |
| `allow_none` | `dimension` | no | `false` | Adds a `Nothing` option that produces one empty-string group. |

For `select` and `multiselect`, `options.source` must name a configured data
source and `options.column` must exist in that source. The browser loads sorted
distinct non-null values from that column. Filter options are currently static,
not cascading.

`multiselect` also accepts an optional `control` field:

| `control` | Behavior |
| --- | --- |
| `auto` | Default. Uses checkboxes for up to 8 options and a searchable dropdown for 9 or more. |
| `checkboxes` | Always renders inline checkboxes. |
| `dropdown` | Always renders a searchable dropdown with a selected-value summary. |

`select` accepts a parallel `control` field:

| `control` | Behavior |
| --- | --- |
| `dropdown` | Default. Always renders the searchable radio-button overlay. |
| `radio` | Always renders inline radio buttons. |
| `auto` | Uses inline radio buttons for up to 8 options and the dropdown for 9 or more. |

For multiselect, `All` visually checks every source option. Clearing `All`
clears every option, and clearing one option from the `All` state stores the
remaining checked values, making "all except one" a direct interaction. The
dropdown limits the visible option list with an internal scrollbar. Its panel
opens as an overlay above report content, so charts and other components do not
move. If the panel does not fit below the control, it automatically opens
upward within the viewport or sidebar scroll area. Opening any select,
multiselect, or dimension dropdown closes every other open filter dropdown in
the report.
Clicking outside the dropdown closes it.

Each entry in dimension `choices` supports:

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `field` | yes | — | Simple or dotted SQL identifier emitted by `dimension()`. |
| `label` | no | `field` | Text displayed in the dimension select. |

Dimension controls use the same searchable radio-button overlay as `select`.
The selected choice label is shown in the summary, and `allow_none: true` adds
the `Nothing` radio option.

```yaml
params:
  region:
    type: select
    label: Region
    control: dropdown
    options:
      source: orders
      column: region

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
- `select` renders one dropdown and stores either one source value or `all`.
  The searchable overlay uses radio buttons and closes after a choice. It uses
  the same `in_filter` SQL helper and reactive query updates as `multiselect`,
  but never returns an array.
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
the queries that reference it directly or through a dependent view. Each
content `Filters` block renders a small reset button that restores that block's
parameters to their declared defaults. Sidebar filters share one sidebar reset
button that restores all parameters shown in sidebar `Filters` blocks.

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

DuckDB CTEs work normally inside a SQL block and are scoped to that block. Use
a named `kind=view` SQL block when the intermediate result must be reused by
other queries.

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

### Debugging SQL failures

When a browser query fails, every affected component shows the query name, the
DuckDB error, and the rendered SQL after parameter helpers have been expanded.
This makes it possible to copy the exact failing statement into DuckDB for
debugging. A downstream query that was not executed lists the failed named
dependencies instead.

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
| `Text` | `text` | `title`, `placement` | Plain text card. Line breaks are preserved; Markdown and HTML are not interpreted. `placement` is `content` (default) or `sidebar`. |
| `DataStatus` | — | — | Compact check status, build time, report timezone, and one freshness row per source. |
| `VersionBadge` | — | — | Tool version and artifact ID. |
| `LoadingMetrics` | — | `title`, `placement` | Runtime startup timings collected in the browser. Also exposed as `window.__motorLoadingMetrics`. |
| `BigValue` | `query`, `value` | `title`, `format`, `currency`, `notation`, `compare_value`, `delta`, `delta_label`, `direction` | Value and optional comparison from the first query row. `format` is `number`, `currency`, or `percent`; `notation` is `compact` (default) or `standard`. |
| `Table` | `query` | `title`, `columns`, `download` | HTML table. `columns` is a comma-separated projection/order for display. |
| `LineChart` | `query`, `x`, `y` | `title`, `group`, `color`, `details`, `marker`, `color_scheme`, `color_direction`, `format`, `currency`, `download` | Vega-Lite line chart. Date-like values on `x` use a temporal axis. `marker` is `none` (default), `point`, or `circle`. |
| `BarChart` | `query`, `x`, `y` | `title`, `group`, `color`, `details`, `format`, `currency`, `stack`, `bar_width`, `download` | Vega-Lite bar chart. Date-like values on `x` use a temporal axis. |
| `Heatmap` | `query`, `x`, `y`, `value` | `title`, `format`, `color_scheme`, `color_direction`, `show_values`, `show_percent_sign`, `row_metric`, `row_metric_title`, `row_metric_format`, `row_metric_notation`, `row_metric_currency`, `download` | Rectangular heatmap with a quantitative gradient and an optional neutral per-row metric column. `format` is `number` (default) or `percent`; `show_values`, `show_percent_sign`, and `download` default to `true`. |

Tables and charts show a subtle data-download button by default; it offers CSV
and Excel (`.xlsx`). Use `download="false"` to hide it. Both formats contain the
component's visible fields from the latest successfully rendered,
filter-reactive query result. Values are raw and reusable (`0.425`, not
formatted `42.5%`). Normalized bar charts also include a derived
`<y>_normalized` column. See the complete projection, encoding, filename, and
safety rules in [data downloads](docs/components.md#data-downloads).

`query` must reference an existing `kind=query` SQL block. Referenced column
names such as `value`, `x`, and `y` must exist in its result.

#### BigValue comparisons

BigValue uses localized compact number formatting by default.
`format="currency"` uses the ISO currency code from `currency`;
`format="percent"` expects a fractional value, so `0.425` renders as `42.5%`:

```md
<BigValue
  query="retention_summary"
  value="retention"
  format="percent"
  title="Current retention"
/>
```

BigValue uses `notation="compact"` by default for localized human-readable
abbreviations. It can be combined with ordinary numbers, currencies, or
percentages:

```md
<BigValue
  query="revenue_summary"
  value="revenue"
  format="currency"
  currency="RUB"
  notation="compact"
  title="Revenue"
/>
```

Formatting follows the browser locale. For example, a Russian locale renders
`15123123` as approximately `15,1 млн`, while `15123123000` becomes
approximately `15,1 млрд`. Compact formatting also applies to an absolute
comparison delta. Set `notation="standard"` to show the full localized value.

Keep period logic in SQL and return the current and comparison values as two
columns of the same row:

```md
<BigValue
  query="revenue_kpi"
  value="current_revenue"
  compare_value="previous_revenue"
  delta="both"
  delta_label="vs previous month"
  direction="higher_is_better"
  format="currency"
  currency="EUR"
/>
```

`delta` may be `absolute`, `percent`, or `both` (default). Absolute change is
`value - compare_value`; percentage change divides that difference by the
absolute comparison value. When the comparison is zero, the percentage is
shown as `—` while the absolute delta remains available.
An absolute delta inherits the main value format, including `percent`.

`direction` controls semantic coloring: `higher_is_better`,
`lower_is_better`, or `neutral` (default). `delta_label` is optional. If the
current value is empty, the card shows `—`. If the comparison column is
missing, `NULL`, or an empty string, the comparison block is simply omitted.
Zero is always treated as a real value. A query returning multiple rows still
uses its first row, so aggregate to one row or use an explicit `ORDER BY ...
LIMIT 1`.

For charts, `group` splits rows into series and assigns each series a color. On
a line chart this produces separate colored lines. On a bar chart it also
controls the bar layout through `stack`. `color` applies a categorical color
encoding without changing the grouped-bar layout; when both are present,
`group` takes precedence.

`LineChart marker="point"` draws hollow value markers; `marker="circle"` draws
filled markers. All line charts use a larger invisible hit area around each
value, including when `marker="none"`, so tooltips do not require pixel-perfect
hovering. When a line or bar chart has `group` or `color`, its tooltip groups
all rows at the hovered X value and shows every series with the same color used
on the chart. For example, hovering one month can show retention for every
cohort or GMV for every channel. The series directly under the cursor is
highlighted without changing the list order.

Shared line/bar tooltips use one table layout with consistent typography,
colors, and series swatches. `details="field_a,field_b"` on `LineChart` or
`BarChart` adds extra query columns to that tooltip; detail labels appear once
as column headers instead of repeating on every row. Details do not affect
grouping, color, stacking, axes, or SQL dependencies. Labels are generated from
field names, e.g. `cohort_size` becomes `Cohort size`.

#### Cohorts, retention, and heatmaps

Retention calculations stay in SQL. Return one row per cohort and period with
a numeric retention value; `format="percent"` expects a fraction from `0` to
`1`:

```sql
select cohort_month, period_number, retained_users * 1.0 / cohort_size as retention
from cohort_metrics
```

Use a normal `LineChart` for cohort curves. `color_scheme` enables an ordered
sequential palette for the `group` or `color` field:

```md
<LineChart
  query="retention"
  x="period_number"
  y="retention"
  group="cohort_month"
  marker="point"
  format="percent"
  color_scheme="blues"
  color_direction="higher_is_darker"
  title="Retention by cohort"
/>
```

For ISO cohort dates, `higher_is_darker` makes newer cohorts darker;
`lower_is_darker` reverses the palette. The same direction names apply to a
heatmap's numeric `value` scale:

```md
<Heatmap
  query="retention"
  x="period_number"
  y="cohort_month"
  value="retention"
  format="percent"
  color_scheme="blues"
  color_direction="higher_is_darker"
  show_values="true"
  show_percent_sign="false"
  row_metric="cohort_size"
  row_metric_title="Cohort size"
  row_metric_notation="standard"
  title="Retention heatmap"
/>
```

`Heatmap` defaults to `color_scheme="blues"` and
`color_direction="higher_is_darker"`. Its X and Y values are discrete and
sorted ascending. Missing rows produce empty cells; zero remains a real value.
If any value is negative, Heatmap automatically switches to a zero-centered
diverging scale: negative values are red, zero is neutral gray, and positive
values are blue. Both sides use the same absolute limit, determined by the
larger of `abs(minimum)` and `abs(maximum)`. In that mode the sequential scheme
and direction are ignored.
Cell values use an 11 px normal-weight font and are displayed by default; set
`show_values="false"` to hide them. With `format="percent"`, set
`show_percent_sign="false"` to render `0.425` as `42.5` inside the cell while
keeping `42.5%` in the legend and tooltip.
Their text automatically switches between a contrasting darker or lighter
variant of the cell color, without an outline.
The chart keeps at least 34 pixels per distinct Y value, growing beyond its
300-pixel minimum when needed so cohort rows and value labels remain readable.
`row_metric` adds one neutral numeric column to the left of the heatmap cells.
The column is approximately 82 px wide; compact notation is available for
larger values.
Its value may repeat across all X rows or appear on only one row per Y; multiple
different non-null values for one Y are rejected. `row_metric_format` supports
`number`, `percent`, and `currency`; `row_metric_notation` is `standard`
(default) or `compact`. See the complete field and formatting contract in
[Heatmap](docs/components.md#heatmap).
Any Vega sequential scheme name may be used, for example `blues`, `greens`,
`viridis`, `magma`, `inferno`, or `cividis`. An unknown scheme is reported as a
chart-rendering error in the report.

`BarChart` stack modes:

| `stack` | Behavior |
| --- | --- |
| `zero` | Default. Group values are stacked from zero; bar height is the total. |
| `none` | Bars from each `group` are displayed side by side on a discrete X scale. |
| `normalize` | Non-negative group values are stacked and normalized to 100%; negative values produce a chart error. |
| `normalize_gross` | Signed values use `value / sum(abs(value))` per X and diverge around zero. |
| `normalize_net` | Signed values use `value / abs(sum(value))` per X and diverge around zero; a zero net sum is an error. |

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

Every normalization mode requires `group` or `color`. `normalize_gross` and
`normalize_net` automatically use a percentage axis and add the calculated
`Gross share` or `Net contribution` beside the original Y value in the shared
tooltip. Net contributions may exceed ±100%; the axis expands to include them.
Without a series field, `zero` produces a normal single-series bar chart.
`LineChart` does not accept `stack`.
With a dimension parameter set to `none`, all rows use the empty-string group,
so the chart has one series and may show a blank legend item. Its dynamic
legend title ends in `Nothing`.

Chart `format="percent"` formats quantitative axes as percentages and heatmap
legends/tooltips as percentages. Other chart formatting and `currency` remain
reserved for future adapter work. Number and currency formatting is implemented
for `BigValue`; table cells use basic automatic number formatting.

Examples:

```md
<Text
  title="About this report"
  text="Revenue is shown after refunds."
/>

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
  marker="circle"
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

### Sticky sidebar

Move global controls into a persistent sidebar with `placement="sidebar"`:

```md
<Filters
  params="date_range,country"
  title="Global filters"
  placement="sidebar"
/>

<Text
  text="Revenue is shown after refunds."
  placement="sidebar"
/>
```

Multiple sidebar `Filters` and `Text` components are collected into one `<aside>`.
This lets text cards label, explain, or visually separate groups of controls. On
desktop it stays visible while report content scrolls and receives its own
vertical scrollbar when necessary. Below 900 px it moves above the content and
becomes a collapsible `Report controls` section. If the sidebar contains any
`Filters` components, it shows one reset button for all sidebar filter
parameters.

Sidebar components must be top-level. They cannot be placed inside a `Row` or
`Tab`. Regular `placement="content"` filters and text may appear at top level,
inside a row, or inside a tab.

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
<LoadingMetrics />

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
- Malformed source files, missing files/columns, invalid freshness timestamps, malformed
  templates, unknown SQL relations, and dependency cycles stop the build.
- Stale data, an omitted report timezone, and timezone-naive CSV timestamps are
  warnings rather than build failures.
- The generated HTML embeds the complete source files. Anyone who can open the
  report can extract its data; do not distribute data the recipient should not
  possess.
- `artifact.content_sha256` identifies canonical report content using the
  report source, source hashes, and tool/runtime versions. It excludes build
  time. The CLI separately reports the SHA-256 of the finished HTML.

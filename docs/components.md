# Components reference

Components are self-closing declarations in the Markdown body:

```md
<BigValue query="summary" value="revenue" title="Revenue" />
```

Declarations may span lines. Attribute parsing is shell-like, so quote values,
especially values containing spaces. Unknown component types and attributes are
rejected.

## Common component rules

Every component accepts the optional common attribute `id` in addition to the
attributes listed below.

| Attribute | Required | Default | Contract |
| --- | --- | --- | --- |
| `id` | no | `component_NNN` | Unique identifier. Must be an identifier such as `monthly_revenue`; used as the HTML section ID. |

Automatic IDs follow component source order starting at `component_001`.
Explicit and automatic IDs must not collide.

Components with a `query` attribute must reference an existing `kind=query`
SQL block. A `kind=view` cannot be rendered. Column attributes are validated by
DuckDB/rendering at runtime, so misspelled result columns can produce empty
values or chart errors rather than build-time validation errors.

## Component summary

| Component | Required attributes | Optional attributes |
| --- | --- | --- |
| [`Filters`](#filters) | `params` | `id`, `title`, `placement` |
| [`Text`](#text) | `text` | `id`, `title`, `placement` |
| [`DataStatus`](#datastatus) | — | `id` |
| [`VersionBadge`](#versionbadge) | — | `id` |
| [`LoadingMetrics`](#loadingmetrics) | — | `id`, `title`, `placement` |
| [`BigValue`](#bigvalue) | `query`, `value` | `id`, `title`, `format`, `currency`, `notation`, `compare_value`, `delta`, `delta_label`, `direction` |
| [`Table`](#table) | `query` | `id`, `title`, `columns` |
| [`LineChart`](#linechart) | `query`, `x`, `y` | `id`, `title`, `format`, `currency`, `group`, `color`, `details`, `marker`, `color_scheme`, `color_direction` |
| [`BarChart`](#barchart) | `query`, `x`, `y` | `id`, `title`, `format`, `currency`, `group`, `color`, `details`, `stack`, `bar_width` |
| [`Heatmap`](#heatmap) | `query`, `x`, `y`, `value` | `id`, `title`, `format`, `color_scheme`, `color_direction`, `show_values`, `show_percent_sign`, `row_metric`, `row_metric_title`, `row_metric_format`, `row_metric_notation`, `row_metric_currency` |

## `Filters`

Renders declared parameters in the listed order.

```md
<Filters
  params="order_dates,country,breakdown"
  title="Report controls"
  placement="sidebar"
/>
```

| Attribute | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `params` | comma-separated names | yes | — | Every name must exist under frontmatter `params`. Whitespace around names is ignored. |
| `title` | string | no | `Filters` | Heading. A configured non-empty value replaces the default. |
| `placement` | enum | no | `content` | `content` or `sidebar`. |

An empty comma-separated list is accepted but renders no controls. Reusing a
parameter in several `Filters` components creates synchronized controls over
one shared state.

Each content `Filters` component renders a compact reset button in its header.
The button restores only the parameters listed by that component to their
declared `default` values. Sidebar `Filters` components do not render individual
reset buttons; if the sidebar contains filters, the sidebar renders one reset
button for all sidebar filter parameters.

`placement: sidebar` is valid only at the top level. See
[Layout](layout.md#sticky-sidebar). Control types, defaults, dropdown behavior,
and SQL semantics are documented in [Parameters](parameters.md).

## `Text`

Renders plain text in a card.

```md
<Text
  title="Definition"
  text="Revenue is net of refunds."
  placement="content"
/>
```

| Attribute | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `text` | non-empty string | yes | — | Visible body text. |
| `title` | string | no | — | Optional heading. |
| `placement` | enum | no | `content` | `content` or `sidebar`. |

The value is inserted using `textContent`: Markdown and HTML are not
interpreted. Whitespace is preserved by the report stylesheet. Use separate
`Text` components for multiple paragraphs or sidebar sections.

## `DataStatus`

```md
<DataStatus />
```

Accepts only the common optional `id`. It shows:

- overall check result (`Checks: passed` or warnings);
- report build timestamp;
- effective report timezone;
- one compact row per data source with source name, configured data-through
  timestamp, configured processing timestamp, and row count.

It renders as a compact status line, similar to `VersionBadge`. Timestamps are
formatted in the report timezone for display; the original ISO 8601 value is
kept in the underlying `<time datetime>` attribute and browser title. Date-only
freshness values such as `2026-07-01` are displayed as dates, without timezone
conversion or timezone warnings. Freshness warnings do not prevent the report
from rendering.

## `VersionBadge`

```md
<VersionBadge />
```

Accepts only the common optional `id`. It displays the motor tool version and
artifact ID from the embedded manifest.

## `LoadingMetrics`

```md
<LoadingMetrics />
```

Renders runtime loading timings collected in the browser while the report opens.
It is useful for diagnosing slow startup and comparing data/query changes.

| Attribute | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `title` | string | no | — | Optional heading. |
| `placement` | enum | no | `content` | `content` or `sidebar`. |

The component shows:

- total startup time;
- one row per measured step;
- duration for completed steps;
- detail text such as source size, result row count, option count, cache hit, or
  error message.

Measured startup steps include manifest parsing, source decompression, DuckDB
worker/WASM initialization, source import, filter option queries, initial SQL
views/queries, and initial report rendering. The same snapshot is also exposed
for debugging as `window.__motorLoadingMetrics`.

`placement: sidebar` is valid only at the top level. See
[Layout](layout.md#sticky-sidebar).

## `BigValue`

Displays one value from the first query row and optionally compares it with
another column in the same row.

```md
<BigValue
  query="revenue_kpi"
  value="current_revenue"
  compare_value="previous_revenue"
  title="Revenue"
  format="currency"
  currency="RUB"
  notation="compact"
  delta="both"
  delta_label="vs previous month"
  direction="higher_is_better"
/>
```

| Attribute | Type | Required | Default | Allowed values / behavior |
| --- | --- | --- | --- | --- |
| `query` | SQL block name | yes | — | Existing `kind=query`. |
| `value` | result column | yes | — | Value from the first row. |
| `title` | string | no | — | Card heading. |
| `format` | enum | no | `number` | `number`, `currency`, or `percent`. |
| `currency` | string | no | `USD` | ISO 4217 code used when `format="currency"`. Invalid codes cause browser formatting errors. |
| `notation` | enum | no | `compact` | `compact` or `standard`. |
| `compare_value` | non-empty result column | no | — | Baseline value from the same first row. Enables comparison attributes. |
| `delta` | enum | no | `both` | With `compare_value`: `absolute`, `percent`, or `both`. |
| `delta_label` | string | no | — | Caption rendered below the comparison. Requires `compare_value`. |
| `direction` | enum | no | `neutral` | With `compare_value`: `higher_is_better`, `lower_is_better`, or `neutral`. |

### Row selection and empty values

- Only `rows[0]` is used. Shape the result with aggregation or explicit
  `ORDER BY ... LIMIT 1`.
- Missing, `NULL`, or empty current values render `—`.
- If current is empty, no comparison is rendered.
- Missing, `NULL`, or empty comparison values silently omit the comparison.
- Zero is a real value, not an empty value.
- Non-numeric current or comparison values can display as a main value, but
  comparison output is omitted unless both convert to finite numbers.

### Number formatting

Formatting uses the browser locale through `Intl.NumberFormat`:

- `number` displays a localized number.
- `currency` uses `currency`, defaulting to `USD`.
- `percent` expects a fraction: `0.425` renders approximately `42.5%`.
- `compact` uses localized abbreviations and at most one fractional digit;
  for example, a Russian locale may render `15123123` as `15,1 млн`.
- `standard` disables compact abbreviation.
- Absolute deltas inherit `format`, `currency`, and `notation`.

### Comparison calculation

Let `current = value` and `previous = compare_value`:

- absolute delta is `current - previous`;
- percentage delta is `(current - previous) / abs(previous)`;
- when `previous` is zero, percentage delta renders `—`;
- `both` displays absolute delta, a separator, and percentage delta.

`direction` changes semantic coloring only. Positive is good for
`higher_is_better`; negative is good for `lower_is_better`; `neutral` colors
neither direction as good or bad. Period selection and joins belong in SQL.

## `Table`

```md
<Table
  query="revenue_by_country"
  columns="country,revenue,orders"
  title="Country detail"
/>
```

| Attribute | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `query` | SQL block name | yes | — | Existing `kind=query`. |
| `title` | string | no | — | Card heading. |
| `columns` | comma-separated result columns | no | first-row key order | Display projection and order. Whitespace is trimmed. |

All query rows are rendered in query order. If there are no rows, the card
shows `No rows`. Values are formatted automatically: numeric JavaScript values
use localized number formatting, null uses `—`, and other values become text.
Missing configured columns render `—`. Table headers are exact column names;
renaming and presentation formatting should currently be done in SQL.

## Shared chart behavior

`LineChart` and `BarChart` share these concepts:

- `x` references the horizontal result column.
- `y` references a quantitative result column.
- `group` splits observations into series and colors each series.
- `color` assigns categorical color without all layout semantics of `group`.
- If both `group` and `color` are set, `group` takes precedence.
- `details` is a comma-separated list of additional result columns shown only
  in the tooltip.
- Charts are responsive, container-width, 300 px high, and use SVG.
- Tooltips show data under the pointer.
- `format="percent"` treats Y values as fractions and formats the Y axis as
  percentages.
- Other `format` strings and `currency` are currently accepted on line/bar
  charts but do not change rendering. Currency chart axes are not implemented;
  format or scale values in SQL if needed.

When `group` or `color` is configured, line and bar charts use a shared tooltip
for the hovered X value. It lists every query row with that same X as
`series: value`, with a swatch taken from the chart's actual color scale. This
makes one month show all cohorts, channels, countries, or other series at once.
Tooltip values respect `format="percent"`; currency values use `currency` even
though currency axis formatting is not yet implemented. Query results should
contain at most one row per X/series pair to avoid duplicate series lines in
the tooltip. The row belonging to the mark directly under the cursor is
highlighted with a background and accent while other rows are slightly muted.
This does not reorder the list: tooltip rows always retain their query-result
order. Charts without `group`, `color`, or `details` retain the ordinary
single-mark tooltip.

Shared line/bar tooltips use the same table layout with or without `details`.
When `details` is configured, detail labels are rendered once as extra column
headers, and each series row contains only the corresponding values. The fields
are read from the query result. They do not affect grouping, color, stacking,
axes, or query dependencies. Labels are generated from field names, for example
`cohort_size` becomes `Cohort size`. Missing or empty values render as `—`.

X-axis type is inferred from the first non-null X value. ISO `YYYY-MM-DD` and
ISO datetime strings use a temporal axis, except side-by-side grouped bars,
which use a discrete axis. Date-only temporal labels render as `YYYY-MM-DD`.
Other values use a nominal axis.

## `LineChart`

```md
<LineChart
  query="revenue_by_day"
  x="day"
  y="revenue"
  group="country"
  marker="circle"
  title="Revenue by day"
/>
```

| Attribute | Type | Required | Default | Allowed values / behavior |
| --- | --- | --- | --- | --- |
| `query` | SQL block name | yes | — | Existing `kind=query`. |
| `x` | result column | yes | — | Horizontal field. |
| `y` | result column | yes | — | Quantitative vertical field. |
| `title` | string | no | — | Card heading. |
| `group` | result column | no | — | Creates separate colored lines. |
| `color` | result column | no | — | Categorical color field; ignored when `group` is set. |
| `details` | comma-separated result columns | no | — | Extra fields displayed below each tooltip series row. |
| `marker` | enum | no | `none` | `none`, `point`, or `circle`. |
| `color_scheme` | non-empty string | no | — | Vega sequential scheme; requires `group` or `color`. |
| `color_direction` | enum | conditional | `higher_is_darker` | Requires `color_scheme`; `higher_is_darker` or `lower_is_darker`. |
| `format` | string | no | — | Only `percent` currently changes rendering. |
| `currency` | string | no | — | Reserved; currently no chart effect. |

Markers:

- `none` draws only lines.
- `point` draws hollow markers at observations.
- `circle` draws filled markers.
- Every mode includes a larger invisible point hit area, so hover tooltips do
  not require pixel-perfect pointer placement.
- On a grouped line chart, hitting any series point opens the shared tooltip
  containing all series at that X, not only the nearest series.

Sequential color is useful for cohorts:

```md
<LineChart
  query="retention"
  x="period_number"
  y="retention"
  group="cohort_month"
  format="percent"
  color_scheme="blues"
  color_direction="higher_is_darker"
/>
```

Color fields are sorted ascending before applying the scheme. Reversing the
direction reverses the scale. Any Vega scheme name may be supplied, including
`blues`, `greens`, `viridis`, `magma`, `inferno`, and `cividis`; an unknown
scheme becomes an in-report chart rendering error.

## `BarChart`

```md
<BarChart
  query="revenue_by_day"
  x="day"
  y="revenue"
  group="country"
  stack="zero"
  bar_width="24"
  title="Revenue by day"
/>
```

| Attribute | Type | Required | Default | Allowed values / behavior |
| --- | --- | --- | --- | --- |
| `query` | SQL block name | yes | — | Existing `kind=query`. |
| `x` | result column | yes | — | Horizontal field. |
| `y` | result column | yes | — | Quantitative vertical field. |
| `title` | string | no | — | Card heading. |
| `group` | result column | no | — | Series color; also controls side-by-side offset for `stack="none"`. |
| `color` | result column | no | — | Series color without grouped-bar offset; ignored when `group` is set. |
| `details` | comma-separated result columns | no | — | Extra fields displayed below each tooltip series row. |
| `stack` | enum | no | `zero` | `zero`, `none`, `normalize`, `normalize_gross`, or `normalize_net`. |
| `bar_width` | positive finite number | no | axis-specific | Explicit bar width in pixels. |
| `format` | string | no | — | Only `percent` currently changes rendering. |
| `currency` | string | no | — | Reserved; currently no chart effect. |

Stack modes:

| Value | Behavior |
| --- | --- |
| `zero` | Ordinary stacking from zero. Series values accumulate and total bar height is their sum. Default. |
| `none` | No stacking. With `group`, series bars are placed side by side using a discrete X axis. With only `color`, same-X bars can overlap. |
| `normalize` | Standard non-negative composition. Stacks series and normalizes each X category to 100%. Negative Y values produce a chart error. Requires `group` or `color`. |
| `normalize_gross` | Signed gross share: `value / sum(abs(value))` within each X. Positive series stack above zero and negative series below it; the total absolute span is 100%. Requires `group` or `color`. |
| `normalize_net` | Signed contribution to the net result: `value / abs(sum(value))` within each X. Positive series stack above zero and negative series below it. Contributions can exceed 100%; a zero net sum produces a chart error. Requires `group` or `color`. |

All normalization modes automatically format the Y axis as percentages. For
`normalize_gross` and `normalize_net`, the shared tooltip keeps the original Y
column and adds `Gross share` or `Net contribution` as a separate percentage
column. Null and non-numeric Y values do not contribute to denominators and
remain empty. An all-zero gross stack renders at zero height; a net-normalized
stack whose signed sum is zero cannot be defined and reports an error suggesting
`normalize_gross` or `zero`.

`normalize_net` answers how each series contributes to the signed net result.
For example, `+120` and `-20` become `+120%` and `-20%`. If the net is close to
zero, percentages can become very large; the axis expands rather than clipping
them to ±100%.

Without a series field, `zero` behaves as a normal single-series bar chart.
Temporal X axes use a default width of 18 px. Nominal axes let Vega-Lite choose
band width. `bar_width` overrides either behavior and must be greater than zero.

## `Heatmap`

Renders one rectangular cell per query row.

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
  row_metric_format="number"
  row_metric_notation="standard"
  title="Retention heatmap"
/>
```

| Attribute | Type | Required | Default | Allowed values / behavior |
| --- | --- | --- | --- | --- |
| `query` | SQL block name | yes | — | Existing `kind=query`. |
| `x` | result column | yes | — | Discrete cell column, sorted ascending. |
| `y` | result column | yes | — | Discrete cell row, sorted ascending. |
| `value` | result column | yes | — | Quantitative color value. |
| `title` | string | no | — | Card heading. |
| `format` | enum | no | `number` | `number` or `percent`. Percent expects a fraction. |
| `color_scheme` | non-empty string | no | `blues` | Vega sequential scheme used when all values are non-negative. |
| `color_direction` | enum | no | `higher_is_darker` | Sequential-scale direction: `higher_is_darker` or `lower_is_darker`. |
| `show_values` | boolean | no | `true` | `true` draws the formatted value inside every non-null cell; `false` leaves cells unlabelled. |
| `show_percent_sign` | boolean | no | `true` | With `format="percent"`, controls only the `%` suffix inside cells. `false` still scales fractions by 100: `0.425` renders as `42.5`. Tooltips and the legend keep `%`. Explicit use requires `format="percent"`. |
| `row_metric` | result column | no | — | Adds one neutral numeric column to the left of the colored cells, with one value per distinct `y`. |
| `row_metric_title` | non-empty string | no | exact `row_metric` | Header and tooltip label for the additional column. Requires `row_metric`. |
| `row_metric_format` | enum | no | `number` | `number`, `percent`, or `currency`. Requires `row_metric`. Percent expects a fraction. |
| `row_metric_notation` | enum | no | `standard` | `standard` shows the full localized number; `compact` abbreviates it, for example `15.2K` or the locale equivalent. Requires `row_metric`. |
| `row_metric_currency` | ISO 4217 code | no | `USD` for currency | Three-letter currency code such as `RUB` or `EUR`. Accepted only with `row_metric_format="currency"`. |

The legend and tooltip use percent formatting when requested. Missing rows
produce empty cells; a zero value remains a real colored cell. Cells have white
borders and tooltips containing Y, X, and value. Unknown color schemes are
reported as chart rendering errors inside a non-negative report.

When every finite value is non-negative, Heatmap uses the configured sequential
`color_scheme` and `color_direction`. As soon as the result contains a negative
value, motor automatically switches to a zero-centered diverging scale:

- negative values become darker red as they approach the shared negative limit;
- zero is neutral light gray;
- positive values become darker blue as they approach the shared positive limit;
- the scale is symmetric: motor calculates
  `limit = max(abs(minimum), abs(maximum))` and uses the domain
  `[-limit, 0, limit]`;
- equal absolute values therefore have equal color intensity on the red and
  blue sides, while the shorter observed side uses only part of its available
  gradient;
- `color_scheme` and `color_direction` are ignored in this mode to preserve the
  fixed red-negative/blue-positive meaning.

An entirely negative result still reserves the equally sized positive half of
the scale even though no positive cells use it. Null, empty, and non-finite
values are excluded when deciding the color domain.

Value labels are enabled by default and use a 10 px normal-weight font. Percent
labels use one decimal place; number labels use thousands separators and at
most two decimal places. `show_percent_sign="false"` removes only the `%`
character from percent cell labels while retaining percent scaling. The legend
and tooltips remain explicitly formatted as percentages. Label text color is
derived from the actual cell color: a darker shade of the same hue is used on
light cells and a lighter shade on dark cells. motor checks the contrast ratio
and falls back to black or white when the tinted variant would be insufficient;
labels have no outline. Set `show_values="false"` when cells are too narrow or
the heatmap is intended to show only the color pattern.

Heatmap height remains at least 300 px and grows when necessary to reserve
approximately 34 px for every distinct Y value. A large cohort matrix therefore
becomes taller instead of compressing row labels and cell values until they no
longer fit.

### Row metric

`row_metric` displays a numeric value that belongs to the entire heatmap row,
such as cohort size, sample size, or row total. It is rendered in a neutral
column between the Y-axis labels and the first colored cell and never affects
the heatmap color domain or legend. The column is approximately 82 px wide;
use compact notation when a full formatted value does not fit comfortably. Its
row order is exactly the Heatmap Y order. The same full, non-compact value is
also included in cell and row-metric tooltips.

The query remains at the normal one-row-per-Y-and-X grain:

```sql
select
    cohort_month,
    period_number,
    cohort_size,
    retention
from cohort_retention
```

For each distinct Y value, the metric may be repeated on every X row or be
non-null on only one row. All non-null occurrences for the same Y must be
numeric and equal. A missing metric renders `—`; a non-numeric value or two
different values for the same Y make that Heatmap card show a chart-rendering
error identifying the field and Y value.

`row_metric_notation="compact"` changes only the visible side-column value.
The query result and tooltip retain the full value. Currency defaults to USD;
set `row_metric_currency` whenever a different currency is intended.

Retention calculation remains SQL responsibility. Return one row per cohort
and period and a fraction from 0 to 1 when using percent formatting.

## Dynamic dimension legends

For `LineChart` and `BarChart`, motor updates a legend title when all these
conditions hold:

1. the query uses `{{ dimension(parameter) }} AS stable_alias`;
2. the chart's effective `group` or `color` equals `stable_alias`;
3. the selected parameter value resolves to a declared choice or `none`.

The title is `<parameter label>: <choice label>`, for example `Group by:
Country`. For `none`, the choice label is `Nothing`. This behavior needs no
separate `color_param` attribute.

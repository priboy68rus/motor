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
| [`BigValue`](#bigvalue) | `query`, `value` | `id`, `title`, `format`, `currency`, `notation`, `compare_value`, `delta`, `delta_label`, `direction` |
| [`Table`](#table) | `query` | `id`, `title`, `columns` |
| [`LineChart`](#linechart) | `query`, `x`, `y` | `id`, `title`, `format`, `currency`, `group`, `color`, `marker`, `color_scheme`, `color_direction` |
| [`BarChart`](#barchart) | `query`, `x`, `y` | `id`, `title`, `format`, `currency`, `group`, `color`, `stack`, `bar_width` |
| [`Heatmap`](#heatmap) | `query`, `x`, `y`, `value` | `id`, `title`, `format`, `color_scheme`, `color_direction`, `show_values` |

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

- overall check result (`Checks passed` or warning);
- latest configured data time across sources, or `Not configured`;
- latest configured processing time across sources, or `Not configured`;
- report build timestamp.

Freshness warnings do not prevent the report from rendering.

## `VersionBadge`

```md
<VersionBadge />
```

Accepts only the common optional `id`. It displays the motor tool version and
artifact ID from the embedded manifest.

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
the tooltip. Charts without `group` or `color` retain the ordinary single-mark
tooltip.

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
| `stack` | enum | no | `zero` | `zero`, `none`, or `normalize`. |
| `bar_width` | positive finite number | no | axis-specific | Explicit bar width in pixels. |
| `format` | string | no | — | Only `percent` currently changes rendering. |
| `currency` | string | no | — | Reserved; currently no chart effect. |

Stack modes:

| Value | Behavior |
| --- | --- |
| `zero` | Ordinary stacking from zero. Series values accumulate and total bar height is their sum. Default. |
| `none` | No stacking. With `group`, series bars are placed side by side using a discrete X axis. With only `color`, same-X bars can overlap. |
| `normalize` | Stacks series and normalizes each X category to 100%. Requires `group` or `color`. |

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
| `color_scheme` | non-empty string | no | `blues` | Vega sequential scheme name. |
| `color_direction` | enum | no | `higher_is_darker` | `higher_is_darker` or `lower_is_darker`. |
| `show_values` | boolean | no | `true` | `true` draws the formatted value inside every non-null cell; `false` leaves cells unlabelled. |

The legend and tooltip use percent formatting when requested. Missing rows
produce empty cells; a zero value remains a real colored cell. Cells have white
borders and tooltips containing Y, X, and value. Unknown color schemes are
reported as chart rendering errors inside the report.

Value labels are enabled by default. Percent labels use one decimal place;
number labels use thousands separators and at most two decimal
places. Their text color is derived from the actual cell color: a darker shade
of the same hue is used on light cells and a lighter shade on dark cells. motor
checks the contrast ratio and falls back to black or white when the tinted
variant would be insufficient; labels have no outline. Set
`show_values="false"` when cells are too narrow or the heatmap is intended to
show only the color pattern.

Heatmap height remains at least 300 px and grows when necessary to reserve
approximately 34 px for every distinct Y value. A large cohort matrix therefore
becomes taller instead of compressing row labels and cell values until they no
longer fit.

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

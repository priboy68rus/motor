# Parameters and filters

Parameters are named pieces of shared report state. Declare them under
frontmatter `params`, expose them through one or more `Filters` components, and
reference them from SQL template helpers. Parameter names must be identifiers.

## Common fields

Unknown fields are rejected.

| Field | Type | Applies to | Required | Default | Contract |
| --- | --- | --- | --- | --- | --- |
| `type` | enum | all | yes | — | `select`, `multiselect`, `date_range`, or `dimension`. |
| `label` | non-empty string | all | no | generated from name | Control label. Underscores become spaces and the first character is capitalized. |
| `default` | type-specific | all | dimension only | `all` except dimension | Initial runtime value. |
| `options` | mapping | select, multiselect | yes | — | Source column used to load allowed UI values. |
| `empty_behavior` | enum | select, multiselect | no | `none` | SQL behavior for null or an empty selection: `all` or `none`. |
| `control` | enum | select, multiselect | no | type-specific | Visual control mode. |
| `choices` | mapping | dimension | yes | — | Static allowlist mapping choice names to SQL fields. |
| `allow_none` | boolean | dimension | no | `false` | Adds a `Nothing` choice that substitutes an empty SQL string. |

Fields accepted by only one group of parameter types cannot be declared on
other types. For example, `date_range` rejects `options`, `empty_behavior`, and
`control`; non-dimension parameters reject `choices` and `allow_none`.

The compiler validates dimension defaults completely. It does not currently
check a select/multiselect default against loaded source options or validate
the internal shape of a date-range default. Use the documented shapes below;
an invalid value can produce a `None` control summary or a runtime SQL error.

## `select`

A single source-value filter. Its runtime value is one scalar value or the
special string `all`.

```yaml
params:
  region:
    type: select
    label: Region
    default: all
    empty_behavior: none
    control: dropdown
    options:
      source: orders
      column: region
```

| Field | Required | Default | Allowed values / shape |
| --- | --- | --- | --- |
| `type` | yes | — | `select` |
| `label` | no | generated | Non-empty string. |
| `default` | no | `all` | `all` or one scalar source value. |
| `options` | yes | — | `{source: <data name>, column: <column name>}` |
| `empty_behavior` | no | `none` | `none` or `all` |
| `control` | no | `dropdown` | `dropdown`, `radio`, or `auto` |

Control modes:

| Value | Behavior |
| --- | --- |
| `dropdown` | Searchable overlay containing radio buttons. It closes after selection. |
| `radio` | All radio buttons are displayed inline. |
| `auto` | Inline radio buttons for at most 8 source options; dropdown for 9 or more. |

Opening any select, multiselect, or dimension dropdown closes every other open
filter dropdown in the report.

`All` is always offered and sets the runtime value to `all`, disabling an
`in_filter` predicate. `select` never emits an array.

## `multiselect`

A multiple source-value filter. Its runtime value is an array of scalar values
or the special string `all`.

```yaml
params:
  country:
    type: multiselect
    label: Countries
    default: [DE, FR]
    empty_behavior: none
    control: auto
    options:
      source: orders
      column: country
```

| Field | Required | Default | Allowed values / shape |
| --- | --- | --- | --- |
| `type` | yes | — | `multiselect` |
| `label` | no | generated | Non-empty string. |
| `default` | no | `all` | `all` or a YAML list of source values. |
| `options` | yes | — | `{source: <data name>, column: <column name>}` |
| `empty_behavior` | no | `none` | `none` or `all` |
| `control` | no | `auto` | `auto`, `checkboxes`, or `dropdown` |

Control modes:

| Value | Behavior |
| --- | --- |
| `auto` | Inline checkboxes for at most 8 source options; dropdown for 9 or more. |
| `checkboxes` | All checkboxes are displayed inline. |
| `dropdown` | Searchable checkbox overlay with `All`, `None`, one-value, or count summary. |

Opening any select, multiselect, or dimension dropdown closes every other open
filter dropdown in the report.

Selection behavior:

- Selecting `All` clears individual choices and stores `all`.
- Selecting an individual choice clears `All`.
- With `empty_behavior: none`, clearing the last choice stores `[]` and
  `in_filter` renders `FALSE`.
- With `empty_behavior: all`, clearing the last choice returns the control to
  `All` and `in_filter` renders `TRUE`.

## Options source

`select` and `multiselect` require:

```yaml
options:
  source: orders
  column: country
```

| Field | Required | Contract |
| --- | --- | --- |
| `source` | yes | Must name a configured CSV source. Named SQL views and queries cannot supply options. |
| `column` | yes | Must exist in the source CSV header. |

At runtime motor runs the equivalent of:

```sql
SELECT DISTINCT column AS value
FROM source
WHERE column IS NOT NULL
ORDER BY 1
```

Options are loaded once when the report starts. They are sorted, distinct,
non-null, and are not cascading: changing one parameter does not recalculate
another parameter's option list. Dropdown search only hides non-matching UI
labels; it does not query DuckDB.

## `date_range`

A pair of browser date inputs used with `between_filter`.

```yaml
params:
  order_dates:
    type: date_range
    label: Order dates
    default:
      start: "2026-06-01"
      end: "2026-06-30"
```

| Field | Required | Default | Allowed values / shape |
| --- | --- | --- | --- |
| `type` | yes | — | `date_range` |
| `label` | no | generated | Non-empty string. |
| `default` | no | `all` | `all` or `{start: YYYY-MM-DD, end: YYYY-MM-DD}`. |

It does not accept `options`, `empty_behavior`, `control`, `choices`, or
`allow_none`.

`default: all` disables the predicate until both dates have been selected. The
control emits a change only when both inputs are non-empty. `between_filter`
includes the entire end date by rendering a lower-inclusive and next-day
upper-exclusive interval.

## `dimension`

A dimension parameter chooses which allowlisted SQL field is substituted into
a query. It changes grouping or coloring; it does not filter rows.

```yaml
params:
  breakdown:
    type: dimension
    label: Group by
    default: country
    allow_none: true
    choices:
      country:
        label: Country
        field: country
      product_type:
        field: product_type
      transaction_type:
        label: Purchase / return
        field: facts.transaction_type
```

| Field | Required | Default | Allowed values / shape |
| --- | --- | --- | --- |
| `type` | yes | — | `dimension` |
| `label` | no | generated | Non-empty string. |
| `default` | yes | — | A declared choice name, or `none` when enabled. |
| `choices` | yes | — | Non-empty mapping of choice names to choice objects. |
| `allow_none` | no | `false` | Boolean. |

It does not accept `options`, `empty_behavior`, or `control`. The control is
always a searchable radio-button dropdown.

Opening a dimension dropdown closes every other open select, multiselect, or
dimension dropdown in the report.

Choice contract:

| Field | Required | Default | Contract |
| --- | --- | --- | --- |
| choice name | yes | — | Identifier used as the parameter value. `none` is reserved. |
| `field` | yes | — | Simple or dotted SQL identifier such as `country` or `facts.country`. Raw SQL is rejected. |
| `label` | no | exact `field` | Non-empty text displayed in the control and dynamic legend title. |

With `allow_none: true`, the UI adds `Nothing`. `default: none` is valid only
in this mode. `{{ dimension(breakdown) }}` then emits the SQL literal `''`, so
all rows share one empty-string group. Charts can consequently show a blank
legend swatch; this is expected.

When the stable alias produced by `dimension()` is used as a chart `group` or
`color`, the legend title becomes `<parameter label>: <choice label>`. Missing
labels fall back to the generated parameter label and choice `field`.

## Rendering parameters with `Filters`

```md
<Filters
  params="order_dates,country,breakdown"
  title="Report controls"
  placement="sidebar"
/>
```

`params` is a comma-separated list of declared names. Controls render in list
order. See the complete [`Filters` component contract](components.md#filters).

A parameter may appear in multiple `Filters` components. All instances share
one state and are synchronized after a change.

## Reactivity and scope

- A query depends on a parameter when it uses that parameter directly in a
  helper or depends on a named SQL block that does.
- Changing a parameter reruns affected visible `kind=query` results and their
  dependency closure.
- Unaffected queries and components are not rerun.
- Hidden tabs defer their queries until opened and use the latest parameter
  values at that time.
- Placement does not create scope. A filter inside a tab is local only by
  convention; it affects every active query whose dependency graph references
  the parameter.
- motor never inserts implicit `WHERE` clauses. Shared filtering must be
  expressed in SQL, usually in a reusable `kind=view` block.

See [SQL template helpers](sql.md#template-helpers) for exact rendered SQL.

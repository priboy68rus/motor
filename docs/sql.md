# SQL reference

motor executes DuckDB SQL in the browser through DuckDB-WASM. CSV and Parquet
sources are loaded as tables, named `view` blocks build reusable relations, and named
`query` blocks return rows to components.

## Named SQL blocks

Use a fenced block with metadata on the opening line:

````md
```sql name=filtered_orders kind=view
select *
from orders
```
````

| Option | Required | Default | Allowed values / contract |
| --- | --- | --- | --- |
| `name` | yes | — | Unique identifier. It cannot duplicate a source or another SQL block. |
| `kind` | no | `query` | `view` or `query`. |

The shorthand ```` ```sql filtered_orders ```` is accepted and means
`name=filtered_orders kind=query`. Metadata is shell-like: quoted values parse,
but SQL names must still be identifiers. Unknown and duplicate options are
rejected. The block must contain non-empty SQL and close with a line containing
exactly the closing triple backticks after optional whitespace.

SQL blocks are removed from the visible body during compilation and may be
declared anywhere after frontmatter.

## `view` and `query`

### `kind=view`

- Executed as `CREATE OR REPLACE VIEW "name" AS <rendered SQL>`.
- Intended for reusable intermediate datasets and shared filtering.
- May depend on sources, earlier or later named blocks, parameters, and local
  CTEs; motor determines dependency order independently of source order.
- Cannot be referenced directly by a component.
- Is recreated when its dependency closure executes.

### `kind=query`

- Executed as ordinary SQL and returns all result rows to components.
- Is the only kind accepted by a component's `query` attribute.
- Results are cached in memory by artifact identity, query name, rendered SQL,
  and relevant parameter values for the lifetime of the open page.
- Multiple components may consume the same query result.

Use a view for a reusable row-level dataset and a query for the final shape a
component needs:

````md
```sql name=filtered_orders kind=view
select *
from orders
where {{ in_filter("country", country) }}
```

```sql name=revenue_by_country kind=query
select country, sum(revenue) as revenue
from filtered_orders
group by country
order by revenue desc
```
````

## Relations and dependency graph

motor analyzes relation names following `FROM` and `JOIN`.

- A relation must be a configured data source, another named SQL block, or a
  CTE local to the current block.
- Every SQL block must reach at least one configured data source directly or
  through named dependencies.
- Unknown relations, cyclic named dependencies, and source/query name
  conflicts stop the build.
- Source and parameter dependencies propagate through named SQL blocks. A final
  query therefore reacts to parameters used by an upstream view.
- SQL block declaration order does not determine execution order.

DuckDB CTEs work normally and are scoped to one block:

```sql
with by_month as (
  select date_trunc('month', created_at) as month, sum(gmv) as gmv
  from orders
  group by 1
)
select *
from by_month
order by month
```

Use a named `kind=view` instead when more than one SQL block must reuse the
intermediate relation.

The dependency analyzer intentionally supports ordinary table references. SQL
that obtains relations through table-producing functions, dynamic SQL, or
unusual quoting may not be recognized even if DuckDB itself accepts it. A
normal report should enter through a configured source table.

## Template helpers

Arbitrary Jinja, variables, expressions, and user-defined helpers are rejected.
Only these expressions are supported:

```sql
{{ in_filter("column", parameter) }}
{{ between_filter("column", parameter) }}
{{ dimension(parameter) }}
```

Whitespace inside `{{ ... }}` is flexible. Helper and parameter names are
case-sensitive. Column arguments to filter helpers must be quoted simple or
dotted identifiers such as `"country"` or `"facts.country"`.

### `in_filter`

Accepts a `select` or `multiselect` parameter and renders one SQL predicate:

| Runtime value | Rendered result |
| --- | --- |
| `all` | `TRUE` |
| scalar `DE` | `"column" IN ('DE')` |
| list `[DE, FR]` | `"column" IN ('DE', 'FR')` |
| null or empty list with `empty_behavior: none` | `FALSE` |
| null or empty list with `empty_behavior: all` | `TRUE` |

Numbers are emitted as finite numeric literals, booleans as `TRUE`/`FALSE`,
and other values as escaped SQL strings. Identifier segments are double-quoted.
Use the helper as a complete predicate:

```sql
where {{ in_filter("orders.country", country) }}
```

### `between_filter`

Accepts a `date_range` parameter. `all` renders `TRUE`; a selected range
renders the equivalent of:

```sql
"created_at" >= '2026-06-01'
AND "created_at" < (CAST('2026-06-30' AS DATE) + INTERVAL 1 DAY)
```

The interval includes every timestamp on the end date. A non-`all` value
without both `start` and `end` is a runtime query error.

### `dimension`

Accepts a `dimension` parameter and emits the quoted `field` belonging to the
selected allowlisted choice. With the enabled `none` value, it emits `''`.

The helper must be followed immediately by `AS alias`; the alias may be a
simple identifier or a double-quoted identifier:

```sql
select
  date_trunc('month', created_at) as month,
  {{ dimension(breakdown) }} as breakdown,
  sum(revenue) as revenue
from orders
group by month, breakdown
```

The alias must be unique among dimension helpers in that SQL block. Components
always reference this stable alias rather than the currently selected source
field. When a chart uses it in `group` or `color`, motor can derive a dynamic
legend title from the parameter and selected choice.

## Explicit filter scope

motor never rewrites arbitrary SQL or automatically appends `WHERE` clauses.
To apply one filter to several visualizations, put the helper in a shared view:

```sql
-- kind=view
select *
from orders
where {{ in_filter("country", country) }}
  and {{ between_filter("created_at", order_dates) }}
```

Make every affected final query read that view. Queries that read the raw
source remain unfiltered.

## Result-shaping rules

Components do not aggregate, sort, choose periods, or calculate business
metrics. SQL must return their required columns and desired row order.

- `BigValue` uses the first row only. Aggregate to one row or use explicit
  `ORDER BY ... LIMIT 1`.
- Comparison periods for `BigValue` must be joined or calculated into the same
  row as the current value.
- Charts expect one row per plotted observation.
- Cohort retention and heatmap cell values are calculated in SQL.
- `Table` preserves query row order and uses all returned columns unless
  `columns` is configured.

## Execution and reactivity

At startup motor:

1. loads source CSV/Parquet files into DuckDB;
2. loads static select/multiselect options;
3. determines queries required by top-level content and the first tab of each
   tab set;
4. executes each required dependency closure in topological order;
5. renders components.

When a parameter changes, only active final queries whose propagated dependency
set contains that parameter are scheduled. Stale results receive a loading
state. If another change arrives during execution, obsolete results are not
rendered and the latest state is scheduled.

Opening a hidden tab executes its required closure. Returning to previously
seen state can reuse the in-memory query cache.

## Error diagnostics

Build-time structural errors are reported by `motor validate` and `motor
build`. DuckDB errors happen in the browser because SQL executes there.

An affected component displays:

- query name;
- DuckDB error message;
- rendered SQL after helper expansion.

If a dependency failed, downstream blocks are skipped and list the failed
dependency names. Copy the rendered SQL into DuckDB when debugging value types,
casts, aggregation, or dialect issues.

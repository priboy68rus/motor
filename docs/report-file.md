# Report file reference

## File structure

A report is one UTF-8 Markdown file with this order:

1. YAML frontmatter between `---` delimiter lines. It must start on line 1.
2. Markdown body containing named SQL blocks and component declarations.
3. Optional `Row`, `Tabs`, and `Tab` layout blocks.

Ordinary Markdown body text is preserved in the compiled specification but is
not rendered. Use the [`Text`](components.md#text) component for visible prose.
SQL blocks may appear before or after components because motor extracts and
resolves the complete report before building the layout.

## Top-level frontmatter

Unknown fields are rejected.

| Field | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `title` | string | yes | — | Non-empty title shown at the top of the report. |
| `slug` | string | yes | — | Stable artifact prefix matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. |
| `data` | mapping | yes | — | One or more named CSV or Parquet sources. |
| `spec_version` | string | no | `0.1.0` | Authoring specification version recorded as metadata. It does not currently select compiler behavior. |
| `timezone` | string | no | `UTC` | Valid IANA timezone such as `UTC` or `Europe/Moscow`. Omission emits a warning. |
| `theme` | mapping | no | `{accent: blue}` | Report interface theme. It changes motor's UI chrome but does not change chart palettes. See [Theme](#theme). |
| `update_check` | mapping | no | — | Optional latest-version check shown as a fixed top-right link when a newer artifact exists. See [Update checks](#update-checks). |
| `params` | mapping | no | `{}` | Named interactive parameters. See [Parameters](parameters.md). |

Minimal frontmatter:

```yaml
---
title: Revenue Overview
slug: revenue-overview
timezone: Europe/Moscow
data:
  orders:
    path: ./data/orders.csv
---
```

YAML follows normal YAML rules. Two-space indentation is recommended, not
mandatory. Values such as dates that must remain strings should be quoted.

### Naming rules

- Every key directly under `data` and `params` must be a Python-style
  identifier: letters or underscore first, followed by letters, digits, or
  underscores. ASCII names are recommended because source names also become
  SQL table names.
- `slug` uses lowercase ASCII letters, digits, and single hyphens between
  segments. Leading, trailing, or repeated hyphens are invalid.
- A SQL block name cannot duplicate a data-source name.
- Component IDs and SQL block names have their own identifier rules described
  on their reference pages.

## Data sources

Each entry under `data` creates a DuckDB table with the same name.

| Field | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `path` | string | yes | — | Data path resolved relative to `report.md`. Absolute paths also resolve normally. The source type is inferred from `.csv` or `.parquet`. |
| `freshness` | mapping | no | — | Optional timestamp checks and manifest metadata. |

Unknown source fields are rejected.

### CSV contract

- The file must exist and be readable during the build.
- Encoding must be UTF-8. A UTF-8 BOM is accepted.
- The delimiter is a comma and the first row is the header.
- Header names must be non-empty and unique.
- The file must contain at least one data row.
- CSV syntax errors stop the build.
- The complete original CSV bytes are compressed and embedded in the HTML.
- DuckDB detects runtime column types when the artifact opens. The manifest
  also contains motor's build-time inferred type for every column.
- Empty strings and case-insensitive `null`, `none`, and `na` are treated as
  null-like values by build-time type inference. DuckDB performs its own CSV
  detection for query execution.

The browser loads each source as a table in DuckDB's `main` schema. SQL should
normally reference it by its configured source name:

```sql
select * from orders
```

### Parquet contract

- The file must exist, be readable during the build, and use the `.parquet`
  extension.
- The build validates the Parquet magic bytes, footer metadata, row count, and
  schema.
- The file must contain at least one data row and at least one column.
- The complete original Parquet bytes are compressed and embedded in the HTML.
- The browser registers the bytes with DuckDB-WASM and creates a table from
  `read_parquet(...)` using the configured source name.
- CSV and Parquet sources can be mixed in one report and joined normally in SQL.

Build-time inferred types come from Parquet schema metadata. Nested Parquet
schemas are exposed in metadata as dot-joined leaf paths; the stable authoring
contract is flat analytical Parquet files whose leaf column names match the
columns used in SQL and filter `options`.

## Freshness

All `freshness` fields are optional. Unknown fields are rejected.

| Field | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `data_time_column` | string | no | — | Column whose ISO 8601 date or datetime values determine source `data_min_at` and `data_max_at`. |
| `processed_time_column` | string | no | — | Column whose maximum ISO 8601 date or datetime value becomes source `processed_at`. |
| `max_lag_hours` | positive number | no | — | Warn when build time minus `data_max_at` exceeds this many hours. Requires useful data only when `data_time_column` is present. |

Example:

```yaml
data:
  orders:
    path: ./data/orders.csv
    freshness:
      data_time_column: created_at
      processed_time_column: __processed_at
      max_lag_hours: 36
```

Configured columns must exist.

For CSV, each configured timestamp column must contain at least one non-empty
value, and every non-empty value must parse as an ISO 8601 date or datetime.
Invalid values stop the build.

For Parquet, freshness uses column statistics from the Parquet footer. Date,
timestamp, and ISO-8601 string statistics are supported. If a configured
freshness column has missing or unsupported min/max statistics, the build fails
with a source-specific error.

Timestamp behavior:

- Values containing `Z` or an explicit offset retain their instant.
- Date-only values such as `2026-07-01` are accepted as date-granularity
  freshness values and do not emit timezone warnings.
- Offset-free datetime values are interpreted as UTC and emit a warning.
- The report `timezone` does not change source timestamp interpretation.
- The report `timezone` is used when runtime metadata timestamps are displayed
  by [`DataStatus`](components.md#datastatus).
- Exceeding `max_lag_hours` emits a warning and sets freshness status to
  `warning`; it does not fail the build.
- Manifest-level `data_through` and `processed_at` are compatibility aggregate
  fields using the latest available values across all sources.

[`DataStatus`](components.md#datastatus) displays one row per source, so reports
with multiple sources expose each source's actual freshness separately.

## Theme

`theme` is optional. Unknown fields and unsupported accent names are rejected.

| Field | Type | Required | Default | Supported values | Contract |
| --- | --- | --- | --- | --- | --- |
| `accent` | string | no | `blue` | `blue`, `violet`, `teal`, `green`, `amber`, `coral`, `rose`, `graphite`, `samokat`, `kuper` | Selects the accent preset used by motor's report interface. |

Example:

```yaml
theme:
  accent: samokat
```

Preset primary colors:

| Preset | Primary color |
| --- | --- |
| `blue` | `#3b6eea` |
| `violet` | `#7c3aed` |
| `teal` | `#0d9488` |
| `green` | `#22c55e` |
| `amber` | `#f59e0b` |
| `coral` | `#f06449` |
| `rose` | `#e11d48` |
| `graphite` | `#475467` |
| `samokat` | `#ff3b65` |
| `kuper` | `#61f67a` |

The preset colors the top accent rail, active tabs, filter selection controls,
focus states, runtime loading state, `VersionBadge`, and the optional update
badge. Neutral backgrounds, cards, and text remain white/gray. Semantic success,
warning, and error colors remain stable so their meaning does not depend on the
chosen theme.

Chart category palettes, heatmap gradients, cohort palettes, and tooltip group
swatches are independent of `theme`. Changing `theme.accent` therefore does not
change data encoding. Custom HEX colors are not currently accepted.

## Update checks

`update_check` is optional. Unknown fields are rejected.

| Field | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `endpoint` | string | yes | — | Absolute `http` or `https` base URL for a motor update server. The browser requests `{endpoint}/reports/{slug}.json`. |
| `distribution_url` | string | yes, unless `channel_url` is used | — | Absolute `http` or `https` URL opened by the update badge. This can be a Mattermost channel, Nextcloud folder/file, or any other distribution location containing the latest report files. |
| `channel_url` | string | no | — | Legacy alias for `distribution_url`. Accepted for compatibility and normalized to `distribution_url` in the compiled report spec. New reports should use `distribution_url`. |

Example:

```yaml
update_check:
  endpoint: http://192.168.1.10:8765
  distribution_url: https://nextcloud.example/s/reports
```

Runtime behavior:

- The check is non-blocking and fail-soft. Offline servers, CORS failures,
  timeouts, `404`, and invalid JSON hide the badge and do not affect the report.
- The request times out after roughly two seconds.
- The response must describe the same `slug`; mismatched slugs are ignored.
- If the response `artifact_id` equals the current artifact ID, nothing is
  shown.
- If the response `artifact_id` differs, motor shows a fixed top-right link to
  `distribution_url`.
- There is no age-based expiration rule. A report is treated as outdated only
  when the update server reports a different artifact ID for the same slug.
- If the HTML artifact is served from an `https` page rather than opened as a
  local file, browsers may block an `http` endpoint as mixed content. Use an
  `https` endpoint in that deployment mode.

The expected server JSON is written by `motor build --update-registry`:

```json
{
  "schema_version": "0.1",
  "slug": "orders",
  "title": "Orders",
  "artifact_id": "orders__abc123def456",
  "built_at": "2026-07-09T12:34:00+00:00",
  "tool_version": "0.1.0",
  "runtime_version": "0.7.15-ui-themes"
}
```

See [CLI, artifacts, and runtime](cli-and-runtime.md#update-notification-server)
for server startup and registry configuration.

## Comments and disabling report fragments

Use YAML `#` comments inside frontmatter. Use Markdown/HTML comments in the
body:

````md
<!--
```sql name=old_query kind=query
select * from orders
```

<Table query="old_query" />
-->
````

Body comments can cover SQL blocks, components, and layout tags. Rules:

- Inline and multiline comments are supported after frontmatter.
- Comments cannot be nested.
- Every `<!--` must have a matching `-->`; an unmatched closing marker is also
  an error.
- Comment markers inside fenced Markdown code blocks are treated as code and
  do not disable anything.
- Commented characters are replaced internally with spaces while line breaks
  are preserved, keeping validation line numbers useful.

## Validation outcomes

These conditions stop validation and building:

- malformed frontmatter or unknown configuration fields;
- invalid names, enum values, or component attributes;
- missing, unreadable, empty, or malformed data sources;
- missing configured columns or invalid freshness timestamps;
- invalid SQL metadata, dependencies, templates, or component references;
- malformed, nested, or invalid layout blocks.

These conditions produce warnings but still build:

- omitted report `timezone` (runtime uses `UTC`);
- offset-free freshness timestamps (interpreted as UTC);
- data older than `max_lag_hours`.

Run `motor validate report.md` to see validation and freshness results without
writing an HTML artifact.

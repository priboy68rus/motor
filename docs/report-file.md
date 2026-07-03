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
| `data` | mapping | yes | — | One or more named CSV sources. |
| `spec_version` | string | no | `0.1.0` | Authoring specification version recorded as metadata. It does not currently select compiler behavior. |
| `timezone` | string | no | `UTC` | Valid IANA timezone such as `UTC` or `Europe/Moscow`. Omission emits a warning. |
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
| `path` | string | yes | — | CSV path resolved relative to `report.md`. Absolute paths also resolve normally. |
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

## Freshness

All `freshness` fields are optional. Unknown fields are rejected.

| Field | Type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `data_time_column` | string | no | — | Column whose ISO 8601 values determine source `data_min_at` and `data_max_at`. |
| `processed_time_column` | string | no | — | Column whose maximum ISO 8601 value becomes source `processed_at`. |
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

Configured columns must exist. Each configured timestamp column must contain at
least one non-empty value, and every non-empty value must parse as an ISO 8601
date or datetime. Invalid values stop the build.

Timestamp behavior:

- Values containing `Z` or an explicit offset retain their instant.
- Offset-free values are interpreted as UTC and emit a warning.
- The report `timezone` does not change CSV timestamp interpretation.
- Exceeding `max_lag_hours` emits a warning and sets freshness status to
  `warning`; it does not fail the build.
- Report-level `data_through` and `processed_at` are the latest available
  values across all sources.

[`DataStatus`](components.md#datastatus) displays the aggregated values.

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
- missing, unreadable, empty, or malformed CSV sources;
- missing configured columns or invalid freshness timestamps;
- invalid SQL metadata, dependencies, templates, or component references;
- malformed, nested, or invalid layout blocks.

These conditions produce warnings but still build:

- omitted report `timezone` (runtime uses `UTC`);
- offset-free freshness timestamps (interpreted as UTC);
- data older than `max_lag_hours`.

Run `motor validate report.md` to see validation and freshness results without
writing an HTML artifact.

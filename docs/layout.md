# Layout reference

Layout is declared by component source order plus optional `Row`, `Tabs`, and
`Tab` blocks. There is no separate layout YAML.

## Default source-order layout

A top-level component outside `Row` occupies its own full-width content line:

```md
<BigValue query="summary" value="revenue" />
<LineChart query="daily" x="day" y="revenue" />
<Table query="detail" />
```

The rendered order is the order of declarations in `report.md`. SQL block and
ordinary Markdown positions do not create visible layout items. Sidebar
components retain their relative source order inside the sidebar; content
components retain their relative source order in the content area.

## `Row`

Direct child components share one line in equal-width columns:

```md
<Row>
  <BigValue query="summary" value="revenue" />
  <LineChart query="daily" x="day" y="revenue" />
  <BarChart query="countries" x="country" y="revenue" />
</Row>

<Table query="countries" />
```

Contract:

- `Row` accepts no attributes.
- It requires at least one component.
- It may contain only self-closing component declarations and whitespace.
- Rows cannot be nested.
- A row may be top-level or directly inside a `Tab`.
- `placement="sidebar"` components cannot be placed in a row.
- All child columns receive equal available width; there is no per-column span
  or explicit width attribute.

Responsive behavior:

- desktop: the row uses as many equal columns as it has components;
- below 900 px: at most two columns;
- below 600 px: one column.

## Sticky sidebar

`Filters` and `Text` support `placement="sidebar"`:

```md
<Filters
  params="order_dates,country"
  title="Global filters"
  placement="sidebar"
/>

<Text
  text="Revenue is net of refunds."
  placement="sidebar"
/>
```

Contract:

- Only `Filters` and `Text` accept `placement`.
- Default placement is `content`.
- Every sidebar component must be top-level, outside rows and tabs.
- All sidebar components are collected into one sidebar in source order even
  when content declarations appear between them.
- On desktop the sidebar remains visible while content scrolls and has its own
  vertical overflow area.
- Sidebar cards and controls are constrained to its available inner width;
  horizontal overflow is clipped, so a vertical scrollbar never creates a
  secondary horizontal scrollbar.
- Below 900 px it moves above content into an initially open, collapsible
  `Report controls` section.
- Select, multiselect, and dimension dropdown panels overlay other content.
  They open upward when there is insufficient space below within the viewport
  or sidebar scroll area. Only one filter dropdown can be open at a time across
  the report, and clicking outside a dropdown closes it.
- If the sidebar contains one or more `Filters` components, it renders one reset
  button for all sidebar filter parameters.

The sidebar exists only if at least one component uses sidebar placement.

## `Tabs` and `Tab`

```md
<Tabs>
  <Tab title="Overview">
    <Filters params="breakdown" title="Breakdown" />

    <Row>
      <BigValue query="summary" value="revenue" />
      <BarChart
        query="daily"
        x="day"
        y="revenue"
        group="breakdown"
      />
    </Row>
  </Tab>

  <Tab title="Details">
    <Table query="detail" />
  </Tab>
</Tabs>
```

### `Tabs` contract

- Accepts no attributes.
- Contains one or more `Tab` blocks and whitespace, nothing else.
- Cannot be nested inside another `Tabs` or `Tab`.
- Multiple top-level tab sets are allowed.

### `Tab` contract

| Attribute | Required | Contract |
| --- | --- | --- |
| `title` | yes | Exactly one non-empty title attribute. |

- A tab must be a direct child of `Tabs`.
- It must contain at least one component or row.
- It may contain components, rows, and whitespace.
- It cannot contain another `Tab` or `Tabs`.
- Sidebar components are forbidden inside tabs.

### Tab execution behavior

- The first tab in every tab set is active initially.
- Only queries needed by initially visible content execute at startup.
- Opening a tab executes its final queries and complete named dependency
  closure.
- Parameter values persist when switching tabs.
- A hidden tab uses the latest values when opened.
- Query results can be reused from the in-memory cache when rendered SQL and
  relevant parameter values match a previous execution.
- Changing a parameter reruns affected queries in active content only.

## Filters do not inherit layout scope

Layout controls visibility, not data semantics. All `Filters` components read
and write one report-wide parameter state.

A filter shown in one tab affects another tab if that tab's SQL references the
same parameter. To make a filter tab-specific, declare a dedicated parameter
and reference it only from that tab's query dependency graph. To make a filter
global, reference it in the shared upstream view used by all relevant queries.

## Valid nesting matrix

| Child | Top level | `Row` | `Tabs` | `Tab` |
| --- | --- | --- | --- | --- |
| content component | yes | yes | no | yes |
| sidebar `Filters` / `Text` | yes | no | no | no |
| `Row` | yes | no | no | yes |
| `Tabs` | yes | no | no | no |
| `Tab` | no | no | yes | no |

Ordinary Markdown is ignored at the top level, but structural blocks require
their allowed children only. Text inside a row or tabs container therefore
causes validation to fail; use a `Text` component instead.

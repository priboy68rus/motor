---
title: Revenue Overview
slug: revenue-overview
spec_version: 0.1.0
timezone: UTC
data:
  orders:
    path: ./data/orders.csv
    freshness:
      data_time_column: created_at
      processed_time_column: __processed_at
      max_lag_hours: 168
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
      end: "2026-07-01"
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
---

# Revenue Overview

<Filters
  params="date_range,country"
  title="Global filters"
  placement="sidebar"
/>

<Text
  text="Revenue is shown after refunds. Use the controls below to narrow the report."
  placement="sidebar"
/>

<DataStatus />

<VersionBadge />

```sql name=filtered_orders kind=view
select *
from orders
where {{ in_filter("country", country) }}
  and {{ between_filter("created_at", date_range) }}
```

```sql name=revenue_by_country kind=query
select
  country,
  sum(revenue) as revenue
from filtered_orders
group by country
order by revenue desc
```

```sql name=revenue_summary kind=query
select sum(revenue) as revenue
from filtered_orders
```

```sql name=revenue_by_day kind=query
select
  substr(cast(created_at as varchar), 1, 10) as day,
  {{ dimension(breakdown) }} as breakdown,
  sum(revenue) as revenue
from filtered_orders
group by day, breakdown
order by day, breakdown
```

<Tabs>

<Tab title="Overview">

<Filters params="breakdown" title="Breakdown" />

<Row>

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
  group="breakdown"
  title="Revenue by day"
  format="currency"
  currency="EUR"
/>

<BarChart
  query="revenue_by_day"
  x="day"
  y="revenue"
  group="breakdown"
  stack="zero"
  title="Stacked revenue by day"
  format="currency"
  currency="EUR"
/>

</Row>

</Tab>

<Tab title="Details">

<Table
  query="revenue_by_country"
  title="Country detail"
/>

</Tab>

</Tabs>

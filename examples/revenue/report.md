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
    default: all
    empty_behavior: all
    options:
      source: orders
      column: country
  date_range:
    type: date_range
    default:
      start: "2026-06-01"
      end: "2026-07-01"
---

# Revenue Overview

<Filters params="date_range,country" />

<DataStatus />

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

<BarChart
  query="revenue_by_country"
  x="country"
  y="revenue"
  title="Revenue by country"
  format="currency"
/>

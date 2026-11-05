---
title: Area chart modes
slug: area-chart-modes
timezone: UTC
data:
  revenue:
    path: ./data/revenue.csv
params:
  channel:
    type: multiselect
    label: Channel
    options:
      source: revenue
      column: channel
---

# Area chart modes

<Filters params="channel" placement="sidebar" />

<Text text="Example data includes sales and negative refunds. Percentage composition uses only non-negative sales; gross and net modes include refunds." placement="sidebar" />

```sql name=selected kind=view
select * from revenue
where {{ in_filter("channel", channel) }}
```

```sql name=all_revenue kind=query
select * from selected order by day, channel
```

```sql name=sales kind=query
select * from selected where revenue >= 0 order by day, channel
```

<Row>
<AreaChart query="all_revenue" x="day" y="revenue" color="channel" title="Stacked revenue and refunds" />
<AreaChart query="sales" x="day" y="revenue" color="channel" stack="none" interpolate="step-after" title="Overlapping sales — stepped" />
</Row>

<AreaChart query="sales" x="day" y="revenue" color="channel" stack="normalize" interpolate="monotone" title="Sales composition — 100%, smooth" />

<Row>
<AreaChart query="all_revenue" x="day" y="revenue" color="channel" stack="normalize_gross" title="Gross shares" />
<AreaChart query="all_revenue" x="day" y="revenue" color="channel" stack="normalize_net" title="Net contributions" />
</Row>

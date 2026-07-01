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
---

# Revenue Overview

The first motor example verifies source packaging and report provenance.

<DataStatus />

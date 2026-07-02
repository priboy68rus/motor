from __future__ import annotations

import gzip
from base64 import b64decode
from datetime import datetime, timezone
from pathlib import Path

import pytest

from motor.compiler import build_report, compile_report
from motor.errors import ReportValidationError
from motor.html import _script_text
from motor.inspect import inspect_artifact


EXAMPLE = Path(__file__).parents[1] / "examples" / "revenue" / "report.md"


def test_script_escaping_preserves_javascript_regexes() -> None:
    source = r"const closeTag = /<\//g;</script>"

    escaped = _script_text(source)

    assert r"/<\//g" in escaped
    assert "</script" not in escaped.lower()


def test_markdown_comments_exclude_sql_components_and_layout(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("value\n10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
<!--
```sql name=ignored kind=query
select value from missing_source
```
<Unsupported query="ignored" />
<Row><BigValue query="ignored" value="value" /></Row>
-->
```sql name=summary kind=query
select value, '<!-- code literal -->' as marker from events
```
<BigValue query="summary" value="value" />
""",
        encoding="utf-8",
    )

    _, spec, _ = compile_report(report)

    assert list(spec["queries"]) == ["summary"]
    assert "<!-- code literal -->" in spec["queries"]["summary"]["sql_template"]
    assert [component["type"] for component in spec["components"]] == ["BigValue"]
    assert spec["layout"] == [
        {"type": "component", "component": "component_001"}
    ]


def test_unclosed_markdown_comment_is_rejected(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("value\n10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
<!--
<BigValue query="summary" value="value" />
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="missing its closing -->"):
        compile_report(report)


def test_nested_markdown_comment_is_rejected(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("value\n10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
<!-- outer <!-- inner --> -->
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="nested Markdown comment"):
        compile_report(report)


def test_build_embeds_manifest_and_csv(tmp_path: Path) -> None:
    output = tmp_path / "revenue.html"

    result = build_report(EXAMPLE, output)
    manifest = inspect_artifact(output)
    html = output.read_text(encoding="utf-8")

    assert result.artifact_id == manifest["artifact"]["id"]
    assert manifest["report"]["title"] == "Revenue Overview"
    assert manifest["sources"][0]["rows"] == 3
    assert 'data-encoding="base64+gzip+csv"' in html
    assert 'id="motor-duckdb-wasm"' in html
    assert 'id="motor-duckdb-worker"' in html
    assert "Starting query engine" in html
    assert "<script src=" not in html
    encoded = html.split('data-encoding="base64+gzip+csv">', 1)[1].split("</script>", 1)[0]
    assert gzip.decompress(b64decode(encoded.strip())).startswith(b"order_id,country")


def test_compiles_query_graph_and_components() -> None:
    _, spec, _ = compile_report(EXAMPLE)

    assert spec["queries"]["filtered_orders"]["kind"] == "view"
    assert spec["queries"]["revenue_by_country"]["depends_on"] == {
        "sources": ["orders"],
        "params": ["country", "date_range"],
        "queries": ["filtered_orders"],
    }
    chart = next(item for item in spec["components"] if item["type"] == "BarChart")
    assert chart["query"] == "revenue_by_day"
    assert chart["props"]["x"] == "day"
    filters = next(item for item in spec["components"] if item["type"] == "Filters")
    assert filters["props"]["title"] == "Global filters"
    assert filters["props"]["placement"] == "sidebar"
    report_text = next(item for item in spec["components"] if item["type"] == "Text")
    assert report_text["props"] == {
        "text": "Revenue is shown after refunds. Use the controls below to narrow the report.",
        "placement": "sidebar",
    }
    assert spec["params"]["country"]["control"] == "dropdown"
    assert spec["params"]["breakdown"] == {
        "type": "dimension",
        "label": "Group by",
        "default": "none",
        "choices": {
            "country": {"label": "Country", "field": "country"},
            "product_type": {"field": "product_type"},
            "transaction_type": {
                "label": "Purchase / return",
                "field": "transaction_type",
            },
        },
        "allow_none": True,
    }
    assert spec["queries"]["revenue_by_day"]["depends_on"] == {
        "sources": ["orders"],
        "params": ["breakdown", "country", "date_range"],
        "queries": ["filtered_orders"],
    }
    assert spec["queries"]["revenue_by_day"]["dimension_bindings"] == {
        "breakdown": "breakdown"
    }
    assert chart["props"]["group"] == "breakdown"
    assert chart["props"]["stack"] == "zero"
    line_chart = next(item for item in spec["components"] if item["type"] == "LineChart")
    assert line_chart["props"]["marker"] == "circle"
    assert {item["type"] for item in spec["components"]} >= {
        "DataStatus",
        "Text",
        "VersionBadge",
        "BigValue",
        "Table",
        "LineChart",
        "BarChart",
    }
    tabs = next(item for item in spec["layout"] if item["type"] == "tabs")
    assert tabs["tabset_id"] == "tabs_001"
    assert [tab["title"] for tab in tabs["tabs"]] == ["Overview", "Details"]
    row = next(item for item in tabs["tabs"][0]["layout"] if item["type"] == "row")
    assert row["components"] == ["component_006", "component_007", "component_008"]
    assert tabs["tabs"][1]["layout"] == [
        {"type": "component", "component": "component_009"}
    ]


def test_content_identity_excludes_build_time() -> None:
    first, _, _ = compile_report(
        EXAMPLE, built_at=datetime(2026, 7, 1, 10, tzinfo=timezone.utc)
    )
    second, _, _ = compile_report(
        EXAMPLE, built_at=datetime(2026, 7, 1, 11, tzinfo=timezone.utc)
    )

    assert first["artifact"] == second["artifact"]
    assert first["build"]["built_at"] != second["build"]["built_at"]


def test_naive_datetimes_are_utc_warnings(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,created_at\n1,2026-06-30 10:00:00\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
data:
  events:
    path: data.csv
    freshness:
      data_time_column: created_at
---
""",
        encoding="utf-8",
    )

    manifest, _, _ = compile_report(
        report, built_at=datetime(2026, 7, 1, tzinfo=timezone.utc)
    )

    assert manifest["freshness"]["status"] == "warning"
    assert manifest["sources"][0]["data_max_at"] == "2026-06-30T10:00:00Z"
    warning_names = {
        check["name"] for check in manifest["checks"]["tests"] if check["status"] == "warning"
    }
    assert warning_names == {"report_timezone_defaulted", "timezone_assumed"}


def test_stale_data_is_warning_not_error(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,created_at\n1,2026-01-01T00:00:00Z\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
    freshness:
      data_time_column: created_at
      max_lag_hours: 24
---
""",
        encoding="utf-8",
    )

    manifest, _, _ = compile_report(
        report, built_at=datetime(2026, 7, 1, tzinfo=timezone.utc)
    )

    assert manifest["freshness"]["status"] == "warning"
    assert any(check["name"] == "data_freshness" for check in manifest["checks"]["tests"])


def test_missing_freshness_column_is_error(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id\n1\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
    freshness:
      data_time_column: missing_at
---
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="configured freshness columns not found"):
        compile_report(report)


def test_unknown_sql_relation_is_error(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,value\n1,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
```sql name=summary kind=query
select * from missing
```
<Table query="summary" />
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="unknown relations: missing"):
        compile_report(report)


def test_undeclared_template_parameter_is_error(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("country,value\nDE,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
```sql name=summary kind=query
select * from events where {{ in_filter("country", country) }}
```
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="undeclared parameter 'country'"):
        compile_report(report)


def test_component_cannot_reference_view(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,value\n1,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
```sql name=filtered kind=view
select * from events
```
<Table query="filtered" />
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="must reference a query, not view"):
        compile_report(report)


def test_parameter_options_column_must_exist(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,value\n1,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
params:
  country:
    type: multiselect
    options:
      source: events
      column: country
---
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="missing column events.country"):
        compile_report(report)


def test_parameter_defaults_are_explicit_in_compiled_spec(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,country,created_at\n1,DE,2026-07-01\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
params:
  country:
    type: multiselect
    options:
      source: events
      column: country
  period:
    type: date_range
---
""",
        encoding="utf-8",
    )

    _, spec, _ = compile_report(report)

    assert spec["params"]["country"]["default"] == "all"
    assert spec["params"]["country"]["empty_behavior"] == "none"
    assert spec["params"]["country"]["control"] == "auto"
    assert spec["params"]["period"]["default"] == "all"
    assert "empty_behavior" not in spec["params"]["period"]


def test_dimension_none_default_requires_allow_none(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("country,value\nDE,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
params:
  breakdown:
    type: dimension
    default: none
    choices:
      country:
        label: Country
        field: country
---
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="requires allow_none: true"):
        compile_report(report)


def test_dimension_sql_requires_explicit_alias(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("country,value\nDE,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
params:
  breakdown:
    type: dimension
    default: country
    choices:
      country:
        field: country
---
```sql name=summary kind=query
select {{ dimension(breakdown) }}, sum(value) as value
from events
group by 1
```
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="must be followed by AS alias"):
        compile_report(report)


@pytest.mark.parametrize(
    ("stack", "group", "message"),
    [
        ("center", ' group="country"', "stack must be one of"),
        ("normalize", "", "requires a group or color attribute"),
    ],
)
def test_bar_chart_stack_is_validated(
    tmp_path: Path, stack: str, group: str, message: str
) -> None:
    data = tmp_path / "data.csv"
    data.write_text("country,value\nDE,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        f"""---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
```sql name=summary kind=query
select country, value from events
```
<BarChart query="summary" x="country" y="value"{group} stack="{stack}" />
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match=message):
        compile_report(report)


def test_bar_chart_stack_defaults_to_zero(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("country,value\nDE,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
```sql name=summary kind=query
select country, value from events
```
<BarChart query="summary" x="country" y="value" bar_width="24.5" />
""",
        encoding="utf-8",
    )

    _, spec, _ = compile_report(report)

    chart = next(item for item in spec["components"] if item["type"] == "BarChart")
    assert chart["props"]["stack"] == "zero"
    assert chart["props"]["bar_width"] == 24.5


def test_cohort_gradient_and_heatmap_contract(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text(
        "cohort_month,period_number,retention\n2026-01-01,0,1.0\n2026-01-01,1,0.5\n",
        encoding="utf-8",
    )
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  cohorts:
    path: data.csv
---
```sql name=retention kind=query
select cohort_month, period_number, retention from cohorts
```
<LineChart
  query="retention"
  x="period_number"
  y="retention"
  group="cohort_month"
  color_scheme="viridis"
  color_direction="lower_is_darker"
/>
<Heatmap
  query="retention"
  x="period_number"
  y="cohort_month"
  value="retention"
  format="percent"
/>
""",
        encoding="utf-8",
    )

    _, spec, _ = compile_report(report)

    line = next(item for item in spec["components"] if item["type"] == "LineChart")
    assert line["props"]["color_scheme"] == "viridis"
    assert line["props"]["color_direction"] == "lower_is_darker"
    heatmap = next(item for item in spec["components"] if item["type"] == "Heatmap")
    assert heatmap["props"] == {
        "x": "period_number",
        "y": "cohort_month",
        "value": "retention",
        "format": "percent",
        "color_scheme": "blues",
        "color_direction": "higher_is_darker",
    }


@pytest.mark.parametrize(
    ("component", "message"),
    [
        (
            '<LineChart query="retention" x="period_number" y="retention" '
            'color_scheme="blues" />',
            "requires a group or color attribute",
        ),
        (
            '<LineChart query="retention" x="period_number" y="retention" '
            'group="cohort_month" color_direction="higher_is_darker" />',
            "color_direction requires color_scheme",
        ),
        (
            '<Heatmap query="retention" x="period_number" y="cohort_month" '
            'value="retention" color_direction="sideways" />',
            "color_direction must be one of",
        ),
        (
            '<Heatmap query="retention" x="period_number" y="cohort_month" '
            'value="retention" format="currency" />',
            "format must be one of",
        ),
    ],
)
def test_cohort_chart_options_are_validated(
    tmp_path: Path, component: str, message: str
) -> None:
    data = tmp_path / "data.csv"
    data.write_text(
        "cohort_month,period_number,retention\n2026-01-01,0,1.0\n",
        encoding="utf-8",
    )
    report = tmp_path / "report.md"
    report.write_text(
        f"""---
title: Test
slug: test
timezone: UTC
data:
  cohorts:
    path: data.csv
---
```sql name=retention kind=query
select cohort_month, period_number, retention from cohorts
```
{component}
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match=message):
        compile_report(report)


def test_big_value_comparison_contract(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("value\n100\n120\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
```sql name=summary kind=query
select max(value) as current_value, min(value) as previous_value from events
```
<BigValue
  query="summary"
  value="current_value"
  compare_value="previous_value"
  delta_label="vs previous period"
/>
""",
        encoding="utf-8",
    )

    _, spec, _ = compile_report(report)

    component = next(item for item in spec["components"] if item["type"] == "BigValue")
    assert component["props"] == {
        "value": "current_value",
        "compare_value": "previous_value",
        "delta": "both",
        "delta_label": "vs previous period",
        "direction": "neutral",
    }


@pytest.mark.parametrize(
    ("attributes", "message"),
    [
        ('compare_value=""', "compare_value must not be empty"),
        ('delta="absolute"', "comparison attributes require compare_value"),
        ('compare_value="previous" delta="relative"', "delta must be one of"),
        ('compare_value="previous" direction="up"', "direction must be one of"),
    ],
)
def test_big_value_comparison_is_validated(
    tmp_path: Path, attributes: str, message: str
) -> None:
    data = tmp_path / "data.csv"
    data.write_text("value\n100\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        f"""---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
```sql name=summary kind=query
select value, value as previous from events
```
<BigValue query="summary" value="value" {attributes} />
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match=message):
        compile_report(report)


def test_sidebar_filters_cannot_be_inside_tab(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("created_at,value\n2026-07-01,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
params:
  period:
    type: date_range
---
<Tabs>
  <Tab title="Overview">
    <Filters params="period" placement="sidebar" />
  </Tab>
</Tabs>
""",
        encoding="utf-8",
    )

    with pytest.raises(
        ReportValidationError, match="sidebar components cannot be placed inside Tab"
    ):
        compile_report(report)


def test_nested_tabs_are_rejected(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,value\n1,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
<Tabs>
  <Tab title="Outer">
    <Tabs>
      <Tab title="Inner">
        <DataStatus />
      </Tab>
    </Tabs>
  </Tab>
</Tabs>
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="nested Tabs layouts"):
        compile_report(report)


def test_nested_rows_are_rejected(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,value\n1,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
---
<Row>
  <Row>
    <DataStatus />
  </Row>
</Row>
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="nested Row layouts"):
        compile_report(report)

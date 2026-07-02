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
    assert filters["props"]["title"] == "Report controls"
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
    assert {item["type"] for item in spec["components"]} >= {
        "DataStatus",
        "VersionBadge",
        "BigValue",
        "Table",
        "LineChart",
        "BarChart",
    }
    row = next(item for item in spec["layout"] if item["type"] == "row")
    assert row["components"] == ["component_004", "component_005", "component_006"]


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
        ("zero", "", "requires a group attribute"),
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

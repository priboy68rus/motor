from pathlib import Path

import pytest

from motor.compiler import compile_report
from motor.errors import ReportValidationError


def report_file(tmp_path: Path, component: str) -> Path:
    (tmp_path / "events.csv").write_text("day,channel,value\n2026-01-01,app,10\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text('''---
title: Area
slug: area
timezone: UTC
data:
  events:
    path: events.csv
---
```sql name=daily kind=query
select * from events
```
''' + component, encoding="utf-8")
    return report


@pytest.mark.parametrize("stack", ["zero", "none", "normalize", "normalize_gross", "normalize_net"])
def test_area_stack_modes_compile(tmp_path: Path, stack: str) -> None:
    _, spec, _ = compile_report(report_file(tmp_path, f'<AreaChart query="daily" x="day" y="value" color="channel" stack="{stack}" details="channel" download="false" />'))
    chart = spec["components"][0]
    assert chart["type"] == "AreaChart"
    assert chart["props"]["stack"] == stack
    assert chart["props"]["download"] is False


def test_area_defaults_and_templates(tmp_path: Path) -> None:
    _, spec, _ = compile_report(report_file(tmp_path, '<Template name="area" component="AreaChart" x="day" y="value" />\n<AreaChart template="area" query="daily" />'))
    assert spec["components"][0]["props"] == {
        "x": "day", "y": "value", "stack": "zero", "interpolate": "linear", "download": True,
    }


@pytest.mark.parametrize("interpolate", [
    "linear", "linear-closed", "step", "step-before", "step-after", "basis",
    "basis-open", "basis-closed", "cardinal", "cardinal-open", "cardinal-closed", "monotone",
])
def test_area_interpolation_compiles(tmp_path: Path, interpolate: str) -> None:
    _, spec, _ = compile_report(report_file(
        tmp_path,
        '<Template name="area" component="AreaChart" x="day" y="value" '
        f'interpolate="{interpolate}" />\n<AreaChart template="area" query="daily" />',
    ))
    assert spec["components"][0]["props"]["interpolate"] == interpolate


@pytest.mark.parametrize(("attributes", "message"), [
    ('stack="center"', 'AreaChart stack must be'),
    ('stack="normalize"', 'AreaChart.*requires a color'),
    ('stack="normalize_gross"', 'AreaChart.*requires a color'),
    ('stack="normalize_net"', 'AreaChart.*requires a color'),
    ('bar_width="20"', 'unsupported attributes'),
    ('group="channel"', 'unsupported attributes'),
    ('marker="circle"', 'unsupported attributes'),
    ('download="yes"', 'AreaChart download must be'),
    ('interpolate="smooth"', 'AreaChart interpolate must be'),
    ('interpolate="bundle"', 'AreaChart interpolate must be'),
    ('interpolate=""', 'AreaChart interpolate must be'),
])
def test_area_validation(tmp_path: Path, attributes: str, message: str) -> None:
    with pytest.raises(ReportValidationError, match=message):
        compile_report(report_file(tmp_path, f'<AreaChart query="daily" x="day" y="value" {attributes} />'))

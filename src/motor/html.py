from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from motor.models import CompiledSource


def _script_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True).replace("</", "<\\/")


def render_report_html(
    manifest: dict[str, Any],
    report_spec: dict[str, Any],
    sources: list[CompiledSource],
) -> str:
    template_dir = files("motor").joinpath("templates")
    environment = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(enabled_extensions=("html", "j2"), default=True),
    )
    template = environment.get_template("report.html.j2")
    return template.render(
        manifest=manifest,
        manifest_json=_script_json(manifest),
        report_spec_json=_script_json(report_spec),
        sources=sources,
    )

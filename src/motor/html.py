from __future__ import annotations

import json
import re
from base64 import b64encode
from importlib.resources import files
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from motor.models import CompiledSource


def _script_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True).replace("</", "<\\/")


def _script_text(value: str) -> str:
    return re.sub(r"</script", r"<\\/script", value, flags=re.IGNORECASE)


def render_report_html(
    manifest: dict[str, Any],
    report_spec: dict[str, Any],
    sources: list[CompiledSource],
) -> str:
    template_dir = files("motor").joinpath("templates")
    static_dir = files("motor").joinpath("static")
    environment = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(enabled_extensions=("html", "j2"), default=True),
    )
    template = environment.get_template("report.html.j2")
    return template.render(
        manifest=manifest,
        manifest_json=_script_json(manifest),
        theme_accent=report_spec["theme"]["accent"],
        report_spec_json=_script_json(report_spec),
        sources=sources,
        duckdb_wasm=b64encode(static_dir.joinpath("duckdb-mvp.wasm.gz").read_bytes()).decode(
            "ascii"
        ),
        duckdb_worker=b64encode(
            static_dir.joinpath("duckdb-browser-mvp.worker.js").read_bytes()
        ).decode("ascii"),
        vega_js=_script_text(static_dir.joinpath("vega.min.js").read_text(encoding="utf-8")),
        vega_lite_js=_script_text(
            static_dir.joinpath("vega-lite.min.js").read_text(encoding="utf-8")
        ),
        vega_embed_js=_script_text(
            static_dir.joinpath("vega-embed.min.js").read_text(encoding="utf-8")
        ),
        runtime_js=_script_text(static_dir.joinpath("runtime.js").read_text(encoding="utf-8")),
    )

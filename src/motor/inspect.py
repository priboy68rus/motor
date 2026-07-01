from __future__ import annotations

import json
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from motor.errors import ArtifactInspectionError


class _ManifestParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._inside_manifest = False
        self._chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "script" and attributes.get("id") == "motor-manifest":
            self._inside_manifest = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._inside_manifest:
            self._inside_manifest = False

    def handle_data(self, data: str) -> None:
        if self._inside_manifest:
            self._chunks.append(data)

    @property
    def manifest_text(self) -> str:
        return "".join(self._chunks)


def inspect_artifact(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ArtifactInspectionError(f"cannot read artifact {path}: {exc}") from exc
    parser = _ManifestParser()
    parser.feed(text)
    if not parser.manifest_text:
        raise ArtifactInspectionError(f"{path} does not contain a motor manifest")
    try:
        value = json.loads(parser.manifest_text)
    except json.JSONDecodeError as exc:
        raise ArtifactInspectionError(f"embedded motor manifest is invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ArtifactInspectionError("embedded motor manifest must be a JSON object")
    return value

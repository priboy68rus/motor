from __future__ import annotations

import hashlib
from pathlib import Path

import yaml
from pydantic import ValidationError

from motor.errors import ReportValidationError
from motor.models import ParsedReport, ReportConfig


def parse_report(path: Path) -> ParsedReport:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ReportValidationError(f"cannot read report {path}: {exc}") from exc

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ReportValidationError(f"report must be UTF-8: {path}") from exc

    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ReportValidationError("report must start with YAML frontmatter delimited by ---")

    closing_index = next(
        (index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"),
        None,
    )
    if closing_index is None:
        raise ReportValidationError("report YAML frontmatter is missing its closing ---")

    frontmatter_text = "".join(lines[1:closing_index])
    body = "".join(lines[closing_index + 1 :])
    try:
        frontmatter = yaml.safe_load(frontmatter_text)
    except yaml.YAMLError as exc:
        raise ReportValidationError(f"invalid YAML frontmatter: {exc}") from exc
    if not isinstance(frontmatter, dict):
        raise ReportValidationError("report YAML frontmatter must be a mapping")

    try:
        config = ReportConfig.model_validate(frontmatter)
    except ValidationError as exc:
        raise ReportValidationError(f"invalid report configuration:\n{exc}") from exc

    return ParsedReport(
        config=config,
        body=body,
        source_sha256=hashlib.sha256(raw).hexdigest(),
    )

from __future__ import annotations

import hashlib
import re
import shlex
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from motor.errors import ReportValidationError
from motor.models import (
    ComponentSpec,
    ParamConfig,
    ParsedReport,
    QueryDependencies,
    QuerySpec,
    ReportConfig,
)


_SQL_OPEN = re.compile(r"^```sql(?:\s+(.*?))?\s*$")
_TEMPLATE = re.compile(r"{{\s*(.*?)\s*}}")
_HELPER = re.compile(
    r"(?P<helper>in_filter|between_filter)\(\s*(['\"])(?P<column>.+?)\2\s*,\s*"
    r"(?P<param>[A-Za-z_]\w*)\s*\)"
)
_RELATION = re.compile(r"\b(?:from|join)\s+\"?([A-Za-z_]\w*)\"?", re.IGNORECASE)
_CTE = re.compile(r"(?:\bwith|,)\s*([A-Za-z_]\w*)\s+as\s*\(", re.IGNORECASE)
_COMPONENT = re.compile(r"<([A-Z][A-Za-z0-9]*)\b(.*?)/>", re.DOTALL)
_COMPONENT_START = re.compile(r"<([A-Z][A-Za-z0-9]*)\b")
_COMPONENT_RULES: dict[str, tuple[set[str], set[str]]] = {
    "Filters": ({"params"}, {"params"}),
    "DataStatus": (set(), set()),
    "VersionBadge": (set(), set()),
    "BigValue": ({"query", "value"}, {"query", "value", "title", "format"}),
    "Table": ({"query"}, {"query", "title", "columns"}),
    "LineChart": (
        {"query", "x", "y"},
        {"query", "x", "y", "title", "format", "group", "color", "stack"},
    ),
    "BarChart": (
        {"query", "x", "y"},
        {"query", "x", "y", "title", "format", "group", "color", "stack"},
    ),
}


def _parse_sql_metadata(metadata: str, line_number: int) -> tuple[str, str]:
    try:
        tokens = shlex.split(metadata)
    except ValueError as exc:
        raise ReportValidationError(f"invalid SQL block metadata at line {line_number}: {exc}") from exc
    values: dict[str, str] = {}
    if len(tokens) == 1 and "=" not in tokens[0]:
        values["name"] = tokens[0]
    else:
        for token in tokens:
            if "=" not in token:
                raise ReportValidationError(
                    f"invalid SQL block metadata token {token!r} at line {line_number}"
                )
            key, value = token.split("=", 1)
            if key not in {"name", "kind"} or key in values:
                raise ReportValidationError(
                    f"invalid or duplicate SQL block option {key!r} at line {line_number}"
                )
            values[key] = value
    name = values.get("name")
    kind = values.get("kind", "query")
    if not name or not name.isidentifier():
        raise ReportValidationError(
            f"SQL block at line {line_number} requires a valid identifier in name=..."
        )
    if kind not in {"view", "query"}:
        raise ReportValidationError(
            f"SQL block {name!r} has invalid kind {kind!r}; expected view or query"
        )
    return name, kind


def _template_params(
    sql: str, query_name: str, declared: dict[str, ParamConfig]
) -> list[str]:
    params: set[str] = set()
    matches = list(_TEMPLATE.finditer(sql))
    remainder = _TEMPLATE.sub("", sql)
    if "{{" in remainder or "}}" in remainder:
        raise ReportValidationError(
            f"SQL block {query_name!r} contains a malformed template expression"
        )
    for match in matches:
        helper = _HELPER.fullmatch(match.group(1))
        if helper is None:
            raise ReportValidationError(
                f"SQL block {query_name!r} contains unsupported template expression "
                f"{match.group(0)!r}"
            )
        param = helper.group("param")
        if param not in declared:
            raise ReportValidationError(
                f"SQL block {query_name!r} references undeclared parameter {param!r}"
            )
        helper_name = helper.group("helper")
        param_type = declared[param].type
        expected_types = (
            {"select", "multiselect"}
            if helper_name == "in_filter"
            else {"date_range"}
        )
        if param_type not in expected_types:
            raise ReportValidationError(
                f"{helper_name} in SQL block {query_name!r} cannot use "
                f"{param_type} parameter {param!r}"
            )
        params.add(param)
    return sorted(params)


def _extract_queries(
    body: str, declared_params: dict[str, ParamConfig], *, first_body_line: int
) -> tuple[str, dict[str, QuerySpec]]:
    lines = body.splitlines(keepends=True)
    output: list[str] = []
    queries: dict[str, QuerySpec] = {}
    index = 0
    while index < len(lines):
        opened = _SQL_OPEN.match(lines[index].rstrip("\r\n"))
        if opened is None:
            output.append(lines[index])
            index += 1
            continue
        name, kind = _parse_sql_metadata(
            opened.group(1) or "", first_body_line + index
        )
        if name in queries:
            raise ReportValidationError(f"duplicate SQL block name {name!r}")
        end = index + 1
        while end < len(lines) and lines[end].strip() != "```":
            end += 1
        if end == len(lines):
            raise ReportValidationError(f"SQL block {name!r} is missing its closing fence")
        sql = "".join(lines[index + 1 : end]).strip()
        if not sql:
            raise ReportValidationError(f"SQL block {name!r} is empty")
        queries[name] = QuerySpec(
            name=name,
            kind=kind,
            sql_template=sql,
            depends_on=QueryDependencies(
                params=_template_params(sql, name, declared_params),
            ),
        )
        index = end + 1
    return "".join(output), queries


def _parse_attributes(raw: str, component_type: str) -> dict[str, Any]:
    try:
        tokens = shlex.split(raw)
    except ValueError as exc:
        raise ReportValidationError(f"invalid {component_type} attributes: {exc}") from exc
    attributes: dict[str, Any] = {}
    for token in tokens:
        if "=" not in token:
            raise ReportValidationError(
                f"invalid {component_type} attribute {token!r}; expected key=value"
            )
        key, value = token.split("=", 1)
        if not key.isidentifier() or key in attributes:
            raise ReportValidationError(
                f"invalid or duplicate {component_type} attribute {key!r}"
            )
        if value.lower() in {"true", "false"}:
            attributes[key] = value.lower() == "true"
        else:
            attributes[key] = value
    return attributes


def _extract_components(body: str, config: ReportConfig) -> list[ComponentSpec]:
    components: list[ComponentSpec] = []
    identifiers: set[str] = set()
    matches = list(_COMPONENT.finditer(body))
    valid_starts = {match.start() for match in matches}
    for start in _COMPONENT_START.finditer(body):
        if start.start() not in valid_starts:
            raise ReportValidationError(
                f"component {start.group(1)!r} must be a self-closing declaration"
            )
    for index, match in enumerate(matches, start=1):
        component_type = match.group(1)
        if component_type not in _COMPONENT_RULES:
            raise ReportValidationError(f"unsupported component {component_type!r}")
        required, allowed = _COMPONENT_RULES[component_type]
        attributes = _parse_attributes(match.group(2), component_type)
        component_id = str(attributes.pop("id", f"component_{index:03d}"))
        if not component_id.isidentifier() or component_id in identifiers:
            raise ReportValidationError(f"invalid or duplicate component id {component_id!r}")
        identifiers.add(component_id)
        unknown = set(attributes) - allowed
        missing = required - set(attributes)
        if unknown:
            raise ReportValidationError(
                f"{component_type} has unsupported attributes: {', '.join(sorted(unknown))}"
            )
        if missing:
            raise ReportValidationError(
                f"{component_type} is missing required attributes: {', '.join(sorted(missing))}"
            )
        query = attributes.pop("query", None)
        if component_type == "Filters":
            params = [item.strip() for item in str(attributes["params"]).split(",") if item.strip()]
            unknown_params = set(params) - set(config.params)
            if unknown_params:
                raise ReportValidationError(
                    f"Filters references undeclared parameters: {', '.join(sorted(unknown_params))}"
                )
            attributes["params"] = params
        components.append(
            ComponentSpec(id=component_id, type=component_type, query=query, props=attributes)
        )
    return components


def _dependency_sql(sql: str) -> str:
    without_comments = re.sub(r"/\*.*?\*/|--[^\r\n]*", " ", sql, flags=re.DOTALL)
    return re.sub(r"'(?:''|[^'])*'", "''", without_comments)


def _resolve_dependencies(
    queries: dict[str, QuerySpec], source_names: set[str]
) -> dict[str, QuerySpec]:
    query_names = set(queries)
    conflicts = query_names & source_names
    if conflicts:
        raise ReportValidationError(
            f"SQL block names conflict with data sources: {', '.join(sorted(conflicts))}"
        )
    direct_queries: dict[str, set[str]] = {}
    for name, query in queries.items():
        dependency_sql = _dependency_sql(query.sql_template)
        ctes = set(_CTE.findall(dependency_sql))
        relations = set(_RELATION.findall(dependency_sql)) - ctes
        unknown = relations - source_names - query_names
        if unknown:
            raise ReportValidationError(
                f"SQL block {name!r} references unknown relations: {', '.join(sorted(unknown))}"
            )
        query.depends_on.sources = sorted(relations & source_names)
        query.depends_on.queries = sorted(relations & query_names)
        direct_queries[name] = relations & query_names

    visiting: set[str] = set()
    resolved: set[str] = set()

    def visit(name: str) -> None:
        if name in visiting:
            raise ReportValidationError(f"cyclic SQL block dependency involving {name!r}")
        if name in resolved:
            return
        visiting.add(name)
        query = queries[name]
        for dependency in direct_queries[name]:
            visit(dependency)
            parent = queries[dependency]
            query.depends_on.sources = sorted(
                set(query.depends_on.sources) | set(parent.depends_on.sources)
            )
            query.depends_on.params = sorted(
                set(query.depends_on.params) | set(parent.depends_on.params)
            )
        visiting.remove(name)
        resolved.add(name)

    for name in queries:
        visit(name)
        if not queries[name].depends_on.sources:
            raise ReportValidationError(
                f"SQL block {name!r} does not depend on a configured data source"
            )
    return queries


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

    for name, param in config.params.items():
        if param.options is not None and param.options.source not in config.data:
            raise ReportValidationError(
                f"parameter {name!r} options reference unknown source {param.options.source!r}"
            )

    body_without_sql, queries = _extract_queries(
        body, config.params, first_body_line=closing_index + 2
    )
    queries = _resolve_dependencies(queries, set(config.data))
    components = _extract_components(body_without_sql, config)
    for component in components:
        if component.query is None:
            continue
        if component.query not in queries:
            raise ReportValidationError(
                f"component {component.id!r} references unknown query {component.query!r}"
            )
        if queries[component.query].kind != "query":
            raise ReportValidationError(
                f"component {component.id!r} must reference a query, not view {component.query!r}"
            )

    return ParsedReport(
        config=config,
        body=body_without_sql,
        source_sha256=hashlib.sha256(raw).hexdigest(),
        queries=queries,
        components=components,
    )

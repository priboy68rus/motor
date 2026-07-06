from __future__ import annotations

import hashlib
import math
import re
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from motor.errors import ReportValidationError
from motor.models import (
    ComponentSpec,
    LayoutItem,
    ParamConfig,
    ParsedReport,
    QueryDependencies,
    QuerySpec,
    ReportConfig,
    TabLayout,
)


_SQL_OPEN = re.compile(r"^```sql(?:\s+(.*?))?\s*$")
_MARKDOWN_FENCE = re.compile(r"^\s*(?P<fence>`{3,}|~{3,})")
_TEMPLATE = re.compile(r"{{\s*(.*?)\s*}}")
_FILTER_HELPER = re.compile(
    r"(?P<helper>in_filter|between_filter)\(\s*(['\"])"
    r"(?P<column>[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\2\s*,\s*"
    r"(?P<param>[A-Za-z_]\w*)\s*\)"
)
_DIMENSION_HELPER = re.compile(r"dimension\(\s*(?P<param>[A-Za-z_]\w*)\s*\)")
_DIMENSION_ALIAS = re.compile(
    r'^\s+as\s+(?P<quote>["]?)(?P<alias>[A-Za-z_]\w*)(?P=quote)',
    re.IGNORECASE,
)
_RELATION = re.compile(r"\b(?:from|join)\s+\"?([A-Za-z_]\w*)\"?", re.IGNORECASE)
_CTE = re.compile(r"(?:\bwith|,)\s*([A-Za-z_]\w*)\s+as\s*\(", re.IGNORECASE)
_COMPONENT = re.compile(r"<([A-Z][A-Za-z0-9]*)\b([^<>]*?)/>", re.DOTALL)
_COMPONENT_START = re.compile(r"<([A-Z][A-Za-z0-9]*)\b")
_ROW_TAG = re.compile(r"<(?P<closing>/)?Row(?P<attrs>\s+[^>]*)?\s*>")
_ROW_START = re.compile(r"</?Row\b")
_TABS_TAG = re.compile(r"<(?P<closing>/)?Tabs(?P<attrs>\s+[^>]*)?\s*>")
_TABS_START = re.compile(r"</?Tabs\b")
_TAB_TAG = re.compile(r"<(?P<closing>/)?Tab(?P<attrs>\s+[^>]*)?\s*>")
_TAB_START = re.compile(r"</?Tab\b")
_COMPONENT_RULES: dict[str, tuple[set[str], set[str]]] = {
    "Filters": ({"params"}, {"params", "title", "placement"}),
    "Text": ({"text"}, {"text", "title", "placement"}),
    "DataStatus": (set(), set()),
    "VersionBadge": (set(), set()),
    "BigValue": (
        {"query", "value"},
        {
            "query",
            "value",
            "title",
            "format",
            "currency",
            "notation",
            "compare_value",
            "delta",
            "delta_label",
            "direction",
        },
    ),
    "Table": ({"query"}, {"query", "title", "columns"}),
    "LineChart": (
        {"query", "x", "y"},
        {
            "query",
            "x",
            "y",
            "title",
            "format",
            "currency",
            "group",
            "color",
            "marker",
            "color_scheme",
            "color_direction",
        },
    ),
    "BarChart": (
        {"query", "x", "y"},
        {
            "query",
            "x",
            "y",
            "title",
            "format",
            "currency",
            "group",
            "color",
            "stack",
            "bar_width",
        },
    ),
    "Heatmap": (
        {"query", "x", "y", "value"},
        {
            "query",
            "x",
            "y",
            "value",
            "title",
            "format",
            "color_scheme",
            "color_direction",
            "show_values",
        },
    ),
}


def _blank_comment(value: str) -> str:
    return "".join(character if character in "\r\n" else " " for character in value)


def _strip_markdown_comments(body: str, *, first_body_line: int) -> str:
    output: list[str] = []
    in_comment = False
    comment_line: int | None = None
    fence_character: str | None = None
    for offset, line in enumerate(body.splitlines(keepends=True)):
        line_number = first_body_line + offset
        fence = _MARKDOWN_FENCE.match(line)
        if not in_comment and fence is not None:
            character = fence.group("fence")[0]
            if fence_character is None:
                fence_character = character
            elif fence_character == character:
                fence_character = None
            output.append(line)
            continue
        if fence_character is not None:
            output.append(line)
            continue

        cursor = 0
        rendered: list[str] = []
        while cursor < len(line):
            if in_comment:
                closing = line.find("-->", cursor)
                nested = line.find("<!--", cursor)
                if nested != -1 and (closing == -1 or nested < closing):
                    raise ReportValidationError(
                        f"nested Markdown comment at line {line_number} is not supported"
                    )
                if closing == -1:
                    rendered.append(_blank_comment(line[cursor:]))
                    cursor = len(line)
                    continue
                rendered.append(_blank_comment(line[cursor : closing + 3]))
                cursor = closing + 3
                in_comment = False
                comment_line = None
                continue

            opening = line.find("<!--", cursor)
            unexpected_closing = line.find("-->", cursor)
            if unexpected_closing != -1 and (
                opening == -1 or unexpected_closing < opening
            ):
                raise ReportValidationError(
                    f"unexpected Markdown comment closing at line {line_number}"
                )
            if opening == -1:
                rendered.append(line[cursor:])
                cursor = len(line)
                continue
            rendered.append(line[cursor:opening])
            rendered.append(_blank_comment(line[opening : opening + 4]))
            cursor = opening + 4
            in_comment = True
            comment_line = line_number
        output.append("".join(rendered))

    if in_comment:
        raise ReportValidationError(
            f"Markdown comment opened at line {comment_line} is missing its closing -->"
        )
    return "".join(output)


@dataclass(frozen=True)
class _TabRange:
    start: int
    content_start: int
    content_end: int
    end: int
    id: str
    title: str


@dataclass(frozen=True)
class _TabsetRange:
    start: int
    content_start: int
    content_end: int
    end: int
    id: str
    tabs: tuple[_TabRange, ...]


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
) -> tuple[list[str], dict[str, str]]:
    params: set[str] = set()
    dimension_bindings: dict[str, str] = {}
    matches = list(_TEMPLATE.finditer(sql))
    remainder = _TEMPLATE.sub("", sql)
    if "{{" in remainder or "}}" in remainder:
        raise ReportValidationError(
            f"SQL block {query_name!r} contains a malformed template expression"
        )
    for match in matches:
        expression = match.group(1)
        filter_helper = _FILTER_HELPER.fullmatch(expression)
        dimension_helper = _DIMENSION_HELPER.fullmatch(expression)
        if filter_helper is None and dimension_helper is None:
            raise ReportValidationError(
                f"SQL block {query_name!r} contains unsupported template expression "
                f"{match.group(0)!r}"
            )
        helper = filter_helper or dimension_helper
        assert helper is not None
        param = helper.group("param")
        if param not in declared:
            raise ReportValidationError(
                f"SQL block {query_name!r} references undeclared parameter {param!r}"
            )
        helper_name = filter_helper.group("helper") if filter_helper else "dimension"
        param_type = declared[param].type
        expected_types = {
            "in_filter": {"select", "multiselect"},
            "between_filter": {"date_range"},
            "dimension": {"dimension"},
        }[helper_name]
        if param_type not in expected_types:
            raise ReportValidationError(
                f"{helper_name} in SQL block {query_name!r} cannot use "
                f"{param_type} parameter {param!r}"
            )
        if dimension_helper is not None:
            alias_match = _DIMENSION_ALIAS.match(sql[match.end() :])
            if alias_match is None:
                raise ReportValidationError(
                    f"dimension in SQL block {query_name!r} must be followed by AS alias"
                )
            alias = alias_match.group("alias")
            if alias in dimension_bindings:
                raise ReportValidationError(
                    f"SQL block {query_name!r} has duplicate dimension alias {alias!r}"
                )
            dimension_bindings[alias] = param
        params.add(param)
    return sorted(params), dimension_bindings


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
        params, dimension_bindings = _template_params(sql, name, declared_params)
        queries[name] = QuerySpec(
            name=name,
            kind=kind,
            sql_template=sql,
            depends_on=QueryDependencies(
                params=params,
            ),
            dimension_bindings=dimension_bindings,
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


def _extract_rows(body: str) -> tuple[list[tuple[int, int, int, int]], set[int]]:
    matches = list(_ROW_TAG.finditer(body))
    valid_starts = {match.start() for match in matches}
    for start in _ROW_START.finditer(body):
        if start.start() not in valid_starts:
            raise ReportValidationError("malformed Row declaration")

    rows: list[tuple[int, int, int, int]] = []
    opened: re.Match[str] | None = None
    for match in matches:
        if (match.group("attrs") or "").strip():
            raise ReportValidationError("Row does not accept attributes")
        if match.group("closing"):
            if opened is None:
                raise ReportValidationError("Row closing tag has no matching opening tag")
            rows.append((opened.start(), opened.end(), match.start(), match.end()))
            opened = None
        else:
            if opened is not None:
                raise ReportValidationError("nested Row layouts are not supported")
            opened = match
    if opened is not None:
        raise ReportValidationError("Row is missing its closing tag")
    return rows, valid_starts


def _extract_tabs(body: str) -> tuple[list[_TabsetRange], set[int]]:
    tabset_matches = list(_TABS_TAG.finditer(body))
    tab_matches = list(_TAB_TAG.finditer(body))
    valid_starts = {match.start() for match in [*tabset_matches, *tab_matches]}
    for start in [*_TABS_START.finditer(body), *_TAB_START.finditer(body)]:
        if start.start() not in valid_starts:
            raise ReportValidationError("malformed Tabs or Tab declaration")

    tabset_bounds: list[tuple[int, int, int, int]] = []
    opened_tabset: re.Match[str] | None = None
    for match in tabset_matches:
        if (match.group("attrs") or "").strip():
            raise ReportValidationError("Tabs does not accept attributes")
        if match.group("closing"):
            if opened_tabset is None:
                raise ReportValidationError("Tabs closing tag has no matching opening tag")
            tabset_bounds.append(
                (opened_tabset.start(), opened_tabset.end(), match.start(), match.end())
            )
            opened_tabset = None
        else:
            if opened_tabset is not None:
                raise ReportValidationError("nested Tabs layouts are not supported")
            opened_tabset = match
    if opened_tabset is not None:
        raise ReportValidationError("Tabs is missing its closing tag")

    tabs: list[_TabRange] = []
    opened_tab: tuple[re.Match[str], str] | None = None
    for match in tab_matches:
        if match.group("closing"):
            if (match.group("attrs") or "").strip():
                raise ReportValidationError("Tab closing tag does not accept attributes")
            if opened_tab is None:
                raise ReportValidationError("Tab closing tag has no matching opening tag")
            opening, title = opened_tab
            tabs.append(
                _TabRange(
                    start=opening.start(),
                    content_start=opening.end(),
                    content_end=match.start(),
                    end=match.end(),
                    id=f"tab_{len(tabs) + 1:03d}",
                    title=title,
                )
            )
            opened_tab = None
        else:
            if opened_tab is not None:
                raise ReportValidationError("nested Tab layouts are not supported")
            attributes = _parse_attributes(match.group("attrs") or "", "Tab")
            if set(attributes) != {"title"} or not str(attributes.get("title", "")).strip():
                raise ReportValidationError("Tab requires exactly one non-empty title attribute")
            opened_tab = (match, str(attributes["title"]))
    if opened_tab is not None:
        raise ReportValidationError("Tab is missing its closing tag")

    tabsets: list[_TabsetRange] = []
    assigned_tabs: set[str] = set()
    for index, (start, content_start, content_end, end) in enumerate(
        tabset_bounds, start=1
    ):
        children = [
            tab
            for tab in tabs
            if content_start <= tab.start and tab.end <= content_end
        ]
        if not children:
            raise ReportValidationError("Tabs must contain at least one Tab")
        remainder = body[content_start:content_end]
        for tab in reversed(children):
            relative_start = tab.start - content_start
            relative_end = tab.end - content_start
            remainder = remainder[:relative_start] + remainder[relative_end:]
            assigned_tabs.add(tab.id)
        if remainder.strip():
            raise ReportValidationError("Tabs may contain only Tab blocks")
        tabsets.append(
            _TabsetRange(
                start=start,
                content_start=content_start,
                content_end=content_end,
                end=end,
                id=f"tabs_{index:03d}",
                tabs=tuple(children),
            )
        )
    if len(assigned_tabs) != len(tabs):
        raise ReportValidationError("Tab must be declared directly inside Tabs")
    return tabsets, valid_starts


def _extract_components(
    body: str, config: ReportConfig
) -> tuple[list[ComponentSpec], list[LayoutItem]]:
    components: list[ComponentSpec] = []
    records: list[tuple[re.Match[str], ComponentSpec]] = []
    identifiers: set[str] = set()
    matches = list(_COMPONENT.finditer(body))
    rows, row_starts = _extract_rows(body)
    tabsets, tab_starts = _extract_tabs(body)
    valid_starts = {match.start() for match in matches}
    for start in _COMPONENT_START.finditer(body):
        if start.group(1) == "Row" and start.start() in row_starts:
            continue
        if start.group(1) in {"Tabs", "Tab"} and start.start() in tab_starts:
            continue
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
        if component_type == "BarChart":
            stack = attributes.setdefault("stack", "zero")
            if stack not in {"none", "zero", "normalize"}:
                raise ReportValidationError(
                    "BarChart stack must be one of: none, zero, normalize"
                )
            if stack == "normalize" and not ({"group", "color"} & set(attributes)):
                raise ReportValidationError(
                    "BarChart stack='normalize' requires a group or color attribute"
                )
            if "bar_width" in attributes:
                try:
                    bar_width = float(attributes["bar_width"])
                except (TypeError, ValueError) as exc:
                    raise ReportValidationError("BarChart bar_width must be a number") from exc
                if not math.isfinite(bar_width) or bar_width <= 0:
                    raise ReportValidationError("BarChart bar_width must be greater than zero")
                attributes["bar_width"] = (
                    int(bar_width) if bar_width.is_integer() else bar_width
                )
        if component_type == "LineChart":
            marker = attributes.setdefault("marker", "none")
            if marker not in {"none", "point", "circle"}:
                raise ReportValidationError(
                    "LineChart marker must be one of: none, point, circle"
                )
            color_scheme = attributes.get("color_scheme")
            if color_scheme is not None:
                if not str(color_scheme).strip():
                    raise ReportValidationError(
                        "LineChart color_scheme must not be empty"
                    )
                if not ({"group", "color"} & set(attributes)):
                    raise ReportValidationError(
                        "LineChart color_scheme requires a group or color attribute"
                    )
                attributes.setdefault("color_direction", "higher_is_darker")
            elif "color_direction" in attributes:
                raise ReportValidationError(
                    "LineChart color_direction requires color_scheme"
                )
        if component_type in {"LineChart", "Heatmap"} and "color_direction" in attributes:
            if attributes["color_direction"] not in {
                "higher_is_darker",
                "lower_is_darker",
            }:
                raise ReportValidationError(
                    f"{component_type} color_direction must be one of: "
                    "higher_is_darker, lower_is_darker"
                )
        if component_type == "Heatmap":
            color_scheme = attributes.setdefault("color_scheme", "blues")
            if not str(color_scheme).strip():
                raise ReportValidationError("Heatmap color_scheme must not be empty")
            attributes.setdefault("color_direction", "higher_is_darker")
            show_values = attributes.setdefault("show_values", True)
            if not isinstance(show_values, bool):
                raise ReportValidationError("Heatmap show_values must be true or false")
            heatmap_format = attributes.setdefault("format", "number")
            if heatmap_format not in {"number", "percent"}:
                raise ReportValidationError(
                    "Heatmap format must be one of: number, percent"
                )
        if component_type == "BigValue":
            value_format = attributes.get("format")
            if value_format is not None and value_format not in {
                "number",
                "currency",
                "percent",
            }:
                raise ReportValidationError(
                    "BigValue format must be one of: number, currency, percent"
                )
            notation = attributes.setdefault("notation", "compact")
            if notation not in {"standard", "compact"}:
                raise ReportValidationError(
                    "BigValue notation must be one of: standard, compact"
                )
            comparison_attributes = {"delta", "delta_label", "direction"}
            compare_value = attributes.get("compare_value")
            if compare_value is not None and not str(compare_value).strip():
                raise ReportValidationError("BigValue compare_value must not be empty")
            if compare_value is None:
                invalid = comparison_attributes & set(attributes)
                if invalid:
                    raise ReportValidationError(
                        "BigValue comparison attributes require compare_value: "
                        + ", ".join(sorted(invalid))
                    )
            else:
                delta = attributes.setdefault("delta", "both")
                if delta not in {"absolute", "percent", "both"}:
                    raise ReportValidationError(
                        "BigValue delta must be one of: absolute, percent, both"
                    )
                direction = attributes.setdefault("direction", "neutral")
                if direction not in {
                    "higher_is_better",
                    "lower_is_better",
                    "neutral",
                }:
                    raise ReportValidationError(
                        "BigValue direction must be one of: higher_is_better, "
                        "lower_is_better, neutral"
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
        if component_type == "Text" and not str(attributes["text"]).strip():
            raise ReportValidationError("Text text must not be empty")
        if component_type in {"Filters", "Text"}:
            placement = attributes.setdefault("placement", "content")
            if placement not in {"content", "sidebar"}:
                raise ReportValidationError(
                    f"{component_type} placement must be one of: content, sidebar"
                )
        component = ComponentSpec(
            id=component_id, type=component_type, query=query, props=attributes
        )
        components.append(component)
        records.append((match, component))

    row_layouts: dict[int, tuple[int, LayoutItem]] = {}
    row_component_ids: set[str] = set()
    for row_start, content_start, content_end, row_end in rows:
        children = [
            (match, component)
            for match, component in records
            if content_start <= match.start() and match.end() <= content_end
        ]
        remainder = body[content_start:content_end]
        for match, _component in reversed(children):
            relative_start = match.start() - content_start
            relative_end = match.end() - content_start
            remainder = remainder[:relative_start] + remainder[relative_end:]
        if remainder.strip():
            raise ReportValidationError("Row may contain only component declarations")
        if not children:
            raise ReportValidationError("Row must contain at least one component")
        if any(
            component.props.get("placement") == "sidebar"
            for _match, component in children
        ):
            raise ReportValidationError("sidebar components cannot be placed inside Row")
        child_ids = [component.id for _match, component in children]
        row_component_ids.update(child_ids)
        row_layouts[row_start] = (
            row_end,
            LayoutItem(type="row", components=child_ids),
        )

    layout_records: list[tuple[int, LayoutItem]] = []
    rows_in_tabs: set[int] = set()
    components_in_tabs: set[str] = set()
    for tabset in tabsets:
        compiled_tabs: list[TabLayout] = []
        for tab in tabset.tabs:
            tab_records: list[tuple[int, LayoutItem]] = []
            for row_start, (row_end, row_layout) in row_layouts.items():
                if tab.content_start <= row_start and row_end <= tab.content_end:
                    rows_in_tabs.add(row_start)
                    tab_records.append((row_start, row_layout))
            for match, component in records:
                if not (tab.content_start <= match.start() and match.end() <= tab.content_end):
                    continue
                components_in_tabs.add(component.id)
                if component.props.get("placement") == "sidebar":
                    raise ReportValidationError("sidebar components cannot be placed inside Tab")
                if component.id not in row_component_ids:
                    tab_records.append(
                        (match.start(), LayoutItem(type="component", component=component.id))
                    )
            if not tab_records:
                raise ReportValidationError("Tab must contain at least one component")
            compiled_tabs.append(
                TabLayout(
                    id=tab.id,
                    title=tab.title,
                    layout=[
                        item
                        for _position, item in sorted(
                            tab_records, key=lambda record: record[0]
                        )
                    ],
                )
            )
        layout_records.append(
            (
                tabset.start,
                LayoutItem(
                    type="tabs", tabset_id=tabset.id, tabs=compiled_tabs
                ),
            )
        )

    for row_start, (_row_end, row_layout) in row_layouts.items():
        if row_start not in rows_in_tabs:
            layout_records.append((row_start, row_layout))
    for match, component in records:
        if component.id not in row_component_ids and component.id not in components_in_tabs:
            layout_records.append(
                (match.start(), LayoutItem(type="component", component=component.id))
            )
    layout = [item for _position, item in sorted(layout_records, key=lambda item: item[0])]
    return components, layout


def _dependency_sql(sql: str) -> str:
    without_literals = re.sub(r"'(?:''|[^'])*'", "''", sql)
    return re.sub(r"/\*.*?\*/|--[^\r\n]*", " ", without_literals, flags=re.DOTALL)


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
    body = _strip_markdown_comments(body, first_body_line=closing_index + 2)
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
    components, layout = _extract_components(body_without_sql, config)
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
        layout=layout,
    )

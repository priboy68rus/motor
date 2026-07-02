from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FreshnessConfig(StrictModel):
    data_time_column: str | None = None
    processed_time_column: str | None = None
    max_lag_hours: float | None = Field(default=None, gt=0)


class DataSourceConfig(StrictModel):
    path: str
    freshness: FreshnessConfig | None = None


class ParamOptions(StrictModel):
    source: str
    column: str


class DimensionChoice(StrictModel):
    label: str | None = Field(default=None, min_length=1)
    field: str = Field(pattern=r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")


class ParamConfig(StrictModel):
    type: Literal["select", "multiselect", "date_range", "dimension"]
    label: str | None = Field(default=None, min_length=1)
    default: Any = "all"
    empty_behavior: Literal["all", "none"] | None = None
    control: Literal["auto", "checkboxes", "dropdown"] | None = None
    options: ParamOptions | None = None
    choices: dict[str, DimensionChoice] | None = None
    allow_none: bool | None = None

    @model_validator(mode="after")
    def validate_options(self) -> "ParamConfig":
        if self.type in {"date_range", "dimension"} and self.options is not None:
            raise ValueError(f"{self.type} parameters cannot declare options")
        if self.type in {"date_range", "dimension"} and self.empty_behavior is not None:
            raise ValueError(f"{self.type} parameters cannot declare empty_behavior")
        if self.type != "multiselect" and self.control is not None:
            raise ValueError("only multiselect parameters can declare control")
        if self.type != "dimension" and self.choices is not None:
            raise ValueError("only dimension parameters can declare choices")
        if self.type != "dimension" and self.allow_none is not None:
            raise ValueError("only dimension parameters can declare allow_none")
        if self.type in {"select", "multiselect"} and self.options is None:
            raise ValueError(f"{self.type} parameters must declare options")
        if self.type in {"select", "multiselect"} and self.empty_behavior is None:
            self.empty_behavior = "none"
        if self.type == "multiselect" and self.control is None:
            self.control = "auto"
        if self.type == "dimension":
            if not self.choices:
                raise ValueError("dimension parameters must declare choices")
            invalid_names = [
                name
                for name in self.choices
                if not name.isidentifier() or name == "none"
            ]
            if invalid_names:
                raise ValueError(
                    "dimension choice names must be identifiers and cannot use reserved name 'none'"
                )
            self.allow_none = bool(self.allow_none)
            if "default" not in self.model_fields_set:
                raise ValueError("dimension parameters must declare default")
            if not isinstance(self.default, str):
                raise ValueError("dimension parameter default must be a choice name or 'none'")
            if self.default == "none":
                if not self.allow_none:
                    raise ValueError("dimension default 'none' requires allow_none: true")
            elif self.default not in self.choices:
                raise ValueError(f"dimension default {self.default!r} is not a declared choice")
        return self


class ReportConfig(StrictModel):
    title: str = Field(min_length=1)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    spec_version: str = "0.1.0"
    timezone: str | None = None
    data: dict[str, DataSourceConfig] = Field(min_length=1)
    params: dict[str, ParamConfig] = Field(default_factory=dict)

    @field_validator("data", "params")
    @classmethod
    def names_must_be_sql_identifiers(cls, value: dict[str, Any]) -> dict[str, Any]:
        for name in value:
            if not name.isidentifier():
                raise ValueError(f"{name!r} is not a valid identifier")
        return value

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_iana_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown IANA timezone: {value}") from exc
        return value


class CheckResult(StrictModel):
    name: str
    status: Literal["passed", "warning"]
    message: str | None = None
    source: str | None = None


class SourcePassport(StrictModel):
    name: str
    file_name: str
    file_size_bytes: int
    rows: int
    columns: int
    column_names: list[str]
    inferred_column_types: dict[str, str]
    sha256: str
    loaded_into_report_at: datetime
    data_min_at: datetime | None = None
    data_max_at: datetime | None = None
    processed_at: datetime | None = None
    freshness_status: Literal["passed", "warning"] = "passed"


class ParsedReport(StrictModel):
    config: ReportConfig
    body: str
    source_sha256: str
    queries: dict[str, "QuerySpec"] = Field(default_factory=dict)
    components: list["ComponentSpec"] = Field(default_factory=list)
    layout: list["LayoutItem"] = Field(default_factory=list)


class QueryDependencies(StrictModel):
    sources: list[str] = Field(default_factory=list)
    params: list[str] = Field(default_factory=list)
    queries: list[str] = Field(default_factory=list)


class QuerySpec(StrictModel):
    name: str
    kind: Literal["view", "query"]
    sql_template: str
    depends_on: QueryDependencies = Field(default_factory=QueryDependencies)
    dimension_bindings: dict[str, str] = Field(default_factory=dict)


class ComponentSpec(StrictModel):
    id: str
    type: Literal[
        "Filters",
        "DataStatus",
        "VersionBadge",
        "BigValue",
        "Table",
        "LineChart",
        "BarChart",
    ]
    query: str | None = None
    props: dict[str, Any] = Field(default_factory=dict)


class TabLayout(StrictModel):
    id: str
    title: str
    layout: list["LayoutItem"] = Field(default_factory=list)


class LayoutItem(StrictModel):
    type: Literal["component", "row", "tabs"]
    component: str | None = None
    components: list[str] = Field(default_factory=list)
    tabset_id: str | None = None
    tabs: list[TabLayout] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_shape(self) -> "LayoutItem":
        if self.type == "component":
            if (
                self.component is None
                or self.components
                or self.tabset_id is not None
                or self.tabs
            ):
                raise ValueError("component layout items require exactly one component")
        elif self.type == "row":
            if (
                self.component is not None
                or not self.components
                or self.tabset_id is not None
                or self.tabs
            ):
                raise ValueError("row layout items require one or more components")
        elif (
            self.component is not None
            or self.components
            or self.tabset_id is None
            or not self.tabs
        ):
            raise ValueError("tabs layout items require a tabset id and one or more tabs")
        return self


class CompiledSource(StrictModel):
    passport: SourcePassport
    encoded_data: str


class BuildResult(StrictModel):
    output_path: str
    artifact_id: str
    output_sha256: str
    warnings: list[str]

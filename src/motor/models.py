from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FreshnessConfig(StrictModel):
    data_time_column: str | None = None
    processed_time_column: str | None = None
    max_lag_hours: float | None = Field(default=None, gt=0)


class DataSourceConfig(StrictModel):
    path: str
    freshness: FreshnessConfig | None = None


class ReportConfig(StrictModel):
    title: str = Field(min_length=1)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    spec_version: str = "0.1.0"
    timezone: str | None = None
    data: dict[str, DataSourceConfig] = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)

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


class CompiledSource(StrictModel):
    passport: SourcePassport
    encoded_data: str


class BuildResult(StrictModel):
    output_path: str
    artifact_id: str
    output_sha256: str
    warnings: list[str]

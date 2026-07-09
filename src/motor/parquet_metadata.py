from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, TypeVar

from motor.errors import ReportValidationError


_MAGIC = b"PAR1"

_STOP = 0
_TRUE = 1
_FALSE = 2
_BYTE = 3
_I16 = 4
_I32 = 5
_I64 = 6
_DOUBLE = 7
_BINARY = 8
_LIST = 9
_SET = 10
_MAP = 11
_STRUCT = 12
_FLOAT = 13

_BOOLEAN = 0
_INT32 = 1
_INT64 = 2
_INT96 = 3
_FLOAT_TYPE = 4
_DOUBLE_TYPE = 5
_BYTE_ARRAY = 6
_FIXED_LEN_BYTE_ARRAY = 7

_CONVERTED_UTF8 = 0
_CONVERTED_DATE = 6
_CONVERTED_TIMESTAMP_MILLIS = 9
_CONVERTED_TIMESTAMP_MICROS = 10

T = TypeVar("T")


@dataclass(frozen=True)
class LogicalTypeInfo:
    kind: str
    unit: str | None = None
    is_adjusted_to_utc: bool | None = None


@dataclass(frozen=True)
class SchemaElementInfo:
    name: str
    physical_type: int | None = None
    converted_type: int | None = None
    logical_type: LogicalTypeInfo | None = None
    num_children: int = 0


@dataclass(frozen=True)
class ColumnInfo:
    name: str
    path: tuple[str, ...]
    physical_type: int | None
    converted_type: int | None
    logical_type: LogicalTypeInfo | None


@dataclass(frozen=True)
class ColumnStatistics:
    minimum: bytes | None = None
    maximum: bytes | None = None


@dataclass(frozen=True)
class ParquetMetadata:
    row_count: int
    columns: list[ColumnInfo]
    statistics: dict[tuple[str, ...], list[ColumnStatistics]]


class _CompactReader:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._offset = 0

    def byte(self) -> int:
        if self._offset >= len(self._data):
            raise ReportValidationError("parquet footer is truncated")
        value = self._data[self._offset]
        self._offset += 1
        return value

    def bytes(self, length: int) -> bytes:
        if length < 0 or self._offset + length > len(self._data):
            raise ReportValidationError("parquet footer is truncated")
        value = self._data[self._offset : self._offset + length]
        self._offset += length
        return value

    def varint(self) -> int:
        shift = 0
        result = 0
        while True:
            byte = self.byte()
            result |= (byte & 0x7F) << shift
            if not byte & 0x80:
                return result
            shift += 7
            if shift > 63:
                raise ReportValidationError("parquet footer contains an invalid varint")

    def zigzag(self) -> int:
        value = self.varint()
        return (value >> 1) ^ -(value & 1)

    def binary(self) -> bytes:
        return self.bytes(self.varint())

    def string(self) -> str:
        try:
            return self.binary().decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ReportValidationError("parquet footer contains invalid UTF-8") from exc

    def field_header(self, previous_field_id: int) -> tuple[int, int] | None:
        header = self.byte()
        if header == _STOP:
            return None
        field_type = header & 0x0F
        field_delta = header >> 4
        field_id = previous_field_id + field_delta if field_delta else self.zigzag()
        return field_id, field_type

    def list_header(self) -> tuple[int, int]:
        header = self.byte()
        size = header >> 4
        item_type = header & 0x0F
        if size == 15:
            size = self.varint()
        return size, item_type

    def skip(self, thrift_type: int) -> None:
        if thrift_type in {_TRUE, _FALSE, _STOP}:
            return
        if thrift_type == _BYTE:
            self.byte()
            return
        if thrift_type in {_I16, _I32, _I64}:
            self.zigzag()
            return
        if thrift_type == _DOUBLE:
            self.bytes(8)
            return
        if thrift_type == _FLOAT:
            self.bytes(4)
            return
        if thrift_type == _BINARY:
            self.binary()
            return
        if thrift_type in {_LIST, _SET}:
            size, item_type = self.list_header()
            for _ in range(size):
                self.skip(item_type)
            return
        if thrift_type == _MAP:
            size = self.varint()
            if size:
                header = self.byte()
                key_type = header >> 4
                value_type = header & 0x0F
                for _ in range(size):
                    self.skip(key_type)
                    self.skip(value_type)
            return
        if thrift_type == _STRUCT:
            self.skip_struct()
            return
        raise ReportValidationError(f"parquet footer contains unsupported thrift type {thrift_type}")

    def skip_struct(self) -> None:
        previous_field_id = 0
        while True:
            header = self.field_header(previous_field_id)
            if header is None:
                return
            field_id, field_type = header
            previous_field_id = field_id
            self.skip(field_type)


def _read_i32(reader: _CompactReader, thrift_type: int) -> int:
    if thrift_type not in {_I16, _I32, _I64}:
        raise ReportValidationError("parquet footer field has an unexpected type")
    return int(reader.zigzag())


def _read_bool(reader: _CompactReader, thrift_type: int) -> bool:
    if thrift_type == _TRUE:
        return True
    if thrift_type == _FALSE:
        return False
    raise ReportValidationError("parquet footer boolean field has an unexpected type")


def _read_string_list(reader: _CompactReader, thrift_type: int) -> list[str]:
    if thrift_type != _LIST:
        raise ReportValidationError("parquet footer list field has an unexpected type")
    size, item_type = reader.list_header()
    if item_type != _BINARY:
        raise ReportValidationError("parquet footer path list has an unexpected item type")
    return [reader.string() for _ in range(size)]


def _read_struct_list(
    reader: _CompactReader,
    thrift_type: int,
    item_reader: Callable[[_CompactReader], T],
) -> list[T]:
    if thrift_type != _LIST:
        raise ReportValidationError("parquet footer list field has an unexpected type")
    size, item_type = reader.list_header()
    if item_type != _STRUCT:
        raise ReportValidationError("parquet footer list has an unexpected item type")
    return [item_reader(reader) for _ in range(size)]


def _read_logical_time_unit(reader: _CompactReader) -> str | None:
    previous_field_id = 0
    unit: str | None = None
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            return unit
        field_id, field_type = header
        previous_field_id = field_id
        if field_type != _STRUCT:
            reader.skip(field_type)
            continue
        if field_id == 1:
            unit = "millis"
        elif field_id == 2:
            unit = "micros"
        elif field_id == 3:
            unit = "nanos"
        reader.skip_struct()


def _read_timestamp_logical_type(reader: _CompactReader) -> LogicalTypeInfo:
    previous_field_id = 0
    is_adjusted: bool | None = None
    unit: str | None = None
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            return LogicalTypeInfo(
                kind="timestamp", unit=unit, is_adjusted_to_utc=is_adjusted
            )
        field_id, field_type = header
        previous_field_id = field_id
        if field_id == 1:
            is_adjusted = _read_bool(reader, field_type)
        elif field_id == 2 and field_type == _STRUCT:
            unit = _read_logical_time_unit(reader)
        else:
            reader.skip(field_type)


def _read_logical_type(reader: _CompactReader) -> LogicalTypeInfo | None:
    previous_field_id = 0
    logical: LogicalTypeInfo | None = None
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            return logical
        field_id, field_type = header
        previous_field_id = field_id
        if field_type != _STRUCT:
            reader.skip(field_type)
            continue
        if field_id == 1:
            logical = LogicalTypeInfo(kind="string")
            reader.skip_struct()
        elif field_id == 6:
            logical = LogicalTypeInfo(kind="date")
            reader.skip_struct()
        elif field_id == 8:
            logical = _read_timestamp_logical_type(reader)
        elif field_id == 5:
            logical = LogicalTypeInfo(kind="decimal")
            reader.skip_struct()
        else:
            reader.skip_struct()


def _read_schema_element(reader: _CompactReader) -> SchemaElementInfo:
    previous_field_id = 0
    name: str | None = None
    physical_type: int | None = None
    converted_type: int | None = None
    logical_type: LogicalTypeInfo | None = None
    num_children = 0
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            if name is None:
                raise ReportValidationError("parquet schema element is missing a name")
            return SchemaElementInfo(
                name=name,
                physical_type=physical_type,
                converted_type=converted_type,
                logical_type=logical_type,
                num_children=num_children,
            )
        field_id, field_type = header
        previous_field_id = field_id
        if field_id == 1:
            physical_type = _read_i32(reader, field_type)
        elif field_id == 4:
            if field_type != _BINARY:
                raise ReportValidationError("parquet schema element name has invalid type")
            name = reader.string()
        elif field_id == 5:
            num_children = _read_i32(reader, field_type)
        elif field_id == 6:
            converted_type = _read_i32(reader, field_type)
        elif field_id == 10 and field_type == _STRUCT:
            logical_type = _read_logical_type(reader)
        else:
            reader.skip(field_type)


def _read_statistics(reader: _CompactReader) -> ColumnStatistics:
    previous_field_id = 0
    old_min: bytes | None = None
    old_max: bytes | None = None
    min_value: bytes | None = None
    max_value: bytes | None = None
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            return ColumnStatistics(
                minimum=min_value if min_value is not None else old_min,
                maximum=max_value if max_value is not None else old_max,
            )
        field_id, field_type = header
        previous_field_id = field_id
        if field_type == _BINARY and field_id == 1:
            old_max = reader.binary()
        elif field_type == _BINARY and field_id == 2:
            old_min = reader.binary()
        elif field_type == _BINARY and field_id == 5:
            max_value = reader.binary()
        elif field_type == _BINARY and field_id == 6:
            min_value = reader.binary()
        else:
            reader.skip(field_type)


def _read_column_metadata(reader: _CompactReader) -> tuple[tuple[str, ...], ColumnStatistics | None]:
    previous_field_id = 0
    path: tuple[str, ...] = ()
    statistics: ColumnStatistics | None = None
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            return path, statistics
        field_id, field_type = header
        previous_field_id = field_id
        if field_id == 3:
            path = tuple(_read_string_list(reader, field_type))
        elif field_id == 12 and field_type == _STRUCT:
            statistics = _read_statistics(reader)
        else:
            reader.skip(field_type)


def _read_column_chunk(reader: _CompactReader) -> tuple[tuple[str, ...], ColumnStatistics | None]:
    previous_field_id = 0
    path: tuple[str, ...] = ()
    statistics: ColumnStatistics | None = None
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            return path, statistics
        field_id, field_type = header
        previous_field_id = field_id
        if field_id == 3 and field_type == _STRUCT:
            path, statistics = _read_column_metadata(reader)
        else:
            reader.skip(field_type)


def _read_row_group(reader: _CompactReader) -> list[tuple[tuple[str, ...], ColumnStatistics | None]]:
    previous_field_id = 0
    columns: list[tuple[tuple[str, ...], ColumnStatistics | None]] = []
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            return columns
        field_id, field_type = header
        previous_field_id = field_id
        if field_id == 1:
            columns = _read_struct_list(reader, field_type, _read_column_chunk)
        else:
            reader.skip(field_type)


def _read_file_metadata(footer: bytes) -> tuple[int, list[SchemaElementInfo], dict[tuple[str, ...], list[ColumnStatistics]]]:
    reader = _CompactReader(footer)
    previous_field_id = 0
    row_count: int | None = None
    schema: list[SchemaElementInfo] = []
    statistics: dict[tuple[str, ...], list[ColumnStatistics]] = {}
    while True:
        header = reader.field_header(previous_field_id)
        if header is None:
            if row_count is None:
                raise ReportValidationError("parquet metadata is missing row count")
            if not schema:
                raise ReportValidationError("parquet metadata is missing schema")
            return row_count, schema, statistics
        field_id, field_type = header
        previous_field_id = field_id
        if field_id == 2:
            schema = _read_struct_list(reader, field_type, _read_schema_element)
        elif field_id == 3:
            row_count = _read_i32(reader, field_type)
        elif field_id == 4:
            row_groups = _read_struct_list(reader, field_type, _read_row_group)
            for row_group in row_groups:
                for path, column_statistics in row_group:
                    if path and column_statistics:
                        statistics.setdefault(path, []).append(column_statistics)
        else:
            reader.skip(field_type)


def _leaf_columns(schema: list[SchemaElementInfo]) -> list[ColumnInfo]:
    if len(schema) < 2:
        raise ReportValidationError("parquet schema must contain at least one column")
    columns: list[ColumnInfo] = []
    index = 1

    def visit(parent_path: tuple[str, ...], count: int) -> None:
        nonlocal index
        for _ in range(count):
            if index >= len(schema):
                raise ReportValidationError("parquet schema is truncated")
            element = schema[index]
            index += 1
            path = (*parent_path, element.name)
            if element.num_children:
                visit(path, element.num_children)
            else:
                columns.append(
                    ColumnInfo(
                        name=".".join(path),
                        path=path,
                        physical_type=element.physical_type,
                        converted_type=element.converted_type,
                        logical_type=element.logical_type,
                    )
                )

    visit((), schema[0].num_children)
    if index != len(schema):
        raise ReportValidationError("parquet schema contains unreferenced elements")
    if not columns:
        raise ReportValidationError("parquet schema must contain at least one column")
    return columns


def read_parquet_metadata(raw: bytes, *, source: str) -> ParquetMetadata:
    if len(raw) < 12 or raw[:4] != _MAGIC or raw[-4:] != _MAGIC:
        raise ReportValidationError(f"source {source}: parquet file must start and end with PAR1")
    footer_length = struct.unpack("<I", raw[-8:-4])[0]
    footer_start = len(raw) - 8 - footer_length
    if footer_start < 4:
        raise ReportValidationError(f"source {source}: parquet footer length is invalid")
    row_count, schema, statistics = _read_file_metadata(raw[footer_start : len(raw) - 8])
    return ParquetMetadata(
        row_count=row_count,
        columns=_leaf_columns(schema),
        statistics=statistics,
    )


def parquet_type_name(column: ColumnInfo) -> str:
    logical = column.logical_type
    if logical and logical.kind in {"date", "timestamp"}:
        return "datetime"
    if logical and logical.kind == "string":
        return "string"
    if column.converted_type in {
        _CONVERTED_DATE,
        _CONVERTED_TIMESTAMP_MILLIS,
        _CONVERTED_TIMESTAMP_MICROS,
    }:
        return "datetime"
    if column.converted_type == _CONVERTED_UTF8:
        return "string"
    if column.physical_type == _BOOLEAN:
        return "boolean"
    if column.physical_type in {_INT32, _INT64}:
        return "integer"
    if column.physical_type in {_FLOAT_TYPE, _DOUBLE_TYPE}:
        return "number"
    return "string"


def _decode_integer_stat(value: bytes, byte_width: int) -> int:
    if len(value) != byte_width:
        raise ReportValidationError("parquet statistic has an unexpected byte width")
    return int.from_bytes(value, byteorder="little", signed=True)


def _timestamp_from_epoch(value: int, unit: str | None) -> datetime:
    if unit == "nanos":
        seconds = value / 1_000_000_000
    elif unit == "micros":
        seconds = value / 1_000_000
    else:
        seconds = value / 1_000
    return datetime.fromtimestamp(seconds, tz=timezone.utc)


def decode_parquet_datetime_stat(
    column: ColumnInfo,
    value: bytes,
    *,
    source: str,
) -> tuple[datetime, str]:
    logical = column.logical_type
    if logical and logical.kind == "date":
        days = _decode_integer_stat(value, 4)
        return datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=days), "date"
    if logical and logical.kind == "timestamp":
        epoch_value = _decode_integer_stat(value, 8)
        return _timestamp_from_epoch(epoch_value, logical.unit), "datetime"
    if column.converted_type == _CONVERTED_DATE:
        days = _decode_integer_stat(value, 4)
        return datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=days), "date"
    if column.converted_type == _CONVERTED_TIMESTAMP_MILLIS:
        return _timestamp_from_epoch(_decode_integer_stat(value, 8), "millis"), "datetime"
    if column.converted_type == _CONVERTED_TIMESTAMP_MICROS:
        return _timestamp_from_epoch(_decode_integer_stat(value, 8), "micros"), "datetime"
    if column.physical_type == _BYTE_ARRAY:
        try:
            text = value.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ReportValidationError(
                f"source {source}: parquet freshness column {'.'.join(column.path)!r} "
                "has non-UTF-8 statistics"
            ) from exc
        stripped = text.strip()
        date_only = len(stripped) == 10
        try:
            parsed = datetime.fromisoformat(stripped.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ReportValidationError(
                f"source {source}: parquet freshness column {'.'.join(column.path)!r} "
                "statistics are not ISO 8601 datetimes"
            ) from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed, "date" if date_only else "datetime"
    raise ReportValidationError(
        f"source {source}: parquet freshness column {'.'.join(column.path)!r} "
        "does not expose supported date/datetime statistics"
    )

import {
  normalizeSignedRows,
  normalizeStandardRows,
  type SignedNormalization,
} from "./charts/stackNormalization";
import type { ComponentSpec, QueryRow } from "./types";
import { utils, writeFileXLSX, type WorkBook } from "xlsx";

export type ComponentCsvData = {
  columns: string[];
  rows: QueryRow[];
};

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function commaSeparatedFields(value: unknown): string[] {
  if (value == null) return [];
  return String(value)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function sourceOrderedColumns(rows: QueryRow[], requested: string[]): string[] {
  const sourceColumns = Object.keys(rows[0] ?? {});
  const requestedSet = new Set(requested);
  return [
    ...sourceColumns.filter((column) => requestedSet.has(column)),
    ...requested.filter((column) => !sourceColumns.includes(column)),
  ];
}

function uniqueDerivedColumn(rows: QueryRow[], columns: string[], base: string): string {
  let candidate = base;
  while (columns.includes(candidate) || rows.some((row) => Object.hasOwn(row, candidate))) {
    candidate += "_";
  }
  return candidate;
}

function temporalValues(rows: QueryRow[], field: string): boolean {
  const sample = rows.find((row) => row[field] != null)?.[field];
  return (
    sample instanceof Date ||
    (typeof sample === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(sample) &&
      !Number.isNaN(Date.parse(sample)))
  );
}

function normalizedRows(
  component: ComponentSpec,
  rows: QueryRow[],
  x: string,
  y: string,
): { rows: QueryRow[]; sourceField: string } | undefined {
  if (component.type !== "BarChart") return undefined;
  const stack = String(component.props.stack ?? "zero");
  const temporalX = temporalValues(rows, x);
  if (stack === "normalize") {
    const normalized = normalizeStandardRows(rows, x, y, temporalX);
    return { rows: normalized.rows, sourceField: normalized.field };
  }
  if (stack === "normalize_gross" || stack === "normalize_net") {
    const normalized = normalizeSignedRows(
      rows,
      x,
      y,
      temporalX,
      stack as SignedNormalization,
    );
    return { rows: normalized.rows, sourceField: normalized.field };
  }
  return undefined;
}

export function componentCsvData(
  component: ComponentSpec,
  rows: QueryRow[],
): ComponentCsvData {
  if (component.type === "Table") {
    const configured = commaSeparatedFields(component.props.columns);
    const columns = configured.length > 0 ? configured : Object.keys(rows[0] ?? {});
    return {
      columns,
      rows: rows.map((row) =>
        Object.fromEntries(columns.map((column) => [column, row[column]])),
      ),
    };
  }

  if (component.type === "Heatmap") {
    const requested = unique([
      String(component.props.x),
      String(component.props.y),
      String(component.props.value),
      component.props.row_metric == null ? undefined : String(component.props.row_metric),
      ...commaSeparatedFields(component.props.details),
    ]);
    const columns = sourceOrderedColumns(rows, requested);
    return {
      columns,
      rows: rows.map((row) =>
        Object.fromEntries(columns.map((column) => [column, row[column]])),
      ),
    };
  }

  if (component.type === "LineChart" || component.type === "BarChart") {
    const x = String(component.props.x);
    const y = String(component.props.y);
    const series = component.props.group ?? component.props.color;
    const requested = unique([
      x,
      y,
      series == null ? undefined : String(series),
      ...commaSeparatedFields(component.props.details),
    ]);
    const columns = sourceOrderedColumns(rows, requested);
    const normalization = normalizedRows(component, rows, x, y);
    if (!normalization) {
      return {
        columns,
        rows: rows.map((row) =>
          Object.fromEntries(columns.map((column) => [column, row[column]])),
        ),
      };
    }
    const normalizedColumn = uniqueDerivedColumn(rows, columns, `${y}_normalized`);
    const yIndex = columns.indexOf(y);
    const outputColumns = [...columns];
    outputColumns.splice(yIndex >= 0 ? yIndex + 1 : outputColumns.length, 0, normalizedColumn);
    return {
      columns: outputColumns,
      rows: normalization.rows.map((row) =>
        Object.fromEntries(
          outputColumns.map((column) => [
            column,
            column === normalizedColumn ? row[normalization.sourceField] : row[column],
          ]),
        ),
      ),
    };
  }

  return { columns: [], rows: [] };
}

function scalarText(value: unknown): { text: string; protectFormula: boolean } {
  if (value == null) return { text: "", protectFormula: false };
  if (value instanceof Date) return { text: value.toISOString(), protectFormula: false };
  if (typeof value === "string") return { text: value, protectFormula: true };
  if (typeof value === "object") {
    try {
      return { text: JSON.stringify(value), protectFormula: false };
    } catch {
      return { text: String(value), protectFormula: false };
    }
  }
  return { text: String(value), protectFormula: false };
}

function csvCell(value: unknown): string {
  const scalar = scalarText(value);
  const safeText =
    scalar.protectFormula && /^[=+\-@\t\r]/.test(scalar.text)
      ? `'${scalar.text}`
      : scalar.text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replaceAll('"', '""')}"` : safeText;
}

export function serializeComponentCsv(data: ComponentCsvData): string {
  const lines = [
    data.columns.map(csvCell).join(","),
    ...data.rows.map((row) => data.columns.map((column) => csvCell(row[column])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function componentCsvFilename(
  reportSlug: string,
  componentId: string,
  now = new Date(),
): string {
  return componentDownloadFilename(reportSlug, componentId, "csv", now);
}

export type ComponentDownloadFormat = "csv" | "xlsx";

export function componentDownloadFilename(
  reportSlug: string,
  componentId: string,
  format: ComponentDownloadFormat,
  now = new Date(),
): string {
  const safe = (value: string): string =>
    value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${safe(reportSlug)}-${safe(componentId)}-${timestamp}.${format}`;
}

function xlsxCell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function componentXlsxSheetName(value: string): string {
  const sanitized = value
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, 31)
    .trim();
  return sanitized || "Data";
}

export function componentXlsxWorkbook(
  data: ComponentCsvData,
  sheetName = "Data",
): WorkBook {
  const values = [
    data.columns,
    ...data.rows.map((row) => data.columns.map((column) => xlsxCell(row[column]))),
  ];
  const worksheet = utils.aoa_to_sheet(values);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, componentXlsxSheetName(sheetName));
  return workbook;
}

export function downloadComponentCsv(
  reportSlug: string,
  component: ComponentSpec,
  rows: QueryRow[],
): void {
  const data = componentCsvData(component, rows);
  const blob = new Blob([serializeComponentCsv(data)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = componentCsvFilename(reportSlug, component.id);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadComponentXlsx(
  reportSlug: string,
  component: ComponentSpec,
  rows: QueryRow[],
): void {
  const workbook = componentXlsxWorkbook(
    componentCsvData(component, rows),
    String(component.props.title ?? component.id),
  );
  writeFileXLSX(
    workbook,
    componentDownloadFilename(reportSlug, component.id, "xlsx"),
    { compression: true },
  );
}

export type SignedNormalization = "normalize_gross" | "normalize_net";

export type StackRow = Record<string, unknown>;

function numericValue(value: unknown): number | undefined {
  if (value == null || (typeof value === "string" && value.trim() === "")) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function rowKey(value: unknown, temporal: boolean): string {
  if (temporal && value != null) {
    const timestamp =
      value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
    if (!Number.isNaN(timestamp)) return `date:${timestamp}`;
  }
  if (typeof value === "number") return `number:${value}`;
  if (typeof value === "string") return `string:${value}`;
  return `json:${JSON.stringify(value)}`;
}

function displayValue(value: unknown): string {
  return value == null || String(value).trim() === "" ? "—" : String(value);
}

function internalFieldName(rows: StackRow[], base: string): string {
  let field = base;
  while (rows.some((row) => Object.hasOwn(row, field))) field += "_";
  return field;
}

export function validateStandardNormalize(rows: StackRow[], x: string, y: string): void {
  const negative = rows.find((row) => {
    const value = numericValue(row[y]);
    return value != null && value < 0;
  });
  if (!negative) return;
  throw new Error(
    `BarChart stack='normalize' requires non-negative ${y} values; ` +
      `found ${negative[y]} at ${x}=${displayValue(negative[x])}. ` +
      "Use normalize_gross or normalize_net for signed values.",
  );
}

export function normalizeStandardRows(
  rows: StackRow[],
  x: string,
  y: string,
  temporalX: boolean,
): { rows: StackRow[]; field: string; label: string } {
  validateStandardNormalize(rows, x, y);
  const field = internalFieldName(rows, "__motor_normalized_value");
  const totals = new Map<string, number>();
  for (const row of rows) {
    const value = numericValue(row[y]);
    if (value == null) continue;
    const key = rowKey(row[x], temporalX);
    totals.set(key, (totals.get(key) ?? 0) + value);
  }
  return {
    field,
    label: "Share",
    rows: rows.map((row) => {
      const value = numericValue(row[y]);
      const total = totals.get(rowKey(row[x], temporalX));
      return {
        ...row,
        [field]: value == null ? null : total ? value / total : 0,
      };
    }),
  };
}

export function normalizeSignedRows(
  rows: StackRow[],
  x: string,
  y: string,
  temporalX: boolean,
  mode: SignedNormalization,
): { rows: StackRow[]; field: string; label: string } {
  const field = internalFieldName(rows, "__motor_normalized_value");
  const totals = new Map<string, { net: number; gross: number }>();
  for (const row of rows) {
    const value = numericValue(row[y]);
    if (value == null) continue;
    const key = rowKey(row[x], temporalX);
    const total = totals.get(key) ?? { net: 0, gross: 0 };
    total.net += value;
    total.gross += Math.abs(value);
    totals.set(key, total);
  }

  if (mode === "normalize_net") {
    for (const row of rows) {
      const value = numericValue(row[y]);
      if (value == null) continue;
      const total = totals.get(rowKey(row[x], temporalX));
      if (!total || total.net === 0) {
        throw new Error(
          `BarChart stack='normalize_net' cannot normalize ${x}=${displayValue(row[x])}: ` +
            `sum(${y}) is zero. Use normalize_gross or stack='zero'.`,
        );
      }
    }
  }

  return {
    field,
    label: mode === "normalize_gross" ? "Gross share" : "Net contribution",
    rows: rows.map((row) => {
      const value = numericValue(row[y]);
      const total = totals.get(rowKey(row[x], temporalX));
      const denominator = mode === "normalize_gross" ? total?.gross : Math.abs(total?.net ?? 0);
      const normalized = value == null ? null : denominator ? value / denominator : 0;
      return { ...row, [field]: normalized };
    }),
  };
}

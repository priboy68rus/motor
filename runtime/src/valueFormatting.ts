export type ValueFormat = "number" | "currency" | "percent";
export type ValueNotation = "standard" | "compact";

export type ValueFormatOptions = {
  format?: ValueFormat;
  currency?: string;
  notation?: ValueNotation;
};

function formatterOptions(
  options: ValueFormatOptions,
  signed: boolean,
): Intl.NumberFormatOptions {
  const format = options.format ?? "number";
  const notation = options.notation ?? "standard";
  const result: Intl.NumberFormatOptions = {
    ...(signed ? { signDisplay: "always" } : {}),
    ...(format === "currency"
      ? { style: "currency", currency: options.currency ?? "USD" }
      : format === "percent"
        ? { style: "percent", maximumFractionDigits: 1 }
        : {}),
    ...(notation === "compact"
      ? { notation: "compact", compactDisplay: "short", maximumFractionDigits: 1 }
      : {}),
  };
  return result;
}

export function formatValue(value: unknown, options: ValueFormatOptions = {}): string {
  if (value == null) return "—";
  const numericFormat =
    typeof value === "number" ||
    typeof value === "bigint" ||
    options.format === "currency" ||
    options.format === "percent" ||
    options.notation === "compact";
  if (numericFormat) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return new Intl.NumberFormat(undefined, formatterOptions(options, false)).format(number);
    }
  }
  return String(value);
}

export function formatSignedValue(value: number, options: ValueFormatOptions = {}): string {
  return new Intl.NumberFormat(undefined, formatterOptions(options, true)).format(value);
}

export function formatSignedPercent(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "always",
  }).format(value);
}

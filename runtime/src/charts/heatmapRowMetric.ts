import type { QueryRow } from "../types";
import { formatValue, type ValueFormatOptions } from "../valueFormatting";

export const ROW_METRIC_DISPLAY_FIELD = "__motor_row_metric_display";
export const ROW_METRIC_TOOLTIP_FIELD = "__motor_row_metric_tooltip";

function rowKey(value: unknown): string {
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (typeof value === "number") return `number:${value}`;
  if (typeof value === "string") return `string:${value}`;
  return `json:${JSON.stringify(value)}`;
}

function rowLabel(value: unknown): string {
  return value == null || String(value).trim() === "" ? "—" : String(value);
}

export type HeatmapRowMetric = {
  rows: QueryRow[];
  tooltipByRow: Map<string, string>;
};

export function buildHeatmapRowMetric(
  rows: QueryRow[],
  yField: string,
  metricField: string,
  displayFormat: ValueFormatOptions,
): HeatmapRowMetric {
  const grouped = new Map<
    string,
    { y: unknown; numericValue?: number; originalValue?: unknown }
  >();

  for (const row of rows) {
    const yValue = row[yField];
    const key = rowKey(yValue);
    let group = grouped.get(key);
    if (!group) {
      group = { y: yValue };
      grouped.set(key, group);
    }

    const rawValue = row[metricField];
    if (rawValue == null || String(rawValue).trim() === "") continue;
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      throw new Error(
        `Heatmap row_metric ${JSON.stringify(metricField)} must be numeric for ` +
          `${yField}=${rowLabel(yValue)}`,
      );
    }
    if (group.numericValue != null && group.numericValue !== numericValue) {
      throw new Error(
        `Heatmap row_metric ${JSON.stringify(metricField)} has multiple values for ` +
          `${yField}=${rowLabel(yValue)}: ${group.numericValue} and ${numericValue}`,
      );
    }
    group.numericValue = numericValue;
    group.originalValue = rawValue;
  }

  const tooltipByRow = new Map<string, string>();
  const metricRows = [...grouped.entries()].map(([key, group]) => {
    const display = formatValue(group.originalValue, displayFormat);
    const tooltip = formatValue(group.originalValue, {
      ...displayFormat,
      notation: "standard",
    });
    tooltipByRow.set(key, tooltip);
    return {
      [yField]: group.y,
      [ROW_METRIC_DISPLAY_FIELD]: display,
      [ROW_METRIC_TOOLTIP_FIELD]: tooltip,
    };
  });

  return { rows: metricRows, tooltipByRow };
}

export function heatmapRowMetricKey(value: unknown): string {
  return rowKey(value);
}

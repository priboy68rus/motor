export type RuntimeMetricStatus = "running" | "done" | "failed";

export type RuntimeMetric = {
  key: string;
  label: string;
  status: RuntimeMetricStatus;
  started_ms: number;
  duration_ms?: number;
  detail?: string;
};

export type RuntimeMetricsSnapshot = {
  started_at: string;
  finished_at?: string;
  total_ms?: number;
  current?: string;
  items: RuntimeMetric[];
};

export type RuntimeMetricHandle = {
  end: (detail?: string) => void;
  fail: (detail?: string) => void;
};

declare global {
  interface Window {
    __motorLoadingMetrics?: RuntimeMetricsSnapshot;
  }
}

function now(): number {
  return performance.now();
}

function roundedMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RuntimeMetrics {
  private readonly startTime = now();
  private readonly startedAt = new Date();
  private finishedAt?: Date;
  private current?: string;
  private sequence = 0;
  private readonly items: RuntimeMetric[] = [];

  constructor(private readonly onChange?: (snapshot: RuntimeMetricsSnapshot) => void) {
    this.publish();
  }

  setCurrent(message: string): void {
    this.current = message;
    this.publish();
  }

  start(label: string, detail?: string): RuntimeMetricHandle {
    const item: RuntimeMetric = {
      key: `metric_${String(++this.sequence).padStart(3, "0")}`,
      label,
      status: "running",
      started_ms: roundedMs(now() - this.startTime),
      detail,
    };
    this.items.push(item);
    this.current = label;
    this.publish();
    let settled = false;
    const settle = (status: RuntimeMetricStatus, finalDetail?: string): void => {
      if (settled) return;
      settled = true;
      item.status = status;
      item.duration_ms = roundedMs(now() - this.startTime - item.started_ms);
      if (finalDetail !== undefined) item.detail = finalDetail;
      this.publish();
    };
    return {
      end: (finalDetail?: string) => settle("done", finalDetail),
      fail: (finalDetail?: string) => settle("failed", finalDetail),
    };
  }

  async measure<T>(
    label: string,
    detail: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    const metric = this.start(label, detail);
    try {
      const result = await action();
      metric.end();
      return result;
    } catch (error) {
      metric.fail(errorDetail(error));
      throw error;
    }
  }

  finish(): void {
    this.finishedAt = new Date();
    this.current = undefined;
    this.publish();
  }

  snapshot(): RuntimeMetricsSnapshot {
    const end = this.finishedAt ? this.finishedAt.getTime() : Date.now();
    const totalMs = end - this.startedAt.getTime();
    return {
      started_at: this.startedAt.toISOString(),
      finished_at: this.finishedAt?.toISOString(),
      total_ms: roundedMs(totalMs),
      current: this.current,
      items: this.items.map((item) => ({ ...item })),
    };
  }

  private publish(): void {
    const snapshot = this.snapshot();
    if (typeof window !== "undefined") window.__motorLoadingMetrics = snapshot;
    this.onChange?.(snapshot);
  }
}

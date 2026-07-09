export type Manifest = {
  report: { title: string; timezone: string };
  artifact: { id: string; content_sha256: string };
  build: { built_at: string; tool_name: string; tool_version: string; runtime_version: string };
  freshness: { status: "passed" | "warning"; data_through: string | null; processed_at: string | null };
  sources: {
    name: string;
    rows: number;
    data_max_at?: string | null;
    data_time_granularity?: "date" | "datetime" | null;
    processed_at?: string | null;
    processed_time_granularity?: "date" | "datetime" | null;
    freshness_status: "passed" | "warning";
  }[];
  checks: { status: "passed" | "warning" };
};

export type ParamSpec = {
  type: "select" | "multiselect" | "date_range" | "dimension";
  label?: string;
  default: unknown;
  empty_behavior?: "all" | "none";
  control?: "auto" | "checkboxes" | "radio" | "dropdown";
  options?: { source: string; column: string };
  choices?: Record<string, { label?: string; field: string }>;
  allow_none?: boolean;
};

export type QuerySpec = {
  kind: "view" | "query";
  sql_template: string;
  depends_on: { sources: string[]; params: string[]; queries: string[] };
  dimension_bindings: Record<string, string>;
};

export type ComponentSpec = {
  id: string;
  type:
    | "Filters"
    | "Text"
    | "DataStatus"
    | "VersionBadge"
    | "LoadingMetrics"
    | "BigValue"
    | "Table"
    | "LineChart"
    | "BarChart"
    | "Heatmap";
  query?: string;
  props: Record<string, unknown>;
};

export type TabLayout = { id: string; title: string; layout: LayoutItem[] };

export type LayoutItem =
  | { type: "component"; component: string }
  | { type: "row"; components: string[] }
  | { type: "tabs"; tabset_id: string; tabs: TabLayout[] };

export type ReportSpec = {
  report: { title: string; slug: string; timezone: string };
  data: Record<string, { path: string }>;
  params: Record<string, ParamSpec>;
  queries: Record<string, QuerySpec>;
  components: ComponentSpec[];
  layout?: LayoutItem[];
  body: string;
};

export type QueryRow = Record<string, unknown>;
export type QueryResults = Record<string, QueryRow[]>;
export type ParamValues = Record<string, unknown>;
export type ParamOptions = Record<string, unknown[]>;

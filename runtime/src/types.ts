export type Manifest = {
  report: { title: string; timezone: string };
  artifact: { id: string; content_sha256: string };
  build: { built_at: string; tool_name: string; tool_version: string; runtime_version: string };
  freshness: { status: "passed" | "warning"; data_through: string | null; processed_at: string | null };
  checks: { status: "passed" | "warning" };
};

export type ParamSpec = {
  type: "select" | "multiselect" | "date_range" | "dimension";
  label?: string;
  default: unknown;
  empty_behavior?: "all" | "none";
  control?: "auto" | "checkboxes" | "dropdown";
  options?: { source: string; column: string };
  choices?: Record<string, { label?: string; field: string }>;
  allow_none?: boolean;
};

export type QuerySpec = {
  kind: "view" | "query";
  sql_template: string;
  depends_on: { sources: string[]; params: string[]; queries: string[] };
};

export type ComponentSpec = {
  id: string;
  type: "Filters" | "DataStatus" | "VersionBadge" | "BigValue" | "Table" | "LineChart" | "BarChart";
  query?: string;
  props: Record<string, unknown>;
};

export type LayoutItem =
  | { type: "component"; component: string }
  | { type: "row"; components: string[] };

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

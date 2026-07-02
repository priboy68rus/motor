export type Manifest = {
  report: { title: string; timezone: string };
  artifact: { id: string };
  build: { built_at: string; tool_name: string; tool_version: string };
  freshness: { status: "passed" | "warning"; data_through: string | null; processed_at: string | null };
  checks: { status: "passed" | "warning" };
};

export type ParamSpec = {
  type: "select" | "multiselect" | "date_range";
  default: unknown;
  empty_behavior?: "all" | "none";
  options?: { source: string; column: string };
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

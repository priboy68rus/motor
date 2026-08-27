import type { ParamValues, QueryRow, ReportSpec } from "./types";
import { renderQueryTemplate } from "./queryTemplates";

type DebugSqlRunner = {
  debugSql: (sql: string) => Promise<QueryRow[]>;
};

export type MotorDebugQuery = {
  name: string;
  kind: "view" | "query";
};

export type MotorDebugApi = {
  sql: (sql: string) => Promise<QueryRow[]>;
  querySql: (name: string) => string;
  params: () => ParamValues;
  queries: () => MotorDebugQuery[];
};

declare global {
  interface Window {
    motorDebug?: MotorDebugApi;
  }
}

export function createMotorDebugApi(
  runner: DebugSqlRunner,
  spec: ReportSpec,
  currentValues: () => ParamValues,
): MotorDebugApi {
  return {
    async sql(sql: string): Promise<QueryRow[]> {
      if (typeof sql !== "string" || sql.trim() === "") {
        throw new Error("motorDebug.sql requires a non-empty SQL string");
      }
      return runner.debugSql(sql);
    },
    querySql(name: string): string {
      const query = spec.queries[name];
      if (!query) throw new Error(`unknown motor query: ${name}`);
      return renderQueryTemplate(query, spec.params, currentValues());
    },
    params(): ParamValues {
      return structuredClone(currentValues());
    },
    queries(): MotorDebugQuery[] {
      return Object.entries(spec.queries).map(([name, query]) => ({
        name,
        kind: query.kind,
      }));
    },
  };
}

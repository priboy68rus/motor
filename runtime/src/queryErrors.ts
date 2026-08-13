type FailureCause = {
  name: string;
  kind: "view" | "query";
  message: string;
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class QueryFailures {
  private causes = new Map<string, FailureCause[]>();

  fail(name: string, kind: FailureCause["kind"], error: unknown, sql: string): string {
    const message = errorDetail(error);
    this.causes.set(name, [{ name, kind, message }]);
    return `Query: ${name}\n${message}\n\nRendered SQL:\n${sql}`;
  }

  skip(name: string, failedDependencies: readonly string[]): string {
    const causes = failedDependencies.flatMap((dependency) => this.causes.get(dependency) ?? []);
    const uniqueCauses = [
      ...new Map(causes.map((cause) => [`${cause.kind}\u0000${cause.name}`, cause])).values(),
    ];
    this.causes.set(name, uniqueCauses);

    const dependencyLabel = failedDependencies.length === 1 ? "dependency" : "dependencies";
    const causeDetail =
      uniqueCauses.length === 1
        ? `Caused by ${uniqueCauses[0]?.kind} ${uniqueCauses[0]?.name}:\n${uniqueCauses[0]?.message}`
        : `Caused by:\n${uniqueCauses
            .map((cause) => `${cause.kind} ${cause.name}: ${cause.message}`)
            .join("\n\n")}`;
    return (
      `Query: ${name}\nSkipped because ${dependencyLabel} failed: ` +
      `${failedDependencies.join(", ")}\n\n${causeDetail}`
    );
  }
}

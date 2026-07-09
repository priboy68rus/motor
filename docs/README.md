# motor documentation

This directory is the canonical user documentation for the current motor
report format and runtime. The README gives a short introduction; the files
below describe the complete supported contract.

## Documentation map

- [Getting started](getting-started.md) — install motor, validate and build a
  minimal report.
- [Report file reference](report-file.md) — file structure, YAML frontmatter,
  CSV/Parquet sources, freshness checks, comments, naming rules, and validation.
- [Parameters and filters](parameters.md) — every parameter type and field,
  defaults, controls, selection semantics, and reactivity.
- [SQL reference](sql.md) — named SQL blocks, views, queries, dependencies,
  CTEs, template helpers, caching, and error diagnostics.
- [Components reference](components.md) — every component and attribute,
  required fields, defaults, allowed values, formatting, and chart behavior.
- [Layout reference](layout.md) — source order, rows, tabs, sticky sidebar,
  responsive behavior, and parameter scope.
- [CLI, artifacts, and runtime](cli-and-runtime.md) — all CLI commands, output
  artifact contents, browser requirements, manifest identity, and security.

## Contract conventions

Reference tables use these conventions:

- **Required** means the report does not validate without the field.
- **Default** is the value inserted by the compiler or runtime when the field
  is omitted.
- Unknown YAML fields, component attributes, component types, and SQL template
  expressions are rejected unless a reference page explicitly says otherwise.
- Attribute names and enum values are case-sensitive.
- Examples show quoted component attributes. Unquoted values without spaces
  may parse, but quoting all attribute values is the stable authoring style.

The documentation describes the behavior of the current `master` branch.
`spec_version` currently defaults to `0.1.0` and is recorded as metadata; the
compiler does not yet dispatch behavior or validation by specification version.

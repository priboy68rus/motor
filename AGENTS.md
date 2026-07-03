# Repository Instructions

## Command output hygiene

Prefer concise, targeted command output to avoid wasting context.

For Git:
- Use `git status --short` before broader Git inspection.
- Use `git diff --stat` or `git diff --name-only` before full `git diff`.
- Use full `git diff` only for specific files or when needed:
  `git diff -- path/to/file`.

For build/test/lint commands:
- Prefer commands/options that produce concise output when available.
- When output may be very large, redirect to a log and inspect the relevant tail.
- If a command fails, inspect the first relevant error and surrounding context before reading the entire log.
- Do not suppress errors completely; preserve enough output to diagnose the issue.

Avoid pasting or reading huge logs unless the concise output is insufficient.

## Project Workflow

- After every meaningful code change, run build/packaging.
- Before committing intended source/configuration changes, run tests.
- Commit the intended source/configuration changes with a short, descriptive message.
- Push the commit to GitHub, normally `origin main` unless working on another branch.

## Documentation

- Treat `docs/` as the canonical user-facing reference for the supported report
  format, components, SQL helpers, CLI, artifact, and runtime behavior.
- Every change to a user-visible field, default, allowed value, validation rule,
  component, SQL helper, layout rule, CLI command, or runtime behavior must
  update the relevant `docs/` page in the same change.
- Keep documentation tables explicit about field type, whether it is required,
  its default, every supported value, and important interactions or errors.
- Keep README examples and links consistent with `docs/`, while avoiding making
  README the only place where a supported feature is documented.
- Review documentation accuracy against implementation and tests before
  committing. Do not document planned behavior as already supported.

## Notes

- Use PLAN.md as reference for architectural and functional details of the project.
- Do not commit unrelated working-tree changes.
- If packaging fails, report the error instead of pushing an unverified change.

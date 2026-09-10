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

- Never implement a feature directly on `master`.
- Before changing files, inspect `git status` and preserve all pre-existing user
  changes. Do not include unrelated changes in a commit or pull request.
- Start each independent change from an up-to-date `origin/master` in its own
  branch. Use `feature/<short-name>`, `fix/<short-name>`, or
  `chore/<short-name>`.
- Keep one logical feature or fix per branch and add or update tests with it.
- After every meaningful code change, run Python tests and packaging:

  ```bash
  .venv/bin/python -m pytest
  .venv/bin/python -m build
  ```

- For runtime changes, also run:

  ```bash
  cd runtime
  npm run check
  npm test
  npm run build
  ```

- Commit the intended changes with a short descriptive message, push the topic
  branch, and open a pull request targeting `master`.
- Never merge the pull request. The repository owner performs the final manual
  merge after CI passes. An approving review is not required for this solo-owner
  workflow; the manual merge itself is the approval gate.

## Publishing a release

PyPI releases are published by `.github/workflows/release.yml` through Trusted
Publishing. Treat publication as irreversible.

- Do not edit a static package version. `setuptools-scm` derives the installed
  version from `vX.Y.Z` tags; `pyproject.toml` contains only the initial fallback.
- Do not manually create or push patch-release tags and do not publish locally
  during normal feature work.
- Every pull request merged into `master` starts the release workflow. It reruns
  tests, increments the patch component of the highest `vX.Y.Z` tag, tags the
  merged commit, builds that exact version, publishes it to PyPI, and creates a
  GitHub Release with the wheel and source distribution.
- Concurrent merges are serialized. A rerun for an already-tagged merged commit
  reuses its tag instead of incrementing the version again.
- The `pypi` GitHub Environment intentionally has no required reviewers, so no
  second approval is needed after the owner manually merges the feature PR.
- Minor and major releases are exceptional and must be coordinated explicitly
  before merge; the normal workflow always increments patch.
- After publication, verify the public release in a fresh virtual environment:

   ```bash
   release_check_dir=$(mktemp -d /tmp/motor-release-check.XXXXXX)
   python3 -m venv "$release_check_dir"
   "$release_check_dir/bin/pip" install --no-cache-dir "motor-reports==X.Y.Z"
   "$release_check_dir/bin/motor" --help
   ```

Never overwrite, delete, or reuse a version already published to PyPI. If a
workflow fails after the PyPI upload succeeds, inspect the remote state before
retrying; PyPI release files are immutable.

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

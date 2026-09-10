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
- Push the commit to GitHub, normally `origin master` unless working on another branch.

## Publishing a release

PyPI releases are published by `.github/workflows/release.yml` through Trusted
Publishing. Treat publication as irreversible: do not create or push a release
tag unless the user explicitly requests publication of that exact version.

For a new version `X.Y.Z`:

1. Start from a clean, up-to-date `master` branch and confirm that neither the
   `vX.Y.Z` Git tag nor `motor-reports==X.Y.Z` already exists remotely.
2. Update the version in both `pyproject.toml` and
   `src/motor/__init__.py`. Update version-specific documentation when needed.
3. Run the release checks locally:

   ```bash
   .venv/bin/python -m pytest
   .venv/bin/python -m build
   ```

   Do not proceed if tests or packaging fail. The release workflow repeats the
   tests, builds the wheel and sdist, and validates them with `twine check`.
4. Commit the release changes and push `master` before tagging the exact commit:

   ```bash
   git push origin master
   git tag -a "vX.Y.Z" -m "Release X.Y.Z"
   git push origin "vX.Y.Z"
   ```

5. Monitor the `Release` GitHub Actions workflow. After the build succeeds,
   approve the protected `pypi` environment deployment. A successful run
   publishes to PyPI and creates a GitHub Release containing the wheel and
   source distribution.
6. Verify the public release in a fresh virtual environment:

   ```bash
   release_check_dir=$(mktemp -d /tmp/motor-release-check.XXXXXX)
   python3 -m venv "$release_check_dir"
   "$release_check_dir/bin/pip" install --no-cache-dir "motor-reports==X.Y.Z"
   "$release_check_dir/bin/motor" --help
   ```

Never overwrite, delete, or reuse a version already published to PyPI. If a
workflow fails after the PyPI upload succeeds, inspect the remote state before
retrying; rerunning the upload for the same files will fail because PyPI release
files are immutable.

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

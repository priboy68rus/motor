"""Choose the next patch release from the repository's vX.Y.Z tags."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import tomllib
from pathlib import Path

VERSION_TAG = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def parse_version_tag(tag: str) -> tuple[int, int, int] | None:
    match = VERSION_TAG.fullmatch(tag)
    if match is None:
        return None
    major, minor, patch = match.groups()
    return int(major), int(minor), int(patch)


def choose_release_version(
    all_tags: list[str], head_tags: list[str], fallback: str
) -> tuple[str, str]:
    """Return ``(version, tag)``; reuse a HEAD tag when retrying a release."""
    tagged_head_versions = [
        parsed for tag in head_tags if (parsed := parse_version_tag(tag)) is not None
    ]
    if tagged_head_versions:
        selected = max(tagged_head_versions)
    else:
        release_versions = [
            parsed for tag in all_tags if (parsed := parse_version_tag(tag)) is not None
        ]
        fallback_version = parse_version_tag(f"v{fallback}")
        if fallback_version is None:
            raise ValueError(
                "tool.setuptools_scm.fallback_version must have X.Y.Z format"
            )
        major, minor, patch = max([fallback_version, *release_versions])
        selected = major, minor, patch + 1

    version = ".".join(str(part) for part in selected)
    return version, f"v{version}"


def git_tags(*args: str) -> list[str]:
    output = subprocess.check_output(["git", "tag", *args], text=True)
    return [line.strip() for line in output.splitlines() if line.strip()]


def fallback_version(pyproject: Path) -> str:
    with pyproject.open("rb") as stream:
        document = tomllib.load(stream)
    try:
        return document["tool"]["setuptools_scm"]["fallback_version"]
    except KeyError as error:
        raise ValueError(
            "pyproject.toml must define tool.setuptools_scm.fallback_version"
        ) from error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pyproject", type=Path, default=Path("pyproject.toml"))
    parser.add_argument(
        "--github-output",
        type=Path,
        default=(
            Path(os.environ["GITHUB_OUTPUT"])
            if "GITHUB_OUTPUT" in os.environ
            else None
        ),
    )
    args = parser.parse_args()

    version, tag = choose_release_version(
        git_tags(),
        git_tags("--points-at", "HEAD"),
        fallback_version(args.pyproject),
    )
    print(version)
    if args.github_output is not None:
        with args.github_output.open("a", encoding="utf-8") as stream:
            stream.write(f"version={version}\ntag={tag}\n")


if __name__ == "__main__":
    main()

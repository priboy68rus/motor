from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from motor.compiler import build_report, compile_report
from motor.errors import MotorError
from motor.inspect import inspect_artifact


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="motor", description="Build trusted portable BI artifacts")
    subcommands = parser.add_subparsers(dest="command", required=True)

    build = subcommands.add_parser("build", help="build a self-contained HTML report")
    build.add_argument("report", type=Path)
    build.add_argument("--out", type=Path, required=True)

    validate = subcommands.add_parser("validate", help="validate a report and its CSV sources")
    validate.add_argument("report", type=Path)

    inspect = subcommands.add_parser("inspect", help="print an artifact's embedded manifest")
    inspect.add_argument("artifact", type=Path)
    inspect.add_argument("--json", action="store_true", dest="as_json")
    return parser


def _print_manifest_summary(manifest: dict) -> None:
    print(f"Report: {manifest['report']['title']}")
    print(f"Artifact: {manifest['artifact']['id']}")
    print(f"Built: {manifest['build']['built_at']}")
    print(f"Checks: {manifest['checks']['status']}")
    for source in manifest["sources"]:
        print(f"Source {source['name']}: {source['rows']} rows, sha256 {source['sha256']}")


def run(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "build":
            result = build_report(args.report, args.out)
            print(f"Built {result.output_path}")
            print(f"Artifact: {result.artifact_id}")
            print(f"HTML sha256: {result.output_sha256}")
            for warning in result.warnings:
                print(f"Warning: {warning}", file=sys.stderr)
            return 0
        if args.command == "validate":
            manifest, _, _ = compile_report(args.report)
            print(f"Valid: {args.report}")
            _print_manifest_summary(manifest)
            return 0
        if args.command == "inspect":
            manifest = inspect_artifact(args.artifact)
            if args.as_json:
                print(json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True))
            else:
                _print_manifest_summary(manifest)
            return 0
    except MotorError as exc:
        print(f"motor: error: {exc}", file=sys.stderr)
        return 2
    return 1


def main() -> None:
    raise SystemExit(run())

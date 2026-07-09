from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Sequence

from motor.compiler import build_report, compile_report
from motor.errors import MotorError
from motor.inspect import inspect_artifact
from motor.update_server import serve_update_registry


def _configured_registry(value: Path | None) -> Path | None:
    if value is not None:
        return value
    configured = os.environ.get("MOTOR_UPDATE_REGISTRY")
    if configured:
        return Path(configured)
    return None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="motor", description="Build trusted portable BI artifacts")
    subcommands = parser.add_subparsers(dest="command", required=True)

    build = subcommands.add_parser("build", help="build a self-contained HTML report")
    build.add_argument("report", type=Path)
    build.add_argument("--out", type=Path, required=True)
    build.add_argument(
        "--update-registry",
        type=Path,
        help=(
            "directory where latest-version metadata is written for motor server; "
            "defaults to MOTOR_UPDATE_REGISTRY when set"
        ),
    )

    validate = subcommands.add_parser("validate", help="validate a report and its data sources")
    validate.add_argument("report", type=Path)

    inspect = subcommands.add_parser("inspect", help="print an artifact's embedded manifest")
    inspect.add_argument("artifact", type=Path)
    inspect.add_argument("--json", action="store_true", dest="as_json")

    server = subcommands.add_parser("server", help="serve report latest-version metadata")
    server.add_argument(
        "--registry",
        type=Path,
        help=(
            "directory containing reports/<slug>.json metadata; "
            "defaults to MOTOR_UPDATE_REGISTRY"
        ),
    )
    server.add_argument("--host", default="127.0.0.1", help="bind address")
    server.add_argument("--port", type=int, default=8765, help="bind port")
    return parser


def _print_manifest_summary(manifest: dict) -> None:
    print(f"Report: {manifest['report']['title']}")
    print(f"Artifact: {manifest['artifact']['id']}")
    print(f"Built: {manifest['build']['built_at']}")
    print(f"Checks: {manifest['checks']['status']}")
    for source in manifest["sources"]:
        source_format = source.get("source_format", "csv")
        print(
            f"Source {source['name']} ({source_format}): "
            f"{source['rows']} rows, sha256 {source['sha256']}"
        )


def run(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "build":
            result = build_report(
                args.report,
                args.out,
                update_registry=_configured_registry(args.update_registry),
            )
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
        if args.command == "server":
            registry = _configured_registry(args.registry)
            if registry is None:
                print(
                    "motor: error: --registry or MOTOR_UPDATE_REGISTRY is required",
                    file=sys.stderr,
                )
                return 2
            try:
                serve_update_registry(registry, host=args.host, port=args.port)
            except KeyboardInterrupt:
                print("\nStopped motor update server")
            return 0
    except MotorError as exc:
        print(f"motor: error: {exc}", file=sys.stderr)
        return 2
    return 1


def main() -> None:
    raise SystemExit(run())

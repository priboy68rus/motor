from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class UpdateRegistryServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], registry: Path) -> None:
        self.registry = registry.expanduser().resolve()
        super().__init__(server_address, UpdateRegistryHandler)


class UpdateRegistryHandler(BaseHTTPRequestHandler):
    server: UpdateRegistryServer

    def log_message(self, format: str, *args: Any) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(200, {"status": "ok"})
            return

        match = re.fullmatch(r"/reports/([^/]+)\.json", parsed.path)
        if match is None:
            self._send_json(404, {"error": "not_found"})
            return

        slug = unquote(match.group(1))
        if _SLUG.fullmatch(slug) is None:
            self._send_json(400, {"error": "invalid_slug"})
            return

        path = self.server.registry / "reports" / f"{slug}.json"
        if not path.is_file():
            self._send_json(404, {"error": "not_found"})
            return

        try:
            payload = path.read_bytes()
        except OSError:
            self._send_json(500, {"error": "read_failed"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def serve_update_registry(registry: Path, *, host: str, port: int) -> None:
    server = UpdateRegistryServer((host, port), registry)
    with server:
        print(
            f"Serving motor update registry {server.registry} at http://{host}:{port}",
            flush=True,
        )
        server.serve_forever()

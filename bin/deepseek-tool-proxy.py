#!/usr/bin/env python3
"""
deepseek-tool-proxy - minimal local proxy for Droid's BYOK DeepSeek custom model.

Why: Droid with provider "openai" registers its patch tool in the OpenAI
Responses API format as {type:"custom", name:"ApplyPatch", ...}. DeepSeek's
Responses API only accepts the custom tool named exactly "apply_patch" and
rejects anything else with HTTP 400 ("Unsupported custom tool: 'ApplyPatch'.
Only 'apply_patch' is supported."). This proxy rewrites that one name in the
request body before forwarding to api.deepseek.com, so the Responses API
transport (streaming, auth, caching) is otherwise untouched.

Usage:
    python3 deepseek-tool-proxy.py                # listen on 127.0.0.1:8798
    DEEPSEEK_PROXY_PORT=9000 python3 ...          # override port
    DEEPSEEK_PROXY_UPSTREAM=https://... python3 ...  # override upstream

Point the Droid custom model's baseUrl at http://127.0.0.1:8798 and keep
provider "openai" and the api.deepseek.com API key as-is.
"""
import os
import sys
import logging
import socketserver
import http.server
import urllib.request
import urllib.error

HOST = os.environ.get("DEEPSEEK_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("DEEPSEEK_PROXY_PORT", "8798"))
UPSTREAM = os.environ.get("DEEPSEEK_PROXY_UPSTREAM", "https://api.deepseek.com")

# The single rewrite rule that fixes DeepSeek's 400. This exact JSON token is
# the only place Droid emits the tool name on the wire (tool_choice is "auto").
REWRITES = [
    (b'"name":"ApplyPatch"', b'"name":"apply_patch"'),
]

# Headers that must not be forwarded verbatim.
HOP_HEADERS = {"host", "content-length", "accept-encoding", "connection"}

log = logging.getLogger("deepseek-tool-proxy")


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    # HTTP/1.0 + Connection: close keeps the response framing trivial while
    # streaming SSE events back to the client (no chunked encoding needed).
    protocol_version = "HTTP/1.0"

    def _forward(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            if body is not None:
                for old, new in REWRITES:
                    if old in body:
                        body = body.replace(old, new)
                        log.info("rewrote %r -> %r for %s %s", old, new, self.command, self.path)

            req = urllib.request.Request(UPSTREAM + self.path, data=body, method=self.command)
            for key, value in self.headers.items():
                if key.lower() in HOP_HEADERS:
                    continue
                req.add_header(key, value)

            try:
                upstream = urllib.request.urlopen(req, timeout=900)
            except urllib.error.HTTPError as err:
                upstream = err  # forward upstream 4xx/5xx verbatim

            with upstream:
                self.send_response(upstream.status)
                self.send_header(
                    "Content-Type",
                    upstream.headers.get("Content-Type", "application/json"),
                )
                self.send_header("Connection", "close")
                self.end_headers()
                while True:
                    chunk = upstream.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            log.info("%s %s -> %s", self.command, self.path, upstream.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            log.exception("error proxying %s %s", self.command, self.path)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _forward

    def log_message(self, fmt, *args):  # silence default per-request noise
        log.debug(fmt, *args)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    try:
        server = ThreadingHTTPServer((HOST, PORT), ProxyHandler)
    except OSError as exc:
        log.error("cannot bind %s:%s: %s", HOST, PORT, exc)
        sys.exit(1)
    log.info("deepseek-tool-proxy listening on http://%s:%s -> %s", HOST, PORT, UPSTREAM)
    server.serve_forever()


if __name__ == "__main__":
    main()

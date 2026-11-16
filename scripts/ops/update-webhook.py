#!/usr/bin/env python3
# Runs scripts/auto-update.sh as soon as GitHub reports a push, instead of waiting for the next cron run. Point a
# GitHub repository webhook (push events, content type application/json, a secret) at it through your proxy or
# tunnel. See "Automatic updates" in docs/self-hosting/setup.md. Python's standard library only, for Docker hosts.
#
# Settings, as environment variables:
#   UPDATE_WEBHOOK_SECRET  the webhook's secret, required
#   UPDATE_WEBHOOK_BIND    address to listen on, 127.0.0.1 by default
#   UPDATE_WEBHOOK_PORT    port to listen on, 32172 by default
#   UPDATE_WEBHOOK_REF     the pushed ref that triggers an update, refs/heads/main by default
#   UPDATE_SCRIPT          what to run, scripts/auto-update.sh next to this file by default
# auto-update.sh's own settings (ENV_FILE, NOTIFY_WEBHOOK, ...) pass through from this process's environment.

import hashlib
import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("UPDATE_WEBHOOK_SECRET", "").encode()
if not SECRET:
    sys.exit("set UPDATE_WEBHOOK_SECRET to the secret of the GitHub webhook")
BIND = os.environ.get("UPDATE_WEBHOOK_BIND", "127.0.0.1")
PORT = int(os.environ.get("UPDATE_WEBHOOK_PORT", "32172"))
REF = os.environ.get("UPDATE_WEBHOOK_REF", "refs/heads/main")
SCRIPT = os.environ.get("UPDATE_SCRIPT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "auto-update.sh"))
MAX_BODY = 25 * 1024 * 1024  # GitHub caps webhook payloads at 25 MB

# One update at a time. A push that arrives during a run starts one more run when it ends, so it is never skipped.
wanted = threading.Event()


def updater():
    while True:
        wanted.wait()
        wanted.clear()
        print("running " + SCRIPT, flush=True)
        status = subprocess.call([SCRIPT])
        print(f"{os.path.basename(SCRIPT)} exited with {status}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, text):
        body = (text + "\n").encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.reply(400, "bad length")
        body = self.rfile.read(length)
        expected = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, self.headers.get("x-hub-signature-256", "")):
            return self.reply(401, "bad signature")
        event = self.headers.get("x-github-event", "")
        if event == "ping":
            return self.reply(200, "pong")
        if event != "push":
            return self.reply(202, "ignored " + event)
        try:
            ref = json.loads(body).get("ref")
        except ValueError:
            return self.reply(400, "bad json")
        if ref != REF:
            return self.reply(202, f"ignored {ref}")
        wanted.set()
        return self.reply(202, "updating")

    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    threading.Thread(target=updater, daemon=True).start()
    print(f"listening on {BIND}:{PORT} for pushes to {REF}", flush=True)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()

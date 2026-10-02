"""Flask entry point for the family tree application."""

import os
from pathlib import Path

from flask import Flask, jsonify, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=None)


@app.get("/health")
def health():
    """Health endpoint used by Coolify and container checks."""
    return jsonify(status="ok")


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:filename>")
def files(filename: str):
    """Serve the existing static frontend without exposing paths outside BASE_DIR."""
    return send_from_directory(BASE_DIR, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)

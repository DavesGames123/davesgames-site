#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "$1" == "--install" ]]; then
    echo "▸ Installing dependencies…"
    pip install -r "$DIR/requirements.txt"
    echo "▸ Done."
    echo ""
fi

echo "╔══════════════════════════════════════╗"
echo "║   Material Lab  ·  localhost:8787    ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "▸ Models download on first use (~2-3 GB)."
echo "▸ GPU recommended. Ctrl+C to stop."
echo ""

cd "$DIR"
python server.py

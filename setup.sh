#!/bin/bash
set -e

SKILL_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEST="$HOME/.review-as-me"

mkdir -p "$DEST"
cp "$SKILL_DIR/server.js" "$DEST/server.js"

echo "✓ Created $DEST"
echo "✓ Copied server.js → $DEST/server.js"
echo ""
echo "Start the review UI anytime with:"
echo "  node ~/.review-as-me/server.js"

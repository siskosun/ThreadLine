#!/bin/sh
# Install the tracked hook into THIS clone only (Git Bash compatible).
set -eu

ROOT=$(git rev-parse --show-toplevel)
SOURCE="$ROOT/.githooks/pre-push"
if [ ! -f "$SOURCE" ]; then
  echo "ThreadLine hook source missing: $SOURCE" >&2
  exit 1
fi

CUSTOM=$(git config --local --get core.hooksPath || true)
if [ -n "$CUSTOM" ]; then
  echo "core.hooksPath is already configured ($CUSTOM)." >&2
  echo "No hook was installed. Integrate it into your existing hooks directory." >&2
  exit 1
fi

TARGET=$(git rev-parse --git-path hooks/pre-push)
case "$TARGET" in
  /*|?:/*) ;;
  *) TARGET="$ROOT/$TARGET" ;;
esac

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  if [ -f "$TARGET" ] && cmp -s "$SOURCE" "$TARGET"; then
    chmod +x "$TARGET"
    echo "ThreadLine pre-push already installed: $TARGET"
    exit 0
  fi
  echo "Existing pre-push hook was NOT replaced: $TARGET" >&2
  echo "Merge the ThreadLine checks into that hook manually." >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
cp "$SOURCE" "$TARGET"
chmod +x "$TARGET"
echo "Installed ThreadLine pre-push: $TARGET"
echo "Run 'sh .githooks/pre-push' once to verify your local Node environment."

#!/usr/bin/env bash
# Jalanin Agent HQ di macOS/Linux tanpa Docker.
# Butuh Node 24+.
set -e
cd "$(dirname "$0")"
export CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude/projects}"
export CURSOR_DIR="${CURSOR_DIR:-$HOME/.cursor/projects}"
export OPENCODE_DB="${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
exec node --disable-warning=ExperimentalWarning server.js

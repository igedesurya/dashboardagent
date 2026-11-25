#!/bin/sh
# Install (or remove) the Agent HQ orchestrator as a per-user macOS LaunchAgent.
# It then starts at login, restarts if it crashes, and listens only on 127.0.0.1:5180.
#   ./install-launchd.sh            install / update
#   ./install-launchd.sh uninstall  remove
set -e
LABEL=com.agenthq.orchestrator
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
LOGDIR="$HOME/.agent-hq/logs"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "$1" = "uninstall" ]; then
  rm -f "$PLIST"
  echo "Orchestrator dihapus dari layanan login."
  exit 0
fi
[ -n "$NODE" ] || { echo "node tidak ditemukan"; exit 1; }
mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$HOME/.local/bin:$HOME/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/orchestrator.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/orchestrator.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Orchestrator terpasang dan berjalan: http://127.0.0.1:5180 (log: $LOGDIR/orchestrator.log)"

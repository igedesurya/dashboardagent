# Agent HQ

A visual dashboard for monitoring AI agents (Claude Code, Cursor, opencode, Grok Bot) in real time on your Mac. The UI is isometric: each agent becomes a chibi character that moves depending on its state (coding, reading, thinking, waiting, idle, error).

The server only **reads** data from your local Claude/Cursor/opencode/Grok folders — it never modifies them. No npm dependencies; it just needs Node 24 (for `node:sqlite`, which reads the opencode database).

## Requirements

- macOS (the Claude/Cursor/Grok Bot data defaults to macOS paths)
- Node.js 24+ (to run directly), **or** Docker Desktop (recommended)
- Each agent you want to monitor must have run at least once so there is data to read

## Usage (recommended: Docker)

```bash
git clone git@github.com:igedesurya/dashboardagent.git
cd dashboardagent
docker compose up -d --build
```

Open http://127.0.0.1:5173

Stop:

```bash
docker compose down
```

Update to the latest version:

```bash
git pull
docker compose up -d --build
```

> Data is mounted read-only (`:ro`) from the original folders on your machine, so the container never modifies your Claude/Cursor/opencode/Grok data. The container only listens on `127.0.0.1:5173`, so it is not reachable from other machines.

### Linux

The same compose file works on Linux (the Claude/Cursor/opencode paths are identical). Grok Bot is macOS-only and its mount is marked `create_host_path: false`, so on Linux that mount is simply skipped and everything else keeps working:

```bash
git clone git@github.com:igedesurya/dashboardagent.git
cd dashboardagent
docker compose up -d --build
```

### Windows (Docker Desktop)

Use the dedicated compose file, which uses `%USERPROFILE%` and skips the macOS-only Grok Bot data:

```powershell
git clone git@github.com:igedesurya/dashboardagent.git
cd dashboardagent
docker compose -f docker-compose.windows.yml up -d --build
```

Open http://127.0.0.1:5173. If your Claude/Cursor/opencode data lives somewhere else, edit the volume paths in `docker-compose.windows.yml` (use forward slashes, e.g. `C:/Users/you/.claude/projects`).

### Native (no Docker) on Linux / Windows

The server itself is cross-platform (it relies on `os.homedir()`). On Linux the default paths work as-is. On Windows, point the env vars at your real folders:

```powershell
$env:CLAUDE_DIR = "C:/Users/you/.claude/projects"
$env:CURSOR_DIR = "C:/Users/you/.cursor/projects"
$env:OPENCODE_DB = "C:/Users/you/.local/share/opencode/opencode.db"
node --disable-warning=ExperimentalWarning server.js
```

## Usage (without Docker)

```bash
git clone git@github.com:igedesurya/dashboardagent.git
cd dashboardagent
node --disable-warning=ExperimentalWarning server.js
```

Open http://127.0.0.1:5173

Node 24+ is required because `node:sqlite` is used to read the opencode database.

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5173` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to expose on the network) |
| `WINDOW_MIN` | `1440` (24 hours) | Sessions older than this are hidden |
| `CLAUDE_DIR` | `~/.claude/projects` | Claude Code data folder |
| `CURSOR_DIR` | `~/.cursor/projects` | Cursor data folder |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | opencode database |
| `GROK_DIR` | `~/Library/Application Support/Grok Bot/sand-client-persistence` | Grok Bot data |
| `HOST_USER` | OS user | Used to tidy up Cursor project names |

Example: `WINDOW_MIN=10080 node server.js` to show the last 7 days of sessions.

## Supported agents

These are the agents Agent HQ can detect **automatically** — no configuration needed as long as the agent has run at least once on this machine.

| Agent | Where the data is read from | Auto-detected | Notes |
|---|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | ✅ Yes | Supports subagents; excludes sidechains |
| **Cursor** | `~/.cursor/projects/**/*.jsonl` | ✅ Yes | Project names tidied using `HOST_USER` |
| **opencode** | `~/.local/share/opencode/opencode.db` (SQLite) | ✅ Yes | Supports both the legacy `session` schema and the newer `session_v2` (opencode 2.x) |
| **Grok Bot** | `~/Library/Application Support/Grok Bot/...` | ✅ macOS only | Desktop app data; not available on Linux/Windows |
| **Any other bot / custom agent** | `POST /api/events` | Manual (push) | See "Integrating other agents" below |

### Integrating other agents (`POST /api/events`)

Any tool that can make an HTTP request can show up on the dashboard — a cron job, a CI pipeline, a Telegram bot, a Python/Node script, etc. Just `POST` a small JSON payload to `/api/events` every time the agent changes state.

```bash
curl -X POST http://127.0.0.1:5173/api/events \
  -H 'content-type: application/json' \
  -d '{
    "source": "mybot",
    "agent": "Sari",
    "status": "coding",
    "task": "refactoring the payment module",
    "tool": "edit",
    "model": "gpt-5",
    "project": "checkout-service",
    "tokens": 12450
  }'
```

| Field | Required | Description |
|---|---|---|
| `source` | No | Group label (default `grok`). Lowercase letters, digits, `_`, `-` (max 16 chars) |
| `agent` / `name` | No | Display name on the dashboard (default `Grok`) |
| `status` / `state` | **Yes** | One of `coding`, `running`, `reading`, `waiting`, `thinking`, `idle`, `error`, or `offline` to remove the agent |
| `task` | No | Short activity text shown next to the character |
| `tool` | No | Tool name currently in use |
| `model` | No | Model label |
| `project` | No | Project name |
| `tokens` | No | Token count (number) |

The agent is identified by `source:agent`, so **reuse the same values** on every call to update an existing agent instead of creating a new one. An agent disappears on its own if it sends no updates for longer than `WINDOW_MIN` (default 24 hours), or immediately if you send `"status": "offline"`.

Minimal example (report "done" and hide the agent):

```bash
curl -X POST http://127.0.0.1:5173/api/events \
  -H 'content-type: application/json' \
  -d '{"source":"mybot","agent":"Sari","status":"offline"}'
```

> If the dashboard runs in Docker, `127.0.0.1:5173` works from the host machine. From another container, use `host.docker.internal:5173` instead.

## Troubleshooting

**Nothing shows up / "why isn't it connecting to my agents?"**

Agent HQ does not connect to agents over a network — it reads their local files. So an agent only appears if:

1. **That agent has actually run on this machine at least once.** A fresh install with no history shows an empty dashboard. Run Claude Code / Cursor / opencode once, then refresh.
2. **The activity is recent enough.** Sessions older than `WINDOW_MIN` (default 24 hours) are hidden. Try a longer window:
   ```bash
   WINDOW_MIN=10080 docker compose up -d    # 7 days
   ```
3. **The data folders are really there.** Check inside the container:
   ```bash
   docker compose exec agent-hq ls /data/claude /data/cursor /data/opencode
   ```
   - Empty or "No such file" → the folder doesn't exist on your host, or it lives somewhere else. Set the path yourself (see the `environment`/`volumes` sections in `docker-compose.yml`).
   - Claude Code / Cursor must be *logged in and used* under the same OS user that runs Docker.

**The dashboard loads but stays empty on Linux/Windows**

Expected for the Grok Bot rows: the Grok Bot desktop app is macOS-only, so it can never appear on Linux or Windows. Claude Code, Cursor and opencode should still show up — if they don't, verify the paths in step 3 above.

**opencode never appears**

- The database must exist at `~/.local/share/opencode/opencode.db`.
- The server needs **Node 24+** for `node:sqlite`. On older Node the server still runs but logs `opencode nonaktif: node:sqlite tidak tersedia`. Check with:
  ```bash
  docker compose logs agent-hq | head -5
  ```
- On native runs, confirm Node's version: `node --version` (must be v24 or newer).

**Port 5173 is already in use**

```bash
lsof -i:5173        # macOS/Linux
```
Stop the other process, or change the published port in `docker-compose.yml` (e.g. `"127.0.0.1:5273:5173"`).

**I can't open it from another device on my network**

That's intentional — it binds to `127.0.0.1` only. Set `HOST=0.0.0.0` and publish the port if you really need it, and put it behind your own auth/proxy.

**Still stuck?** Open an issue with the output of `docker compose logs agent-hq` and the result of the `ls /data/...` check above.

## API

- `GET /api/agents` — snapshot of all active agents (JSON)
- `GET /api/stream` — Server-Sent Events for automatic updates
- `POST /api/events` — receive reports from external bots

## Security

- All data access is **read-only**; the dashboard never writes to the agent folders.
- Binds to `127.0.0.1` by default. To expose it on the network, set `HOST=0.0.0.0` and put it behind your own reverse proxy/auth.
- This repository is public and the `main` branch is protected: only the maintainer can push directly, while other contributors must open a PR and get 1 approval.

## License

Not yet specified.

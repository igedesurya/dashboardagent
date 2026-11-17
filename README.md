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

> Data is mounted read-only (`:ro`) from the original folders on your Mac, so the container never modifies your Claude/Cursor/opencode/Grok data. The container only listens on `127.0.0.1:5173`, so it is not reachable from other machines.

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

## Data sources

- **Claude Code** — JSONL files in `~/.claude/projects/`
- **Cursor** — JSONL files in `~/.cursor/projects/`
- **opencode** — SQLite `opencode.db` (supports both the legacy `session` schema and the newer `session_v2`)
- **Grok Bot** — local bot transcript cache
- **Other bots** — send events via `POST /api/events` (see the payload format in `server.js`)

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

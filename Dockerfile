# Agent HQ — tanpa dependensi npm. Node 24 dibutuhkan untuk node:sqlite (opencode).
FROM node:24-alpine

WORKDIR /app
COPY server.js ./
COPY mockup ./mockup

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173 \
    CLAUDE_DIR=/data/claude \
    CURSOR_DIR=/data/cursor \
    OPENCODE_DB=/data/opencode/opencode.db \
    GROK_DIR=/data/grok

USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:5173/api/agents >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]

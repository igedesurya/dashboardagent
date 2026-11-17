# Jalanin Agent HQ di Windows tanpa Docker.
# Butuh Node 24+.  Jalankan:  powershell -ExecutionPolicy Bypass -File start.ps1
Set-Location $PSScriptRoot
if (-not $env:CLAUDE_DIR)   { $env:CLAUDE_DIR   = "$env:USERPROFILE\.claude\projects" }
if (-not $env:CURSOR_DIR)   { $env:CURSOR_DIR   = "$env:USERPROFILE\.cursor\projects" }
if (-not $env:OPENCODE_DB)  { $env:OPENCODE_DB  = "$env:USERPROFILE\.local\share\opencode\opencode.db" }
node --disable-warning=ExperimentalWarning server.js

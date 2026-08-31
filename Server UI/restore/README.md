# restore/

Pre-change copies of `Server UI/**` files, written automatically by
`.claude/hooks/backup_serverui.py` (a Claude Code PreToolUse hook) immediately before
each edit.

- **Latest copy only** — the copy is overwritten on every edit, so `restore/<path>` is the
  file exactly as it was just before the most recent change.
- Mirrors the sub-path: e.g. `Server UI/server/api_server.py` → `Server UI/restore/server/api_server.py`.
- Committed to git (not ignored).

## Roll a file back

```
cp "Server UI/restore/<path>" "Server UI/<path>"
```

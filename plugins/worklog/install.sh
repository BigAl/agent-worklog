#!/usr/bin/env bash
# Worklog installer — OpenCode plugin + Claude Code hook + skill + report CLI.
#
# Idempotent: safe to re-run. Idempotency keys: existing files are
# overwritten with the repo's copies; hooks are only added to
# ~/.claude/settings.json when not already wired (a pre-edit backup is kept).
#
# What it touches:
#   ~/.local/share/worklog/{lib,bin}     shared core + report CLI
#   ~/.config/opencode/plugins/worklog/  OpenCode plugin
#   ~/.claude/hooks/worklog-heartbeat.mjs + settings.json (Stop, UserPromptSubmit)
#   ~/.config/opencode/skills/worklog/ + ~/.claude/skills/worklog/
#   ~/.config/worklog/jira.env           template only, never overwritten
#
# Restart OpenCode afterwards so the plugin loads.

set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$SRC/tools"
WORK="$HOME/.local/share/worklog"
HOOK="$HOME/.claude/hooks/worklog-heartbeat.mjs"

mkdir -p "$WORK/lib" "$WORK/bin" "$HOME/.claude/hooks" \
  "$HOME/.config/opencode/plugins/worklog" \
  "$HOME/.config/opencode/skills/worklog" "$HOME/.claude/skills/worklog" \
  "$HOME/.config/worklog"

cp "$TOOLS/worklog-core.mjs" "$WORK/lib/worklog-core.mjs"
cp "$TOOLS/worklog-report.mjs" "$WORK/bin/worklog-report.mjs"
chmod +x "$WORK/bin/worklog-report.mjs"

cp "$TOOLS/opencode-plugin-index.ts" "$HOME/.config/opencode/plugins/worklog/index.ts"

cp "$TOOLS/worklog-claude-hook.mjs" "$HOOK"
chmod +x "$HOOK"

cp "$SRC/skills/worklog/SKILL.md" "$HOME/.config/opencode/skills/worklog/SKILL.md"
cp "$SRC/skills/worklog/SKILL.md" "$HOME/.claude/skills/worklog/SKILL.md"

if [ ! -f "$HOME/.config/worklog/jira.env" ]; then
  cat > "$HOME/.config/worklog/jira.env" <<'ENV'
# JIRA credentials for the /worklog skill (chmod 600).
# Token: https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=
ENV
  chmod 600 "$HOME/.config/worklog/jira.env"
  echo "wrote ~/.config/worklog/jira.env template — fill it in"
fi

python3 - <<'PY'
import json, os, shutil, time
p = os.path.expanduser("~/.claude/settings.json")
cmd = "node " + os.path.expanduser("~/.claude/hooks/worklog-heartbeat.mjs")
if os.path.exists(p):
    s = json.load(open(p))
else:
    s = {}
    open(p, "a").close()
hooks = s.setdefault("hooks", {})
obj = {"type": "command", "command": cmd, "timeout": 10, "async": True}
for ev in ("Stop", "UserPromptSubmit"):
    lst = hooks.setdefault(ev, [])
    if any("worklog-heartbeat" in h.get("command", "") for e in lst for h in e.get("hooks", [])):
        continue
    lst.append({"matcher": "", "hooks": [obj]})
shutil.copy2(p, p + ".worklog-bak." + str(int(time.time()))) if os.path.exists(p) else None
with open(p, "w") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
print("hooks wired: Stop, UserPromptSubmit")
PY

echo "done. Restart OpenCode to load the plugin; then say /worklog."

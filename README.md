# agent-worklog

Agent work-effort tracker for OpenCode and Claude Code: plugins append
activity marks to a local per-day ledger, and a `/worklog` skill turns them
into confirmed JIRA worklogs. No keystroke or screen monitoring.

This is a [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugins/marketplace-reference.md)
with one plugin:

| Plugin | Skill | What it's for |
| --- | --- | --- |
| [worklog](plugins/worklog/README.md) | [worklog](plugins/worklog/skills/worklog/SKILL.md) | Reviewing tracked agent effort (per ticket, from git branches), confirming it, and posting JIRA worklogs |

## Install

```bash
git clone <this repo> && cd agent-worklog
./plugins/worklog/install.sh
```

Restart OpenCode, fill `~/.config/worklog/jira.env`, then say `/worklog`.

Owner: BigAl.

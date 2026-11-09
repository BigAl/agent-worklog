# worklog — agent work-effort tracker

Drafts JIRA worklogs from what your coding agents are actually doing, with a
human confirmation gate before anything is submitted.

- **OpenCode plugin** appends activity marks while sessions stream steps, tool
  calls and prompts, per project directory.
- **Claude Code hook** appends marks on `Stop` and `UserPromptSubmit`.
- **`/worklog` skill** aggregates the day, shows a review table, and posts to
  JIRA only after the person confirms each entry.

**Privacy stance: no keystroke, screen or device monitoring.** The only signal
is "an agent session in project X was active at time T", plus a short note
from the session's own prompt/title. Everything stays on the user's machine
until they choose to submit.

## How time is tracked

Each mark is one JSON line appended to a per-day ledger
(`~/.local/share/worklog/marks-<YYYY-MM-DD>.ndjson`):

```json
{"t":1794202457216,"dir":"/repo","ticket":"PFP-91","note":"fix dialog"}
```

- Append-only on purpose: concurrent writers (8 plugin instances, hooks,
  multiple agents) never read-modify-write, so nothing can be clobbered.
- Credited time is computed at read time: the union of gaps between a
  directory's marks. Gaps over the idle cap (default 10 min,
  `WORKLOG_IDLE_CAP_MS`) are away-time and credit nothing; duplicate marks are
  inert.
- Tickets come from the git branch (`feat/pfp-58-…` → `PFP-58`). Branches
  without a ticket land as `(unmapped — <project>)` for the review step to
  ask about, never guessed.
- Submissions are journaled (`logged-<date>.ndjson`) so the same minutes are
  never offered twice.

## Install

```bash
git clone <this repo> && cd agent-worklog
./plugins/worklog/install.sh
```

Then restart OpenCode (plugin loads at startup) and fill
`~/.config/worklog/jira.env` (base URL, email, API token from
https://id.atlassian.com/manage-profile/security/api-tokens).

Already a Claude-plugin-marketplace repo (`.claude-plugin/marketplace.json`),
so `/plugin marketplace add <owner>/agent-worklog` also picks up the skill —
the OpenCode plugin and hook wiring still come from `install.sh`.

## Use

- Say `/worklog` (or "worklog", "log my time") in OpenCode or Claude Code.
- Peek without a chat: `~/.local/share/worklog/bin/worklog-report.mjs --table`
- Filter one project: `... worklog-report.mjs --dir /path/to/repo`
- Review table → you confirm amounts → skill posts via
  `POST /rest/api/2/issue/$KEY/worklog` and journals the response id.

## Files it owns

| Path | Role |
| --- | --- |
| `~/.local/share/worklog/marks-<date>.ndjson` | activity marks (append-only) |
| `~/.local/share/worklog/logged-<date>.ndjson` | submissions journal |
| `~/.local/share/worklog/lib/worklog-core.mjs` | shared core (ledger, accounting, git→ticket) |
| `~/.local/share/worklog/bin/worklog-report.mjs` | aggregation CLI |
| `~/.config/opencode/plugins/worklog/index.ts` | OpenCode plugin |
| `~/.claude/hooks/worklog-heartbeat.mjs` | Claude Code hook |
| `~/.config/worklog/jira.env` | JIRA creds (chmod 600) |

## Caveats

- Plain JIRA worklogs: if your team's timesheets come from **Tempo**, check
  whether plain worklogs surface there before logging the same time twice.
- Rounds to the nearest 15 minutes at review time; sub-10-minute raw time is
  never rounded up.

**Owner:** BigAl — @BigAl for questions.

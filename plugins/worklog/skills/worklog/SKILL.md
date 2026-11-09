---
name: worklog
description: Review and submit agent work effort hours to JIRA worklogs. Use when the user says "worklog", "log my time", "log work to JIRA", "/worklog", asks about tracked effort or timesheet hours, or wants to see how long the agents have worked today.
---

# Worklog

OpenCode's plugin and Claude Code's hook append activity marks to per-day
ledgers under `~/.local/share/worklog/` (`marks-<YYYY-MM-DD>.ndjson`,
override with `WORKLOG_DATA_DIR`). Credited time is the union of gaps
between a directory's marks; gaps over 10 minutes are away-time and count
nothing. Tickets come from the git branch (`feat/pfp-58-…` → `PFP-58`);
branches without a ticket id land under `ticket: null` with a project hint.

**Nothing is ever submitted to JIRA by this flow without the person seeing a
summary and confirming it.**

## 1. Aggregate

Run the report CLI (it reads the ledgers and does the gap math):

```bash
~/.local/share/worklog/bin/worklog-report.mjs            # today, JSON
~/.local/share/worklog/bin/worklog-report.mjs 2026-11-07 # a specific day ("yesterday": date -d yesterday +%F)
~/.local/share/worklog/bin/worklog-report.mjs --table    # quick human view
```

JSON shape: `{date, entries: [{ticket, hint, seconds, since, last, note}], logged: {ticket: seconds}}`.

1. Per entry: unsubmitted seconds = `seconds - (logged[ticket] ?? 0)`.
2. Round each ticket to the nearest 15 minutes (`round(s/900)*900`); drop
   tickets that round to zero. Never round up to a full block for less than
   10 minutes of raw time.
3. Present a table — ticket, rounded time, note, and `since`→`last` window in
   local time. Show `ticket: null` rows as `(unmapped — <hint>)` and ask which
   ticket they belong to (or drop them) before logging anything.
4. Ask what to post. The person may: post all, pick tickets, change amounts
   ("PFP-58 only 1h" — their word overrides the draft), or post nothing. Do
   not post until they say so for this table. Never re-offer seconds already
   in `logged`.

## 2. Submit (only after confirmation)

Credentials: use `$JIRA_BASE_URL`, `$JIRA_EMAIL`, `$JIRA_API_TOKEN` if set;
otherwise source `~/.config/worklog/jira.env` once:

```bash
set -a; . ~/.config/worklog/jira.env; set +a
```

If still missing: stop, and point them to
https://id.atlassian.com/manage-profile/security/api-tokens to create a token,
and to write the three variables into that file (chmod 600).

For each confirmed entry, using the entry's `since` timestamp as the start and
the machine's local offset:

```bash
OFFSET=$(date +%z | tr -d ':')            # e.g. +1100
START=$(date -u -d "@$SINCE_SECONDS" +"%Y-%m-%dT%H:%M:%S.000")$OFFSET
curl -sS -f -u "$JIRA_EMAIL:$JIRA_API_TOKEN" -H "Content-Type: application/json" \
  -X POST "$JIRA_BASE_URL/rest/api/2/issue/$KEY/worklog" \
  -d "{\"timeSpentSeconds\":$SECONDS,\"started\":\"$START\",\"comment\":\"$NOTE\"}"
```

- `$SECONDS` is the confirmed (rounded) seconds amount.
- `$NOTE` is the entry's note, JSON-escaped (no raw quotes/newlines).
- A 201 response carries an `id`; anything else, stop and show the body — do
  not mark anything logged. Capture that `id` as the journal `ref`.

## 3. Close out

After every successful post, journal it so the same minutes are never offered
twice (writes one line to `logged-<date>.ndjson`; pass the aggregated date,
not today, when back-filling):

```bash
node -e 'import(require("os").homedir()+"/.local/share/worklog/lib/worklog-core.mjs").then(m =>
  m.appendLogged("PFP-58", 6300, "wl_40201", "2026-11-07"))'
```

Then re-run the report and report:

```
PFP-58  1h 45m  → JIRA worklog wl_40201 ✓
PFP-57  0h 30m  → submitted earlier today (skipped)
(unmapped — poppy-app)  0h 45m  → still draft (no ticket)
```

## Notes

- The ledgers are the single source of truth; draft rows are advisory until
  confirmed. To zero or correct a ticket after a bad post, delete the JIRA
  worklog (DELETE /rest/api/2/issue/$KEY/worklog/$ID) and remove the matching
  `logged-<date>.ndjson` line.
- Estimates: when asked "how long does X take", compare past worklogs for
  similar tickets — `logged` totals are the submitted record.
- Tempo: if the team's JIRA fills timesheets from Tempo rather than plain
  JIRA worklogs, a plain worklog may not show in Tempo's reports. If the
  person's hours "don't appear", raise Tempo's REST API before posting twice.

#!/usr/bin/env node
// Worklog day report — what the `worklog` skill aggregates and reviews.
//
// Usage:
//   worklog-report.mjs [YYYY-MM-DD]     JSON: {date, entries[], logged{}}
//   worklog-report.mjs --table [date]   compact human table
//
// Env: WORKLOG_DATA_DIR (default ~/.local/share/worklog) and
//      WORKLOG_IDLE_CAP_MS (default 10 min — longer gaps credit nothing).

import { aggregateDay, today } from "../lib/worklog-core.mjs"

const args = process.argv.slice(2)
const wantTable = args.includes("--table") || args.includes("-t")
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
const dirIndex = args.indexOf("--dir")
const dir = dirIndex !== -1 ? args[dirIndex + 1] : undefined
const day = await aggregateDay(dateArg ?? today(), dir ? { dir } : {})

const hhmm = (seconds) => {
  const m = Math.round(seconds / 60)
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`
}

if (!wantTable) {
  console.log(JSON.stringify(day, null, 2))
} else {
  const clock = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  const rows = day.entries.map((e) => ({
    ticket: e.ticket ?? `(unmapped — ${e.hint})`,
    raw: hhmm(e.seconds),
    window: `${clock(e.since)}–${clock(e.last)}`,
    note: e.note ?? "",
  }))
  const widths = {
    ticket: Math.max(6, ...rows.map((r) => r.ticket.length)),
    raw: 7,
    window: 11,
  }
  for (const r of rows) {
    console.log(
      `${r.ticket.padEnd(widths.ticket)}  ${r.raw.padStart(widths.raw)}  ${r.window.padEnd(widths.window)}  ${r.note}`,
    )
  }
  const loggedRows = Object.entries(day.logged)
  if (loggedRows.length) {
    for (const [ticket, seconds] of loggedRows) console.log(`${ticket.padEnd(widths.ticket)}  ${hhmm(seconds)} already submitted`)
  }
}

// Agent worklog heartbeat → append-only per-day ledger.
//
// OpenCode's plugin and Claude Code's hook both record "marks": one JSON line
// per activity event, appended to
//   ~/.local/share/worklog/marks-<YYYY-MM-DD>.ndjson   (override: WORKLOG_DATA_DIR)
//
//   {"t":1794202309438,"dir":"/…/frankie","ticket":"PFP-58","note":"fix dialog"}
//   {"t":…,"dir":"/…/other","ticket":null,"hint":"other"}          ← unmapped branch
//
// The ledger is append-only on purpose: every writer (8 plugin instances,
// hooks, several tools at once) appends without reading, so there is no
// read-modify-write race and duplicate marks are harmless — credited time is
// the union of the ≤idle-cap gaps between a directory's marks, and duplicates
// only shorten gaps. Nothing here ever contacts JIRA: the `worklog` skill
// aggregates (aggregateDay), shows the person a summary, submits, and records
// what was posted via appendLogged (the human confirmation boundary).
//
// Submitted work is journaled to
//   ~/.local/share/worklog/logged-<YYYY-MM-DD>.ndjson
//   {"t":…,"ticket":"PFP-58","seconds":6300,"comment":"worker id / log id"}

import { execFile } from "node:child_process"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

export const idleCapMs = Number(process.env.WORKLOG_IDLE_CAP_MS ?? 10 * 60 * 1000)
export const branchTtlMs = Number(process.env.WORKLOG_BRANCH_TTL_MS ?? 5 * 60 * 1000)
export const dataDir = process.env.WORKLOG_DATA_DIR ?? join(homedir(), ".local/share/worklog")

export const today = () => new Date().toLocaleDateString("en-CA")

const marksFile = (date) => join(dataDir, `marks-${date}.ndjson`)
const loggedFile = (date) => join(dataDir, `logged-${date}.ndjson`)

const ticketPattern = /(?:^|\/)([a-z][a-z0-9]*-\d+)/i

const branchCache = new Map() // directory → { ticket?, hint, at }

// The ticket a directory's work belongs to: the git branch's ticket id when
// the branch carries one (feat/pfp-58-… → PFP-58), else null with a project
// hint the review step asks about rather than guessing.
export const ticketFor = async (directory) => {
  const cached = branchCache.get(directory)
  if (cached && Date.now() - cached.at < branchTtlMs) {
    return { ticket: cached.ticket, hint: cached.hint }
  }
  let ticket
  let hint = basename(directory) || directory
  try {
    const { stdout } = await run("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 5_000,
    })
    const branch = stdout.trim()
    if (branch && branch !== "HEAD") {
      ticket = branch.match(ticketPattern)?.[1]?.toUpperCase()
      if (branch.includes("/")) hint = branch.split("/").slice(-1)[0]
    }
  } catch {
    // Not a git checkout (or a git hiccup); the hint still lands in the draft.
  }
  branchCache.set(directory, { ticket, hint, at: Date.now() })
  return { ticket, hint }
}

// Append one activity mark. Fire-and-forget friendly; a failure here must
// never take the caller (session/hook) down — callers also wrap in catch.
export const recordMark = async (directory, note) => {
  const { ticket, hint } = await ticketFor(directory)
  const line =
    JSON.stringify({
      t: Date.now(),
      dir: directory,
      ticket: ticket ?? null,
      hint: ticket ? undefined : hint,
      note: note ? String(note).slice(0, 120) : undefined,
    }) + "\n"
  await mkdir(dataDir, { recursive: true })
  await appendFile(marksFile(today()), line, { mode: 0o600 })
}

// Journal a submission so the same minutes are never offered twice. `date`
// defaults to today, but pass the day the work was aggregated for.
export const appendLogged = async (ticket, seconds, ref, date = today()) => {
  const line =
    JSON.stringify({
      t: Date.now(),
      ticket,
      seconds,
      ref,
    }) + "\n"
  await mkdir(dataDir, { recursive: true })
  await appendFile(loggedFile(date), line, { mode: 0o600 })
}

const readLines = async (file) => {
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

// Aggregate a day's marks into per-ticket draft entries. Time is credited as
// the union of gaps between a directory's consecutive marks, dropping gaps
// over the idle cap, so duplicated or out-of-order marks from concurrent
// writers cannot inflate totals. `date` defaults to today; `opts.dir`
// restricts the aggregation to one project directory (e.g. review a single
// project's session instead of the whole day).
export const aggregateDay = async (date = today(), opts = {}) => {
  const marks = await readLines(marksFile(date))
  const dirFilter = opts.dir

  // Per directory: sort marks, then accumulate under-cap gaps between them.
  const byDir = new Map()
  for (const m of marks) {
    if (!m?.dir || typeof m.t !== "number") continue
    if (dirFilter && m.dir !== dirFilter) continue
    const list = byDir.get(m.dir) ?? []
    list.push(m)
    byDir.set(m.dir, list)
  }

  const tickets = new Map() // key → { ticket, hint, seconds, since, last, note? }
  for (const [dir, list] of byDir) {
    list.sort((a, b) => a.t - b.t)
    const { ticket, hint } = await ticketFor(dir)
    const key = ticket ?? `_unmapped:${hint}`
    let entry = tickets.get(key)
    if (!entry) {
      entry = { ticket: ticket ?? null, hint, seconds: 0, since: list[0].t, last: list[list.length - 1].t }
      tickets.set(key, entry)
    }
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].t - list[i - 1].t
      if (gap <= 0 || gap > idleCapMs) continue
      entry.seconds += gap / 1000
      if (list[i - 1].t < entry.since) entry.since = list[i - 1].t
      if (list[i].t > entry.last) entry.last = list[i].t
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].note) {
        entry.note = list[i].note
        break
      }
    }
  }

  const logged = {}
  for (const l of await readLines(loggedFile(date))) {
    if (l?.ticket) logged[l.ticket] = (logged[l.ticket] ?? 0) + (l.seconds ?? 0)
  }

  const entries = [...tickets.values()]
    .map((e) => ({ ...e, seconds: Math.round(e.seconds) }))
    .sort((a, b) => b.seconds - a.seconds)
  return { date, entries, logged }
}

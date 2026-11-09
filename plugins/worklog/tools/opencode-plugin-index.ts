// Worklog plugin — agent work hours, drafted from live session activity.
//
// Appends one activity mark per burst of session activity to the per-day
// ledger (~/.local/share/worklog/marks-<date>.ndjson). Append-only and
// concurrent-safe: credited time is computed later, at read time, as the
// union of gaps between a directory's marks. Nothing is posted anywhere from
// here — the `worklog` skill aggregates, reviews with the person, and only a
// human confirmation starts a JIRA submission.
//
// Claude Code's hook feeds the same ledger (worklog-core.mjs), so one
// /worklog review covers both tools.

import { homedir } from "node:os"
import { Plugin } from "@opencode/plugin"

// The core lives once per machine and is installed by the worklog installer
// (or the repo's install.sh); both OpenCode and Claude Code import it here.
const corePath = `${homedir()}/.local/share/worklog/lib/worklog-core.mjs`

// In-process pace limit; duplicate marks are harmless anyway (union-of-gaps
// math) — this just keeps the ledger quiet during streaming bursts.
const MIN_MARK_MS = Number(process.env.WORKLOG_MIN_MARK_MS ?? 10_000)

export default Plugin.define({
  id: "alan.worklog",
  async setup(ctx) {
    const { recordMark } = await import(corePath)
    const controller = new AbortController()
    const self = ctx.location?.directory
    const lastMarkAt = new Map<string, number>()

    const mark = (directory: string | undefined, note?: string, force = false) => {
      // Every plugin instance receives every event; only the project's own
      // instance records it, or each mark would append once per project.
      if (!directory || !self || directory !== self) return
      const now = Date.now()
      if (!force && now - (lastMarkAt.get(directory) ?? 0) < MIN_MARK_MS) return
      lastMarkAt.set(directory, now)
      void recordMark(directory, note).catch(() => {
        // A worklog hiccup must never break the session.
      })
    }

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          const envelope = event as {
            type?: string
            location?: { directory?: string }
            data?: { item?: { payload?: { text?: string } }; title?: string }
          }
          const type = String(envelope.type ?? "")
          const directory = envelope.location?.directory
          if (!type.startsWith("session.")) continue
          // Not work (usage bookkeeping) or too fast to be useful (deltas).
          if (
            type === "session.usage.updated" ||
            type === "session.text.delta" ||
            type === "session.reasoning.delta"
          ) {
            continue
          }
          // The newest note-carrying mark becomes the entry's description: a
          // fresh user prompt reads best; the auto title backs it up.
          if (type === "session.inbox.enqueued") {
            const firstLine = envelope.data?.item?.payload?.text?.trim().split("\n")[0]
            mark(directory, firstLine || undefined, true)
          } else if (type === "session.renamed") {
            const title = envelope.data?.title?.trim()
            mark(directory, title || undefined, true)
          } else {
            mark(directory)
          }
        } catch {
          // A worklog hiccup must never break the session.
        }
      }
    })()

    return () => {
      controller.abort()
    }
  },
})

// Claude Code worklog heartbeat hook.
//
// Wired in ~/.claude/settings.json for Stop and UserPromptSubmit. Each firing
// is a fresh process: read the JSON stdin payload, append one mark to the
// per-day ledger (~/.local/share/worklog/marks-<date>.ndjson), exit 0.
// Append-only — no read-modify-write, so concurrent processes never clobber.

import { homedir } from "node:os"

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
try {
  const { recordMark } = await import(`${homedir()}/.local/share/worklog/lib/worklog-core.mjs`)
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd()
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : ""
  // The prompt's first line describes the work. Stop events carry no prompt
  // and stay note-less so they never overwrite a prompt note.
  const note = prompt ? prompt.split("\n")[0].slice(0, 120) : undefined
  await recordMark(cwd, note)
} catch {
  // Worklog trouble must never block Claude.
}
process.exit(0)

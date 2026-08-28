import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { dataDir } from '../store.ts'
import type { RefState } from '../derive/ref-state.ts'

/**
 * What has been ticked, and what a tracker last said — both held by this app.
 *
 * ## Why the ticks are ours
 *
 * This was the one decision that turned a panel into a program. The first plan
 * left the ticks in the roadmap and had this app ask for them over the bridge,
 * which reads reasonably until you run the app on its own: it could then show a
 * list and record nothing against it. A checklist that cannot remember a tick
 * is a poster. So the tick store came with the list, and the app works with
 * nothing else running.
 *
 * A tick is `(ref, item)` and carries who said it, when, an optional note, and
 * the head it was made against. The head is what lets `tickState` tell a review
 * that still describes the branch from one made three pushes ago — see
 * `derive/derive.ts`, where that rule came across whole.
 *
 * ## Why the last tracker state is here too
 *
 * The derived items — pipeline, conflicts, size, threads — are computed from a
 * `RefState`, and this app has no tracker and asks for no credentials. It gets
 * one exactly one way: a roadmap framing the page hands it over from what its
 * own last refresh read, and the page posts it here. So this file also holds
 * the last `RefState` this app was SHOWN for each reference, stamped with when
 * and by whom.
 *
 * That is not a cache pretending to be a tracker, and the difference is said
 * out loud everywhere it is read: the age travels with it, the MCP door prints
 * "as the roadmap read it 6m ago", and a reference nobody has ever framed
 * answers "no tracker state has ever reached this app" rather than answering
 * with a shrug that looks like a verdict. An app that stated a stale pipeline
 * as a fact would be worse than one that admits it cannot see.
 */

const tickSchema = z.object({
  item: z.string(),
  /** Who asserted it. An agent's own name over MCP, the owner from the page. */
  agent: z.string(),
  at: z.string(),
  note: z.string().optional(),
  /** The head it was made against, where anything knew one. */
  sha: z.string().nullable().optional(),
})
export type Tick = z.infer<typeof tickSchema>

/**
 * The last state a roadmap handed over for one reference.
 *
 * `from` is the module session or the word `an agent` — not a name anybody
 * chose for themselves — because this is the provenance of a fact printed as
 * one, and a source that names itself is a source that can lie about it.
 */
const seenSchema = z.object({
  at: z.string(),
  from: z.string(),
  /** Passed through as read. This app derives from it; it never edits it. */
  state: z.unknown(),
})

const storeSchema = z.object({
  ticks: z.record(z.string(), z.array(tickSchema)).default({}),
  seen: z.record(z.string(), seenSchema).default({}),
})
type Store = z.infer<typeof storeSchema>

function file(): string {
  return join(dataDir(), 'ticks.json')
}

const empty = (): Store => storeSchema.parse({})

/**
 * The store, freshly read.
 *
 * An unreadable file reads as an empty one, which is the same judgement the
 * edits store makes and for a weaker reason: a lost tick is a claim that has to
 * be made again, which is recoverable, whereas a write over an unreadable file
 * is not. So reading tolerates rubbish and `save` below refuses to write over
 * it — the asymmetry is deliberate, and it is the only thing standing between a
 * single corrupt byte and every tick this app has ever recorded.
 */
function read(): Store {
  const path = file()
  if (!existsSync(path)) return empty()
  try {
    return storeSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return empty()
  }
}

/** Whether the file exists and cannot be read, which is the one state that blocks a write. */
export function tickTrouble(): string | null {
  const path = file()
  if (!existsSync(path)) return null
  try {
    storeSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    return null
  } catch (e) {
    return `${path} could not be read (${
      e instanceof Error ? e.message.split('\n')[0] : String(e)
    }), so nothing has been recorded and nothing has been written over it. Every tick already in that file is recoverable: fix or move it.`
  }
}

function save(store: Store): void {
  writeFileSync(file(), `${JSON.stringify(storeSchema.parse(store), null, 2)}\n`)
}

/** Every tick filed against one reference. */
export function ticks(ref: string): Tick[] {
  return read().ticks[ref] ?? []
}

export type TickResult = { ok: true; ticks: Tick[] } | { ok: false; error: string }

/**
 * Record one tick, or take one back.
 *
 * WHO may tick WHAT is not decided here, and that is not an omission. The page
 * and the MCP door admit different kinds — the owner's item on the page, the
 * agent's over MCP — and each refuses in its own words with its own reason. A
 * check in here would be a third opinion on a question that already has two
 * owners, and the moment it disagreed with either, the refusal a person read
 * would not be the rule that was applied.
 */
export function setTick(input: {
  ref: string
  item: string
  done: boolean
  agent: string
  note?: string
  sha?: string | null
}): TickResult {
  const trouble = tickTrouble()
  if (trouble) return { ok: false, error: `nothing was recorded. ${trouble}` }
  const store = read()
  const was = store.ticks[input.ref] ?? []
  const rest = was.filter((t) => t.item !== input.item)
  store.ticks[input.ref] = input.done
    ? [...rest, { item: input.item, agent: input.agent, at: new Date().toISOString(), note: input.note, sha: input.sha ?? null }]
    : rest
  /* An empty list is deleted rather than kept as an empty array. A reference
     somebody ticked and unticked is a reference nothing is recorded against,
     and a file full of empty arrays is a file that reads as if it holds
     something. */
  if (!store.ticks[input.ref]?.length) delete store.ticks[input.ref]
  save(store)
  return { ok: true, ticks: store.ticks[input.ref] ?? [] }
}

/** Every reference anything is recorded against — ticked, or seen, or both. */
export function known(): string[] {
  const store = read()
  return [...new Set([...Object.keys(store.ticks), ...Object.keys(store.seen)])].sort()
}

export interface Seen {
  state: RefState
  at: string
  from: string
}

/** The last tracker state this app was shown for a reference, with its age. */
export function seen(ref: string): Seen | null {
  const row = read().seen[ref]
  if (!row || !row.state || typeof row.state !== 'object') return null
  return { state: row.state as RefState, at: row.at, from: row.from }
}

/**
 * Remember what a roadmap just showed us about a reference.
 *
 * Only ever called with something a framed page was handed over the bridge, and
 * stored as read: this app does not edit a fact it did not establish. Failure
 * is swallowed at the caller rather than here — remembering is a convenience
 * for the MCP door, and a page that could not draw because a note-to-self did
 * not write would be a page brought down by its own filing.
 */
export function remember(ref: string, state: RefState, from: string): void {
  const trouble = tickTrouble()
  if (trouble) return
  const store = read()
  store.seen[ref] = { at: new Date().toISOString(), from, state }
  save(store)
}

/** How long ago, in the shorthand the page and the tool both use. */
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

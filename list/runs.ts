import { existsSync, readFileSync } from 'node:fs'

import { latestRuns, moduleFile, type PublishedRun, type RunResultKind, type RunResultState } from 'kehikot-module-protocol'
import { readRuns } from 'kehikot-module-protocol/serve'

import { ID } from '../manifest.ts'
import { dataDir, fenced, makeDir } from '../store.ts'
import { serialise, writeAtomic } from './book.ts'

export { RUN_STATE_WORDS, runItemText } from './run-words.ts'

/**
 * "Tests pass: <label>" — the items nobody typed.
 *
 * Any module that runs things (a test suite, a typecheck, a build) publishes what each run said
 * about a piece of work in its own folder, `.kehikot/<its folder>/runs.json` (protocol 2.27.0,
 * `docs/runs.md`). This file reads every one of them with the protocol's `readRuns`, which asks
 * every folder under `.kehikot/` and names none, and keeps, for one ref, the newest run of each
 * label (`latestRuns`). Nothing here knows, or may know, which module published a run: `from` is
 * carried along as the folder it was read from, and is never compared with anything.
 *
 * ## A run's item is the publisher's claim, never a tick
 *
 * Its state is the run's: queued, running, passed, failed or cancelled. It reads as done only
 * while the newest run of its label PASSED — a run queued, running, failed or cancelled after a
 * pass replaces it, because the same label on the same ref is the same check run again. Nothing
 * here writes a tick for it, and no door here takes one: the way to make it pass is to run it
 * again.
 *
 * ## Hiding is the one thing a person does to it
 *
 * A hide is kept by (ref, label) in this module's own folder, `.kehikot/checklist/runs-hidden.json`,
 * and survives every newer run of that label: it hides the check, not one run of it. Showing it
 * again takes the entry out. The file is written only on a hide or a show, never on a read.
 */

/** The file the hides are kept in, beside the lists: `.kehikot/checklist/runs-hidden.json`. A constant, never an argument. */
export const HIDDEN_FILE = 'runs-hidden'

/** How many hides are kept. Past it the oldest go, which shows them again — a hide is a convenience, not a record. */
export const MAX_HIDDEN = 2000

/** How many refs one read asks about. The page asks about what is in front, which is a handful. */
export const MAX_RUN_REFS = 64

/** One automatic item, as the page draws it and an agent reads it. */
export interface RunItem {
  /** What the run is, in its asker's words: the item reads "Tests pass: <label>". */
  label: string
  state: RunResultState
  /** Done, as far as the run says: the newest run of this label passed. Never set by a person. */
  passed: boolean
  kind: RunResultKind
  /** The folder under `.kehikot/` it was read from. Said, never compared. */
  from: string
  queuedAt: number
  startedAt: number | null
  finishedAt: number | null
  exit: number | null
  /** Whether a person hid this (ref, label). */
  hidden: boolean
}

/** One hide, as kept. */
interface Hidden {
  ref: string
  label: string
  at: string
}

/** The key a hide is kept under: a ref cannot hold a space (`part` refuses one), so this is unambiguous. */
function keyOf(ref: string, label: string): string {
  return `${ref} ${label}`
}

/**
 * The automatic items for one ref, from runs already read: the newest run of each label, in label
 * order, each saying whether a person hid it. Pure, so the lifecycle is tested without a disk.
 */
export function runItemsOf(runs: readonly PublishedRun[], ref: string, hidden: ReadonlySet<string>): RunItem[] {
  return latestRuns(runs, ref).map((run) => ({
    label: run.label,
    state: run.state,
    passed: run.state === 'passed',
    kind: run.kind,
    from: run.from,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    exit: run.exit,
    hidden: hidden.has(keyOf(ref, run.label)),
  }))
}

/** The hides file for a project, fenced, or null (no project, or a folder this app will not work under). */
function hiddenPath(projectPath: string | null | undefined): { path: string; root: string } | null {
  const here = dataDir(projectPath)
  if (!here.dir || !here.root) return null
  const path = moduleFile(here.root, ID, HIDDEN_FILE)
  if (!path) return null
  if (existsSync(path) && fenced(here.root, path)) return null
  return { path, root: here.root }
}

/** Every hide in a project. A missing or unreadable file is no hides: a hide is never worth refusing a read for. */
function readHidden(projectPath: string | null | undefined): Hidden[] {
  const at = hiddenPath(projectPath)
  if (!at || !existsSync(at.path)) return []
  try {
    const parsed = JSON.parse(readFileSync(at.path, 'utf8')) as { hidden?: unknown }
    if (!Array.isArray(parsed.hidden)) return []
    return parsed.hidden.flatMap((one): Hidden[] => {
      if (!one || typeof one !== 'object') return []
      const row = one as Record<string, unknown>
      return typeof row.ref === 'string' && typeof row.label === 'string'
        ? [{ ref: row.ref, label: row.label, at: typeof row.at === 'string' ? row.at : '' }]
        : []
    })
  } catch {
    return []
  }
}

/** What a read of the runs answers: the items per ref asked, or `nowhere` when no project was named. */
export interface RunsRead {
  runs: Record<string, RunItem[]>
  nowhere: boolean
}

/** The automatic items for each ref, read off every publisher's `runs.json`. Never writes. */
export function runsFor(projectPath: string | null | undefined, refs: readonly string[]): RunsRead {
  const out: Record<string, RunItem[]> = Object.create(null)
  if (typeof projectPath !== 'string' || !projectPath.trim()) return { runs: out, nowhere: true }
  const asked = [...new Set(refs)].slice(0, MAX_RUN_REFS)
  if (!asked.length) return { runs: out, nowhere: false }
  const all = readRuns(projectPath)
  const hidden = new Set(readHidden(projectPath).map((one) => keyOf(one.ref, one.label)))
  for (const ref of asked) out[ref] = runItemsOf(all, ref, hidden)
  return { runs: out, nowhere: false }
}

/** What a hide or a show did. */
export type HideResult = { ok: true; said: string } | { ok: false; error: string }

/**
 * Hide the automatic item (ref, label), or show it again. One entry per (ref, label); a hide that
 * is already there, or a show of one that is not, writes nothing.
 */
export function setHidden(projectPath: string | null | undefined, ref: string, label: string, hide: boolean): HideResult {
  const made = hide ? makeDir(projectPath) : dataDir(projectPath)
  if (made.trouble) return { ok: false, error: made.trouble }
  if (!made.dir) return { ok: false, error: 'no project is open, so there is nowhere to keep that.' }
  const at = hiddenPath(projectPath)
  if (!at) return { ok: false, error: 'this project’s checklist folder is not one this app will write in.' }
  const was = readHidden(projectPath)
  const key = keyOf(ref, label)
  const there = was.some((one) => keyOf(one.ref, one.label) === key)
  const name = `“Tests pass: ${label}” on ${ref}`
  if (hide === there) return { ok: true, said: hide ? `${name} was already hidden.` : `${name} is shown.` }
  const next = hide
    ? [...was, { ref, label, at: new Date().toISOString() }].slice(-MAX_HIDDEN)
    : was.filter((one) => keyOf(one.ref, one.label) !== key)
  writeAtomic(at.path, serialise({ version: 1, hidden: next }))
  return { ok: true, said: hide ? `${name} is hidden. Newer runs of it stay hidden too.` : `${name} is shown again.` }
}

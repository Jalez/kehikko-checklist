import { ANSWERS, stateOf, type Tick, type TickState } from './shapes.ts'

/**
 * What the page shows at a glance about one picked item — the issue, change,
 * pull request or paper its checklists are about — and how much more it shows
 * as its container grows. Pure: the page draws it, the footer says it, the
 * tests read it.
 *
 * The person, on what matters here: which items are being worked on, how many
 * are failing, what the progress has been, and what item the checklist
 * concerns. So a glance is exactly those four, for one item, over every list in
 * front for it — the standing checklists for its kind and its one-off lines
 * alike, because a line owed is owed whichever list it is on.
 *
 * The container is the person's: a frame on a canvas is resized by them, so the
 * page picks a level from its own width and height (`levelOf`):
 *
 * - `glance` — under 240 px tall: each item's glance and nothing else.
 * - `items`  — the glance, then every list with its lines and their states.
 * - `full`   — 560 × 560 and more: those, and each item's history — who
 *              answered what, when, and how they know.
 */

export type Level = 'glance' | 'items' | 'full'

export function levelOf(width: number, height: number): Level {
  /* Not measured yet (a test, or the first frame): the items, as before there were levels. */
  if (!width || !height) return 'items'
  if (height < 240) return 'glance'
  if (width >= 560 && height >= 560) return 'full'
  return 'items'
}

/** A row as the glance reads it: the line and the tick on it, if any. */
export interface GlanceRow {
  item: { id: string; text: string }
  done: Tick | null
}

/** One list in front of one item, as the glance reads it. */
export interface GlanceList {
  checklist: { id: string; name: string }
  rows: readonly GlanceRow[]
}

export interface Progress {
  total: number
  /** Passed or not applicable: what has an answer that lets the work through. */
  answered: number
  passed: number
  na: number
  failed: number
  blocked: number
  working: number
  unchecked: number
}

export function progressOf(lists: readonly GlanceList[]): Progress {
  const out: Progress = { total: 0, answered: 0, passed: 0, na: 0, failed: 0, blocked: 0, working: 0, unchecked: 0 }
  for (const list of lists) {
    for (const row of list.rows) {
      out.total += 1
      out[stateOf(row.done)] += 1
    }
  }
  out.answered = out.passed + out.na
  return out
}

/** A line somebody is on, or that is stuck: what it says, which list, and the note. */
export interface Underway {
  list: string
  id: string
  text: string
  state: TickState
  by: string
  at: string
  note?: string
}

function rowsIn(lists: readonly GlanceList[], states: readonly TickState[]): Underway[] {
  return lists
    .flatMap((list) =>
      list.rows.flatMap((row) =>
        row.done && states.includes(stateOf(row.done) as TickState)
          ? [{
              list: list.checklist.name,
              id: row.item.id,
              text: row.item.text,
              state: stateOf(row.done) as TickState,
              by: row.done.by,
              at: row.done.at,
              ...(row.done.note ? { note: row.done.note } : {}),
            }]
          : [],
      ),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** The lines being worked on now, the latest first. */
export const workingOn = (lists: readonly GlanceList[]): Underway[] => rowsIn(lists, ['working'])
/** The lines failed or blocked, the latest first. */
export const failing = (lists: readonly GlanceList[]): Underway[] => rowsIn(lists, ['failed', 'blocked'])

/** One moment of the progress chart: how many lines had an answer at `at`. */
export interface Step {
  at: number
  answered: number
}

/**
 * How the answers came in: the number of lines with an answer (passed or not
 * applicable) after each answer, oldest first, from when each answer was
 * given, ending now at the number there is.
 *
 * Read off the ticks there are, so an answer taken back is not in it — this
 * store keeps the tick a line has, not every tick it ever had — and an answer
 * changed keeps the time of its latest change. The sentence beside the chart
 * says so.
 */
export function progressOver(lists: readonly GlanceList[], now: number): Step[] {
  const times = lists
    .flatMap((list) => list.rows.flatMap((row) => (row.done && ANSWERS.includes(stateOf(row.done) as TickState) ? [Date.parse(row.done.at)] : [])))
    .filter((at) => Number.isFinite(at))
    .sort((a, b) => a - b)
  if (!times.length) return []
  const steps: Step[] = [{ at: times[0]! - 1, answered: 0 }]
  times.forEach((at, index) => steps.push({ at, answered: index + 1 }))
  steps.push({ at: Math.max(now, times.at(-1)!), answered: times.length })
  return steps
}

/** A day as a person says it. */
function day(ms: number): string {
  const at = new Date(ms)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** "3 of 8 answered (2 passed, 1 not applicable)." — and how they came in, when there are any. */
export function progressSaid(progress: Progress, steps: readonly Step[]): string {
  if (!progress.total) return 'No lines yet.'
  const parts = [progress.passed ? `${progress.passed} passed` : '', progress.na ? `${progress.na} not applicable` : ''].filter(Boolean)
  const head = `${progress.answered} of ${progress.total} answered${parts.length ? ` (${parts.join(', ')})` : ''}.`
  if (steps.length < 2) return `${head} Nothing answered yet.`
  const first = steps[1]!.at
  const last = steps.at(-2)!.at
  return `${head} The first answer that stands was given ${day(first)}, the latest ${day(last)}.`
}

/** "2 failed, 1 blocked: “Tests added” failed." — or that nothing is. */
export function failingSaid(progress: Progress, rows: readonly Underway[]): string {
  if (!progress.failed && !progress.blocked) return 'Nothing failed or blocked.'
  const parts = [progress.failed ? `${progress.failed} failed` : '', progress.blocked ? `${progress.blocked} blocked` : ''].filter(Boolean)
  const latest = rows[0]
  return `${parts.join(', ')}.${latest ? ` Latest: “${latest.text}” ${latest.state}${latest.note ? ` — ${latest.note}` : ''}.` : ''}`
}

/** "Being worked on: “Tests added”, “No secrets”." — or that nothing is. */
export function workingSaid(rows: readonly Underway[]): string {
  if (!rows.length) return 'Nothing is being worked on.'
  return `Being worked on: ${rows.map((one) => `“${one.text}”`).join(', ')}.`
}

/** One answer in an item's history: which line, which list, what it says, who, when, how they know. */
export interface Answered extends Underway {}

/** Every tick on an item's lines, the latest first: the largest container's history. */
export const historyOf = (lists: readonly GlanceList[]): Answered[] => rowsIn(lists, ['passed', 'failed', 'na', 'working', 'blocked'])

/** What a progress meter's fill is: 0 with nothing to answer. */
export const share = (progress: Progress): number => (progress.total ? progress.answered / progress.total : 0)

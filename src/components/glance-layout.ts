import type { Progress, Step, Underway } from '../../list/glance.ts'

/**
 * How the glance is laid out at a container's size, and what every tooltip on it says. Pure: the
 * tiles draw it, the footer borrows its words, the tests read it — so "what is on screen at 200 px"
 * and "what does hovering the ring say" are questions with answers that can be read here.
 *
 * A tile is rows, never overlaid: its title and its number on one row, then the plot at a height of
 * its own. A narrow tile (under `AXES_FROM`) draws a sparkline with no axes and no grid; a wider one
 * adds a date axis and horizontal gridlines. Below the tiles' height (`level === 'line'`, see
 * `levelOf` in `list/glance.ts`) an item is one line: "gh#105 · 7/12 · 2 failing", with a tiny ring.
 */

/** From this tile width up, the progress chart has axes and gridlines; below it, a sparkline. */
export const AXES_FROM = 260
/** Tiles side by side from this container width: one column under it, three from it. */
export const COLUMNS_FROM = 360
/** The plot's own height: a sparkline, and a chart with axes. */
export const SPARK_HEIGHT = 24
export const AXES_HEIGHT = 64
/** The ring beside the sparkline: as tall as the plot. Wide enough from `RING_WORDS` to hold "7/12" in its hole. */
export const RING_WORDS = 48
/** The ring on the one-line glance. */
export const RING_LINE = 14
/** The section's side padding (`px-2`, twice) and the gap between tiles (`gap-1.5`). */
const PAD = 16
const GAP = 6

export interface GlanceLayout {
  /** Tiles side by side. */
  columns: 1 | 3
  /** One tile's width, null until the container is measured. */
  tile: number | null
  /** The progress chart has a date axis and gridlines. */
  axes: boolean
  /** The plot's height, in px. */
  plot: number
  /** The progress ring, across, in px. */
  ring: number
}

export const columnsOf = (width: number): 1 | 3 => (width >= COLUMNS_FROM ? 3 : 1)

export function glanceLayout(width: number): GlanceLayout {
  if (!width || width <= 0) return { columns: 1, tile: null, axes: false, plot: SPARK_HEIGHT, ring: SPARK_HEIGHT }
  const columns = columnsOf(width)
  const inner = Math.max(0, width - PAD)
  const tile = Math.floor((inner - GAP * (columns - 1)) / columns)
  const axes = tile >= AXES_FROM
  return { columns, tile, axes, plot: axes ? AXES_HEIGHT : SPARK_HEIGHT, ring: axes ? RING_WORDS : SPARK_HEIGHT }
}

/* ---- pointing at a plot ---- */

/** The step a pointer `fraction` of the way across the progress chart is on (the chart is drawn step-after, by time). */
export function stepAt(steps: readonly Step[], fraction: number): number | null {
  if (!steps.length) return null
  const first = steps[0]!.at
  const last = steps.at(-1)!.at
  const at = first + Math.min(1, Math.max(0, fraction)) * (last - first)
  let index = 0
  for (let i = 0; i < steps.length; i++) if (steps[i]!.at <= at) index = i
  return index
}

/** The segment of a stacked bar a pointer `fraction` of the way across is on; `counts` are the segments' sizes. */
export function segmentAt(counts: readonly number[], fraction: number): number | null {
  const total = counts.reduce((sum, one) => sum + one, 0)
  if (!total) return null
  const at = Math.min(1, Math.max(0, fraction)) * total
  let sum = 0
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) continue
    sum += counts[i]!
    if (at < sum) return i
  }
  for (let i = counts.length - 1; i >= 0; i--) if (counts[i]) return i
  return null
}

/**
 * The point a key moves a plot's tooltip to, among the points `usable` says can be pointed at: the
 * next one, the previous, the first or last; null to close; undefined for a key that is not ours.
 */
export function stepped(key: string, index: number | null, count: number, usable: (i: number) => boolean = () => true): number | null | undefined {
  if (!count) return key === 'Escape' ? null : undefined
  const ok = [...Array(count).keys()].filter(usable)
  if (!ok.length) return key === 'Escape' ? null : undefined
  if (key === 'Escape') return null
  if (key === 'Home') return ok[0]!
  if (key === 'End') return ok.at(-1)!
  const forward = key === 'ArrowRight' || key === 'ArrowUp'
  const back = key === 'ArrowLeft' || key === 'ArrowDown'
  if (!forward && !back) return undefined
  if (index === null) return forward ? ok[0]! : ok.at(-1)!
  if (forward) return ok.find((i) => i > index) ?? ok.at(-1)!
  return [...ok].reverse().find((i) => i < index) ?? ok[0]!
}

/** Where a tooltip sits over its plot, so it never runs off the tile: under the point, kept inside. */
export function tipAlign(index: number | null, count: number): 'start' | 'center' | 'end' {
  if (index === null || count <= 1) return 'start'
  const at = index / (count - 1)
  return at < 1 / 3 ? 'start' : at > 2 / 3 ? 'end' : 'center'
}

/* ---- what is said ---- */

/** "2 failing · 1 blocked", or '' with neither: the words the glance, its line and the footer share. */
export function troubleSaid(progress: Progress): string {
  return [progress.failed ? `${progress.failed} failing` : '', progress.blocked ? `${progress.blocked} blocked` : ''].filter(Boolean).join(' · ')
}

/** The whole item in one compact tooltip: "7/12 done · 2 failing · 1 blocked · 1 working". */
export function summaryTip(progress: Progress): string {
  if (!progress.total) return 'No lines yet'
  return [`${progress.answered}/${progress.total} done`, troubleSaid(progress), progress.working ? `${progress.working} working` : ''].filter(Boolean).join(' · ')
}

/** The one line the shortest container draws: "gh#105 · 7/12 · 2 failing · 1 blocked". */
export function glanceLine(name: string, progress: Progress): string {
  if (!progress.total) return `${name} · no lines`
  return [name, `${progress.answered}/${progress.total}`, troubleSaid(progress)].filter(Boolean).join(' · ')
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const dayOf = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })

/**
 * One point of the progress chart: "3 ticked at 14:02" (with the day when it was not today), the
 * first point "None ticked before 09:10", and the last "7/12 now".
 */
export function stepTip(steps: readonly Step[], index: number, total: number, now: number): string {
  const step = steps[index]
  if (!step) return ''
  if (index === steps.length - 1 && steps.length > 1) return `${step.answered}/${total} now`
  const when = `${clock(step.at)}${sameDay(step.at, now) ? '' : `, ${dayOf(step.at)}`}`
  if (index === 0 && step.answered === 0) return `None ticked before ${clock(step.at + 1)}${sameDay(step.at, now) ? '' : `, ${dayOf(step.at)}`}`
  return `${step.answered} ticked at ${when}`
}

/** The states of the stacked bar, in the order a line moves through them, and each one's word. */
export const SEGMENTS = ['passed', 'na', 'working', 'blocked', 'failed', 'unchecked'] as const
export type Segment = (typeof SEGMENTS)[number]
export const SEGMENT_WORD: Record<Segment, string> = {
  passed: 'passed',
  na: 'not applicable',
  working: 'working',
  blocked: 'blocked',
  failed: 'failing',
  unchecked: 'open',
}

/** One segment of the stacked bar: "2 failing of 12 · “Says why”", naming the latest line in that state when there is one. */
export function segmentTip(state: Segment, progress: Progress, rows: readonly Underway[] = []): string {
  const count = progress[state]
  const latest = rows.find((one) => one.state === state)
  return `${count} ${SEGMENT_WORD[state]} of ${progress.total}${latest ? ` · “${latest.text}”` : ''}`
}

/** The ring's arcs, as shares of the whole, clockwise from twelve: answered, then failing, then blocked. */
export function ringArcs(progress: Progress): { key: 'answered' | 'failed' | 'blocked'; from: number; share: number }[] {
  if (!progress.total) return []
  const out: { key: 'answered' | 'failed' | 'blocked'; from: number; share: number }[] = []
  let from = 0
  for (const key of ['answered', 'failed', 'blocked'] as const) {
    const share = progress[key] / progress.total
    if (share > 0) out.push({ key, from, share })
    from += share
  }
  return out
}

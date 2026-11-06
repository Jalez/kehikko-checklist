import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'

import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { fromKeyboard, hideTip, showTip, useTip } from '@/lib/one-tip'
import { cn } from '@/lib/utils'
import {
  failing,
  failingSaid,
  historyOf,
  progressOf,
  progressOver,
  progressSaid,
  workingOn,
  workingSaid,
  type GlanceList,
  type Progress,
  type Underway,
} from '../../list/glance.ts'
import {
  glanceLayout,
  glanceLine,
  ringArcs,
  RING_WORDS,
  RING_LINE,
  SEGMENTS,
  segmentAt,
  segmentTip,
  stepAt,
  stepped,
  stepTip,
  summaryTip,
  tipAlign,
  troubleSaid,
  type GlanceLayout,
} from './glance-layout.ts'

/**
 * One picked item at a glance: what it is, and three tiles — progress (a ring of how many lines are
 * answered beside a step sparkline of how the answers came in), what failed or is blocked (one
 * stacked bar of every line's state), and what is being worked on. Each tile is rows, never
 * overlaid: its title and its number, then its plot (`glanceLayout` in `glance-layout.ts` says the
 * columns, the plot's height and whether there are axes). Every plot is a picture of a sentence a
 * screen reader reads, and every plot answers a pointer or the keyboard with a compact tooltip —
 * "7/12 done · 2 failing", "3 ticked at 14:02", "2 failing of 12". Colours are the page's tokens, in
 * both themes; a state's colour always has its word.
 *
 * In the shortest container (`level === 'line'`) an item is `ItemLine`: one line and a tiny ring.
 */

/*
 * Labels only: the colours are the page's tokens, named straight on each mark. A config colour
 * would have the chart write a <style> of its own on every render, which is a mutation a person's
 * page has no use for (and the page's tests watch for).
 */
const PROGRESS: ChartConfig = { answered: { label: 'Answered' } }
const FILL: Record<(typeof SEGMENTS)[number], string> = {
  passed: 'var(--chart-progress)',
  na: 'var(--muted-foreground)',
  working: 'var(--working)',
  blocked: 'var(--blocked)',
  failed: 'var(--failed)',
  unchecked: 'var(--border)',
}
const ARC: Record<'answered' | 'failed' | 'blocked', string> = { answered: 'var(--chart-progress)', failed: 'var(--failed)', blocked: 'var(--blocked)' }

const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })

export interface Concerns {
  /** What kind of item: "Pull request", "Issue", "Paper". Null when the tracker has not said. */
  kind: string | null
  /** Its ref or name: "gh#105", "the paper thesis". */
  name: string
  /** Its title, as the tracker says it, or null. */
  title: string | null
}

/** The line that says which item these checklists concern: "Pull request gh#105 · Fix the login race". */
export function concernsSaid(concerns: Concerns): string {
  return `${concerns.kind ? `${concerns.kind} ` : ''}${concerns.name}${concerns.title ? ` · ${concerns.title}` : ''}`
}

export function ItemGlance({
  concerns,
  lists,
  now,
  layout = glanceLayout(0),
}: {
  concerns: Concerns
  lists: readonly GlanceList[]
  now: number
  /** Columns, axes, plot and ring sizes for this container's width. */
  layout?: GlanceLayout
}) {
  const progress = progressOf(lists)
  const steps = progressOver(lists, now)
  const stuck = failing(lists)
  const underway = workingOn(lists)
  const said = concernsSaid(concerns)
  const trouble = troubleSaid(progress)
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-2 pt-1.5" data-glance={concerns.name} data-columns={layout.columns} data-axes={layout.axes ? '' : undefined}>
      <p className="min-w-0 truncate text-[0.7rem] font-semibold leading-4" title={said} data-concerns>
        {concerns.kind ? <span className="font-normal text-muted-foreground">{concerns.kind} </span> : null}
        {concerns.name}
        {concerns.title ? <span className="font-normal"> · {concerns.title}</span> : null}
      </p>
      <div className="grid min-w-0 gap-1.5" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
        <Tile title="Progress" value={`${progress.answered}/${progress.total}`} said={progressSaid(progress, steps)} testId="tile-progress">
          {progress.total ? (
            <Pointable
              said={progressSaid(progress, steps)}
              summary={summaryTip(progress)}
              count={steps.length > 1 ? steps.length : 0}
              tip={(index) => stepTip(steps, index, progress.total, Date.now())}
              indexAt={(fraction) => stepAt(steps, fraction)}
              className="flex items-center gap-1.5"
              style={{ height: Math.max(layout.plot, layout.ring) }}
              testId="plot-progress"
            >
              {(index) => (
                <>
                  <Ring progress={progress} size={layout.ring} />
                  {steps.length > 1 ? <StepChart steps={steps} total={progress.total} axes={layout.axes} height={layout.plot} active={index} /> : (
                    <span className="min-w-0 truncate text-[0.65rem] text-muted-foreground">nothing answered yet</span>
                  )}
                </>
              )}
            </Pointable>
          ) : (
            <p className="truncate text-[0.65rem] leading-4 text-muted-foreground">no lines yet</p>
          )}
        </Tile>
        <Tile
          title="Failing"
          value={trouble || 'none'}
          tone={progress.failed ? 'text-failed' : progress.blocked ? 'text-blocked' : undefined}
          said={failingSaid(progress, stuck)}
          testId="tile-failing"
        >
          {progress.total ? <StateBar progress={progress} rows={[...stuck, ...underway]} said={failingSaid(progress, stuck)} /> : null}
        </Tile>
        <Tile
          title="Working on"
          value={underway.length ? `${underway.length} underway` : 'nothing'}
          tone={underway.length ? 'text-working' : undefined}
          said={workingSaid(underway)}
          testId="tile-working"
        >
          <p className="truncate text-[0.65rem] leading-4 text-muted-foreground" title={underway.length ? workingSaid(underway) : undefined} data-working-first>
            {underway[0]?.text ?? 'no line is marked working'}
          </p>
        </Tile>
      </div>
    </div>
  )
}

/**
 * The shortest container's glance: "gh#105 · 7/12 · 2 failing", a tiny ring before it, and the whole
 * item said in the tooltip a pointer or focus raises over the line.
 */
export function ItemLine({ concerns, lists }: { concerns: Concerns; lists: readonly GlanceList[] }) {
  const progress = progressOf(lists)
  const summary = summaryTip(progress)
  return (
    <Pointable
      said={`${concernsSaid(concerns)}: ${summary}.`}
      summary={`${concernsSaid(concerns)} · ${summary}`}
      place="over"
      className="flex h-6 min-w-0 items-center gap-1.5 px-2"
      testId="glance-line"
      data={{ 'data-glance-line': concerns.name }}
    >
      {() => (
        <>
          <Ring progress={progress} size={RING_LINE} />
          <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold leading-4 tabular-nums" data-line-text>
            {glanceLine(concerns.name, progress)}
          </span>
        </>
      )}
    </Pointable>
  )
}

/** The answered share as a ring, with what failed and what is blocked as arcs after it; "7/12" in the hole when there is room. */
function Ring({ progress, size }: { progress: Progress; size: number }) {
  const stroke = Math.max(2, Math.round(size * 0.16))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const centre = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden data-ring={size}>
      <circle cx={centre} cy={centre} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      {ringArcs(progress).map((arc) => (
        <circle
          key={arc.key}
          data-arc={arc.key}
          cx={centre}
          cy={centre}
          r={r}
          fill="none"
          stroke={ARC[arc.key]}
          strokeWidth={stroke}
          strokeDasharray={`${arc.share * c} ${c}`}
          strokeDashoffset={-arc.from * c}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      ))}
      {size >= RING_WORDS ? (
        <text x={centre} y={centre} textAnchor="middle" dominantBaseline="central" className="fill-foreground tabular-nums" fontSize={Math.round(size * 0.24)} fontWeight={600}>
          {`${progress.answered}/${progress.total}`}
        </text>
      ) : null}
    </svg>
  )
}

/** How the answers came in, step after step: a sparkline in a narrow tile, with a date axis and gridlines from `AXES_FROM`. */
function StepChart({ steps, total, axes, height, active }: { steps: ReturnType<typeof progressOver>; total: number; axes: boolean; height: number; active: number | null }) {
  const point = active === null ? undefined : steps[active]
  return (
    <ChartContainer id="progress" config={PROGRESS} className="aspect-auto min-w-0 flex-1" style={{ height }} data-sparkline={axes ? undefined : ''}>
      <AreaChart data={steps} margin={{ top: 2, right: axes ? 4 : 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        {axes ? <CartesianGrid vertical={false} /> : null}
        <YAxis hide={!axes} width={18} domain={[0, Math.max(total, 1)]} ticks={[0, Math.max(total, 1)]} allowDecimals={false} tickLine={false} axisLine={false} fontSize={9} />
        <XAxis
          hide={!axes}
          dataKey="at"
          type="number"
          domain={['dataMin', 'dataMax']}
          ticks={[steps[0]!.at, steps.at(-1)!.at]}
          tickFormatter={(at: number) => day(at)}
          tickLine={false}
          axisLine={false}
          fontSize={9}
          height={14}
        />
        {point ? <ReferenceLine x={point.at} stroke="var(--muted-foreground)" strokeDasharray="2 2" /> : null}
        <Area dataKey="answered" type="stepAfter" stroke="var(--chart-progress)" fill="var(--chart-progress)" fillOpacity={0.25} strokeWidth={axes ? 2 : 1.5} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  )
}

/** Every line's state as one slim stacked bar, in the order a line moves through them; each segment has its tooltip. */
function StateBar({ progress, rows, said }: { progress: Progress; rows: readonly Underway[]; said: string }) {
  const counts = SEGMENTS.map((state) => progress[state])
  return (
    <Pointable
      said={said}
      summary={summaryTip(progress)}
      count={SEGMENTS.length}
      usable={(index) => counts[index]! > 0}
      tip={(index) => segmentTip(SEGMENTS[index]!, progress, rows)}
      indexAt={(fraction) => segmentAt(counts, fraction)}
      className="flex h-3 items-center"
      testId="plot-states"
    >
      {(index) => (
        <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-sm">
          {SEGMENTS.map((state, at) =>
            progress[state] ? (
              <span
                key={state}
                data-segment={state}
                className={cn('h-full min-w-[2px]', index !== null && index !== at && 'opacity-40')}
                style={{ flexGrow: progress[state], flexBasis: 0, background: FILL[state] }}
              />
            ) : null,
          )}
        </div>
      )}
    </Pointable>
  )
}

/**
 * A plot a pointer or the keyboard can read: focus raises the summary, a pointer over it or an arrow
 * key raises the tooltip of one point, Escape closes it. The tooltip is drawn inside the plot's own
 * box (above it, or over a one-line glance), so it never runs off the tile or makes the page scroll
 * sideways. The plot is an image whose label is its sentence: the text equivalent of the chart.
 *
 * One tooltip on the page at a time (`useTip`): it goes when the pointer leaves the plot or the page,
 * and focus raises it only from the keyboard, so a click never leaves one pinned.
 */
function Pointable({
  said,
  summary,
  count = 0,
  tip,
  indexAt,
  usable,
  place = 'above',
  className,
  style,
  testId,
  data,
  children,
}: {
  said: string
  summary: string
  count?: number
  tip?: (index: number) => string
  indexAt?: (fraction: number) => number | null
  usable?: (index: number) => boolean
  place?: 'above' | 'over'
  className?: string
  style?: CSSProperties
  testId?: string
  data?: Record<string, string>
  children: (index: number | null) => ReactNode
}) {
  const [held, setShown] = useState<{ index: number | null } | null>(null)
  const { key: tipKey, mine } = useTip()
  useEffect(() => {
    if (!mine) setShown(null)
  }, [mine])
  const shown = mine ? held : null
  const id = useId()
  const index = shown?.index ?? null
  const text = shown ? (index !== null && tip ? tip(index) : summary) : null
  const align = place === 'over' ? 'start' : tipAlign(index, count)
  const point = (event: PointerEvent<HTMLDivElement>) => {
    showTip(tipKey, event.currentTarget, { touch: event.pointerType === 'touch' })
    if (!count || !indexAt) return setShown({ index: null })
    const box = event.currentTarget.getBoundingClientRect()
    setShown({ index: indexAt(box.width ? (event.clientX - box.left) / box.width : 0) })
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = stepped(event.key, index, count, usable)
    if (next === undefined) return
    event.preventDefault()
    setShown(next === null ? null : { index: next })
    if (next === null) hideTip(tipKey)
    else showTip(tipKey, event.currentTarget, { keyboard: true })
  }
  return (
    <div
      role="img"
      tabIndex={0}
      aria-label={said}
      aria-describedby={text ? id : undefined}
      className={cn('relative min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      style={style}
      data-testid={testId}
      {...data}
      onPointerEnter={point}
      onPointerDown={point}
      onPointerMove={point}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') hideTip(tipKey)
      }}
      onPointerCancel={() => hideTip(tipKey)}
      onFocus={(event) => {
        if (!fromKeyboard()) return
        setShown({ index: null })
        showTip(tipKey, event.currentTarget, { keyboard: true })
      }}
      onBlur={() => {
        setShown(null)
        hideTip(tipKey)
      }}
      onKeyDown={key}
    >
      {children(index)}
      {text ? (
        <span
          role="tooltip"
          id={id}
          data-tip
          className={cn(
            'pointer-events-none absolute z-20 w-max max-w-full rounded-md border bg-card px-1.5 py-0.5 text-[0.65rem] leading-4 font-medium text-card-foreground shadow-sm tabular-nums',
            place === 'over' ? 'inset-x-1 top-0.5 max-w-none w-auto' : 'bottom-full mb-0.5',
            place === 'above' && align === 'start' && 'left-0',
            place === 'above' && align === 'end' && 'right-0',
            place === 'above' && align === 'center' && 'left-1/2 -translate-x-1/2',
          )}
        >
          {text}
        </span>
      ) : null}
    </div>
  )
}

function Tile({
  title,
  value,
  tone,
  said,
  testId,
  children,
}: {
  title: string
  value: string
  tone?: string
  said: string
  testId: string
  children?: ReactNode
}) {
  return (
    <section aria-label={title} className="relative flex min-w-0 flex-col gap-1 rounded-md border bg-card px-2 py-1" data-testid={testId}>
      {/* The title and the number: a row of their own, above the plot and never over it. */}
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <h3 className="shrink-0 text-[0.6rem] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        <p className={cn('min-w-0 truncate text-right text-[0.8rem] font-semibold tabular-nums', tone)} title={value} data-testid={`${testId}-value`}>
          {value}
        </p>
      </div>
      {/* What a screen reader reads, whatever the plot draws. */}
      <p className="sr-only">{said}</p>
      {children}
    </section>
  )
}

/**
 * The item's history, for the largest container: every answer standing on its
 * lines, the latest first — which line, which list, the state in words, who,
 * when, and how they know. Who answered is said here and only here: the rows
 * themselves stay free of it, as the person asked.
 */
export function ItemHistory({ lists, most = 30 }: { lists: readonly GlanceList[]; most?: number }) {
  const rows = historyOf(lists)
  if (!rows.length) return null
  const shown = rows.slice(0, most)
  return (
    <details className="border-t px-2 py-1.5" data-history>
      <summary className="cursor-pointer text-[0.7rem] font-semibold leading-4">History · {rows.length} answer{rows.length === 1 ? '' : 's'}</summary>
      <ol className="mt-1 flex flex-col gap-1">
        {shown.map((one) => (
          <li key={`${one.list}|${one.id}`} className="text-[0.7rem] leading-4" data-history-row={one.state}>
            <span className="break-words">{`${WORD[one.state]} · ${one.text}`}</span>
            <span className="block text-[0.65rem] text-muted-foreground">
              {one.list} · {one.by} · {new Date(one.at).toLocaleString()}
              {one.note ? ` — ${one.note}` : ''}
            </span>
          </li>
        ))}
      </ol>
      {rows.length > shown.length ? <p className="mt-1 text-[0.65rem] text-muted-foreground">and {rows.length - shown.length} earlier</p> : null}
    </details>
  )
}

const WORD: Record<string, string> = { passed: 'Passed', failed: 'Failed', na: 'N/A', working: 'Working', blocked: 'Blocked' }

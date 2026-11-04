import { Area, AreaChart, Bar, BarChart, XAxis, YAxis } from 'recharts'

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
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
} from '../../list/glance.ts'

/**
 * One picked item at a glance: what it is, and three tiles — progress (how many
 * lines are answered, and how the answers came in), what failed or is blocked,
 * and what is being worked on. Copied in shape from Test runs' glance: each tile
 * says its numbers in words, and each chart is an image with its sentence, so a
 * chart is never the only place a number is. Stacked as rows in a narrow
 * container, side by side from 360 px. Colours are the page's tokens, in both
 * themes; a state's colour always has its word.
 */

/*
 * Labels only: the colours are the page's tokens, named straight on each mark. A config colour
 * would have the chart write a <style> of its own on every render, which is a mutation a person's
 * page has no use for (and the page's tests watch for).
 */
const PROGRESS: ChartConfig = { answered: { label: 'Answered' } }
const STATES: ChartConfig = {
  passed: { label: 'Passed' },
  na: { label: 'N/A' },
  working: { label: 'Working' },
  blocked: { label: 'Blocked' },
  failed: { label: 'Failed' },
  unchecked: { label: 'Unanswered' },
}
const FILL: Record<(typeof ORDER)[number], string> = {
  passed: 'var(--chart-progress)',
  na: 'var(--muted-foreground)',
  working: 'var(--working)',
  blocked: 'var(--blocked)',
  failed: 'var(--failed)',
  unchecked: 'var(--border)',
}
const ORDER = ['passed', 'na', 'working', 'blocked', 'failed', 'unchecked'] as const

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

export function ItemGlance({ concerns, lists, now }: { concerns: Concerns; lists: readonly GlanceList[]; now: number }) {
  const progress = progressOf(lists)
  const steps = progressOver(lists, now)
  const stuck = failing(lists)
  const underway = workingOn(lists)
  const said = concernsSaid(concerns)
  return (
    <div className="flex flex-col gap-1.5 px-2 pt-1.5" data-glance={concerns.name}>
      <p className="min-w-0 truncate text-[0.7rem] font-semibold leading-4" title={said} data-concerns>
        {concerns.kind ? <span className="font-normal text-muted-foreground">{concerns.kind} </span> : null}
        {concerns.name}
        {concerns.title ? <span className="font-normal"> · {concerns.title}</span> : null}
      </p>
      <div className="grid grid-cols-1 gap-1.5 @min-[360px]/container:grid-cols-3">
        <Tile
          title="Progress"
          value={`${progress.answered}/${progress.total}`}
          sub={progress.total ? 'answered' : 'no lines yet'}
          said={progressSaid(progress, steps)}
          testId="tile-progress"
        >
          {steps.length > 1 ? (
            <ChartContainer id="progress" config={PROGRESS} className="aspect-auto size-full">
              <AreaChart data={steps} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
                <YAxis hide domain={[0, Math.max(progress.total, 1)]} allowDecimals={false} />
                <XAxis hide dataKey="at" type="number" domain={['dataMin', 'dataMax']} />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideIndicator labelFormatter={(_, payload) => (payload[0] ? day(Number(payload[0].payload.at)) : '')} />}
                />
                <Area dataKey="answered" type="stepAfter" stroke="var(--chart-progress)" fill="var(--chart-progress)" fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          ) : null}
        </Tile>
        <Tile
          title="Failing"
          value={progress.failed ? `${progress.failed} failed` : 'none failed'}
          sub={progress.blocked ? `${progress.blocked} blocked` : 'none blocked'}
          tone={progress.failed ? 'text-failed' : progress.blocked ? 'text-blocked' : undefined}
          said={failingSaid(progress, stuck)}
          testId="tile-failing"
        >
          {progress.total ? <StateBar progress={progress} /> : null}
        </Tile>
        <Tile
          title="Working on"
          value={underway.length ? `${underway.length} underway` : 'nothing'}
          sub={underway[0]?.text ?? 'no line is marked working'}
          tone={underway.length ? 'text-working' : undefined}
          said={workingSaid(underway)}
          testId="tile-working"
        />
      </div>
    </div>
  )
}

/** Every line's state as one bar, in the order a line moves through them. */
function StateBar({ progress }: { progress: Progress }) {
  const row = Object.fromEntries(ORDER.map((state) => [state, progress[state]]))
  return (
    <ChartContainer id="states" config={STATES} className="aspect-auto size-full">
      <BarChart data={[row]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={0} accessibilityLayer={false}>
        <XAxis hide type="number" domain={[0, Math.max(progress.total, 1)]} />
        <YAxis hide type="category" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        {ORDER.map((state) => (
          <Bar key={state} dataKey={state} stackId="states" fill={FILL[state]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

function Tile({
  title,
  value,
  sub,
  tone,
  said,
  testId,
  children,
}: {
  title: string
  value: string
  sub: string
  tone?: string
  said: string
  testId: string
  children?: React.ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1 @min-[360px]/container:flex-col @min-[360px]/container:items-stretch"
      data-testid={testId}
      title={said}
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-[0.6rem] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        <p className={`truncate text-[0.8rem] font-semibold tabular-nums ${tone ?? ''}`} data-testid={`${testId}-value`}>
          {value}
        </p>
        <p className="truncate text-[0.65rem] leading-4 text-muted-foreground">{sub}</p>
        {/* What a screen reader reads, whatever the chart draws. */}
        <p className="sr-only">{said}</p>
      </div>
      {children ? (
        /* The chart is a picture of what the sentence says. */
        <div role="img" aria-label={said} className="h-8 w-14 shrink-0 @min-[360px]/container:h-8 @min-[360px]/container:w-full">
          {children}
        </div>
      ) : null}
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

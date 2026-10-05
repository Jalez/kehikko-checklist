import { FACETS, dispositionOf } from 'roadmap-module-protocol/facets'
import type { Disposition, MissingReason, TrackerReading, TrackerRow } from 'roadmap-module-protocol'

import type { Tick } from '../../list/checklists.ts'
import { FACT_NAMES, factOf, short, staleness, type Fact } from '../../list/evidence.ts'

import { Badge } from '@/components/ui/badge.tsx'
import { cn } from '@/lib/utils.ts'

/**
 * What the tracker says about a ref, drawn beside the list held against it.
 *
 * ## The sentence
 *
 * > "Show them beside the list, and let an item say which fact is its
 * > evidence … Ticks stay a person's or agent's own verdict. The facts inform
 * > them and never tick anything by themselves." — Jalez/kehikko-checklist#1
 *
 * So two things are drawn, and neither is a control. Under an instance's name,
 * when its target is a ref, the ref as the host last read it: its title, its
 * state and the handful of words that say where a change stands, and — one
 * press down, because a description is longer than this container — the
 * description, the files, who approved and what it links to. And under an
 * item that names a fact, that fact as the tracker says it now, or as it said
 * it when the item was ticked and whether it has moved on since.
 *
 * ## Where the reading comes from
 *
 * The host reads GitHub and GitLab once for every module, and this page asks
 * it — `tracker.get`, with the refs its lists are held against and
 * `detail: 'detail'`. This app still holds no token and still speaks to no
 * tracker. A host that has not granted `trackers:read`, or has never heard of
 * it, answers nothing, and then nothing here is drawn: the page is what it was
 * before, rather than a box saying "unavailable" on every list.
 */

/** The host's reading, keyed for the page, with the marks people put on why a ref closed. */
export interface Facts {
  rows: Record<string, TrackerRow>
  missing: Record<string, MissingReason>
  /** Why a source's last read failed, in the host's words, or null. */
  failed: string | null
  /** `context.dispositions`. A person's mark beats the tracker's reason. */
  marks: Disposition[]
  /** Whether the host is reading right now. */
  refreshing: boolean
}

/** The reading as the page looks things up in it, or null when there is none. */
export function factsOf(reading: TrackerReading | null, marks: Disposition[], refreshing: boolean): Facts | null {
  if (!reading) return null
  const failed = [...new Set(reading.sources.flatMap((s) => (s.error ? [s.error] : [])))].join(' ')
  return {
    rows: Object.fromEntries(reading.rows.map((row) => [row.ref, row])),
    missing: Object.fromEntries(reading.missing.map((one) => [one.ref, one.reason])),
    failed: failed || null,
    marks,
    refreshing: refreshing || reading.refreshing,
  }
}

/** Why a ref has no row, in a line. */
function missingLine(ref: string, reason: MissingReason, failed: string | null): string {
  if (reason === 'pending') return `Asking the tracker about ${ref}.`
  if (reason === 'not-found') return `The tracker has no ${ref}.`
  if (reason === 'no-tracker') return `This project reads no tracker that ${ref} names.`
  return `The last read of ${ref}'s tracker failed${failed ? `: ${failed}` : '.'}`
}

/** When something was read, as a person says it. */
function when(instant: string): string {
  const at = new Date(instant)
  return Number.isNaN(at.getTime()) ? instant : at.toLocaleString()
}

/**
 * The ref an instance is held against, as the tracker last said it.
 *
 * Nothing at all when there is no reading; one muted line when the ref has
 * none yet, saying why.
 */
export function RefFacts({ refName, facts }: { refName: string; facts: Facts | null }) {
  if (!facts) return null
  const row = facts.rows[refName]
  if (!row) {
    const reason = facts.missing[refName]
    if (!reason) return null
    return (
      <p
        className={cn('px-2 pb-1.5 text-[0.65rem] leading-4', reason === 'failed' ? 'text-failed' : 'text-muted-foreground')}
        data-facts="missing"
        data-reason={reason}
      >
        {missingLine(refName, reason, facts.failed)}
      </p>
    )
  }

  const shown = dispositionOf(row.ref, row, facts.marks)
  const why = shown.value ? FACETS[`closed:${shown.value}`] : null
  const detail = row.detail
  const words = [
    row.state + (why ? ` · ${why}${shown.source === 'person' ? ' (marked)' : ''}` : ''),
    ...(row.draft ? ['draft'] : []),
    ...(row.pipeline ? [`pipeline ${row.pipeline}`] : []),
    ...(row.review ? [`review ${row.review.replace(/-/g, ' ')}`] : []),
  ]

  return (
    <div className="px-2 pb-1.5 text-[0.65rem] leading-4 text-muted-foreground" data-facts={row.ref}>
      {/* The title is the link out, for the one thing this page does not
          draw: the conversation on the issue. */}
      <a
        href={row.url}
        target="_blank"
        rel="noreferrer"
        title={`${row.ref}, as the tracker said it ${when(row.readAt)}`}
        className="break-words text-foreground underline-offset-2 hover:underline"
      >
        {row.title || row.ref}
      </a>
      <div className="mt-0.5 flex flex-wrap gap-1" data-facts-state>
        {words.map((word) => (
          <Badge key={word} variant="outline">
            {word}
          </Badge>
        ))}
        {row.labels.map((label) => (
          <Badge key={`label:${label}`}>{label}</Badge>
        ))}
        {facts.refreshing ? (
          <Badge variant="outline" className="text-pending" data-facts-refreshing>
            reading again
          </Badge>
        ) : null}
      </div>
      {detail ? (
        <details className="mt-0.5" data-facts-detail>
          <summary className="cursor-pointer select-none">
            {[
              detail.body.trim() ? 'description' : 'no description',
              ...(row.kind === 'change' ? [`${detail.files.length}${detail.filesClipped ? '+' : ''} files`] : []),
              ...(detail.approvedBy?.length ? [`approved by ${detail.approvedBy.join(', ')}`] : []),
              ...(detail.headSha ? [`at ${short(detail.headSha)}`] : []),
            ].join(' · ')}
          </summary>
          {detail.body.trim() ? (
            <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border bg-muted/40 px-1.5 py-1 text-foreground">
              {detail.body}
              {detail.bodyClipped ? '…' : ''}
            </p>
          ) : null}
          {detail.files.length ? (
            <ul className="mt-1 max-h-32 overflow-y-auto" data-facts-files>
              {detail.files.map((file) => (
                <li key={file.path} className="break-all">
                  {file.path}
                  {file.additions !== undefined || file.deletions !== undefined ? (
                    <span className="tabular-nums">
                      {' '}
                      <span className="text-done">+{file.additions ?? 0}</span>{' '}
                      <span className="text-failed">−{file.deletions ?? 0}</span>
                    </span>
                  ) : null}
                </li>
              ))}
              {detail.filesClipped ? <li>and more than the tracker listed</li> : null}
            </ul>
          ) : null}
          {row.links.length ? (
            <p className="mt-1">
              {row.links.map((link) => `${link.relation === 'closes' ? 'closes' : 'closed by'} ${link.ref}`).join(' · ')}
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  )
}

/**
 * Under one item: the fact it is checked against, and what has become of it.
 *
 * Unticked, or ticked with no record of the fact: the fact as it is now. Ticked
 * on the page with the fact in front of the reader: what it said then, and —
 * in the stale colour, without unticking anything — how the ref has moved on.
 */
export function FactLine({
  fact,
  done,
  row,
  refName,
  facts,
}: {
  fact: Fact
  done: Tick | null
  row: TrackerRow | null
  refName: string
  facts: Facts | null
}) {
  const kept = done?.evidence && done.evidence.fact === fact ? done.evidence : null
  const stale = kept && row ? staleness(kept, row) : null
  const now = row ? factOf(row, fact) : null
  const line = kept
    ? `ticked on ${kept.said}`
    : now
      ? now.said
      : row
        ? `${FACT_NAMES[fact]}: the tracker does not record this for ${refName}`
        : facts?.missing[refName] === 'pending'
          ? `${FACT_NAMES[fact]}: asking the tracker`
          : null
  if (!line) return null
  return (
    <p
      className="mt-0.5 pl-[1.375rem] text-[0.65rem] leading-4 text-muted-foreground"
      data-fact={fact}
      data-stale={stale ? 'yes' : undefined}
    >
      {line}
      {stale ? <span className="block text-stale">Stale: {stale}.</span> : null}
    </p>
  )
}

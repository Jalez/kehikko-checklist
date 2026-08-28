import type { Standing, StandingRow } from '../../derive/standing.ts'

import { cn } from '@/lib/utils.ts'
import { Row } from './row.tsx'

/**
 * One selected reference, and what it is held to.
 *
 * ## Why every selected reference gets one of these, and none is chosen over the
 * others
 *
 * A selection is a list. `context.selection` is `['gh#131', 'gh#105', '!1848']`
 * as readily as it is one ref, and this page had to decide what to do with more
 * than one. Three shapes were on the table:
 *
 * - **Show the first and ignore the rest.** Rejected outright. A tick is a record
 *   that somebody asserted something about a real change; a reference whose ticks
 *   are not drawn looks exactly like a reference with no ticks, and this app's
 *   one standing rule is that nothing disappears in silence.
 * - **Show one, with a switcher.** Tempting in a 220px pane, and still wrong for
 *   the same reason at one remove: what is behind the switcher is invisible until
 *   somebody thinks to look, and the reader has no way to know that the second
 *   reference is the one with the failing pipeline.
 * - **Show all of them, stacked, each collapsible.** What this does. Every
 *   reference is present, in the order the host sent them, with its own count in
 *   the header — so `2/16` beside a ref that is not open is still visible, and
 *   the reader chooses what to read rather than what to reveal.
 *
 * The first is open and the rest are shut when several are selected, because
 * sixteen rows times five references is a scroll nobody asked for; with exactly
 * one selected it is open, because there is nothing to choose between. Neither
 * is a claim about importance — the header of every card says as much as a
 * header can.
 *
 * ## The count, and what is not in it
 *
 * `done` over `total` counts the rows that are neither exempt nor orphaned,
 * which is `standingFor`'s own arithmetic and not a second one done here. An
 * exempt item is not a thing left to do — it is a thing that does not apply,
 * carrying the reason somebody wrote — and an orphan is a tick against an item
 * no longer on the list. Counting either would make a checklist that can never
 * reach the end of itself.
 */
export function StandingCard({
  standing,
  open,
  onToggle,
  onTick,
  trouble,
}: {
  standing: Standing
  open: boolean
  onToggle: () => void
  onTick: (ref: string, row: StandingRow) => void
  /** The last refusal against a row of THIS reference, keyed by item id. */
  trouble: Record<string, string>
}) {
  const complete = standing.total > 0 && standing.done === standing.total
  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-ref={standing.ref}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-baseline gap-1.5 px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="text-[0.65rem] text-muted-foreground">
          {open ? '▾' : '▸'}
        </span>
        <span className="font-mono text-[0.8rem] font-semibold">{standing.ref}</span>
        <span className="min-w-0 flex-1 truncate text-[0.7rem] text-muted-foreground">{standing.noun}</span>
        <span className={cn('shrink-0 text-[0.7rem] tabular-nums', complete ? 'text-done' : 'text-muted-foreground')}>
          {standing.done}/{standing.total}
        </span>
      </button>

      {open ? (
        <>
          {/* Where the tracker facts came from and how old they are, or the
              sentence that says nothing has ever shown this app one. Both are
              statements about what this page can SEE, so they sit above the rows
              rather than being repeated on each of them. */}
          {standing.seen ? (
            <p className="border-t bg-muted/40 px-2 py-1 text-[0.65rem] leading-4 text-muted-foreground">
              Tracker state as {standing.seen.from} had it {standing.seen.ago} ago
              {standing.seen.sha ? ` · head ${standing.seen.sha.slice(0, 9)}` : ''}
            </p>
          ) : null}
          {standing.cannotSee ? (
            <p className="border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground">
              {standing.cannotSee}
            </p>
          ) : null}

          {/* Where this app cannot tell an issue from a change it shows BOTH
              lists rather than picking one and keeping quiet — and says so here,
              because two lists arriving unannounced reads as a bug. */}
          {standing.shape === 'unsettled' ? (
            <p className="border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground">
              Nothing has said whether {standing.ref} is an issue or a pull request — GitHub numbers both in one
              sequence — so both lists are below, marked. Selecting it from a pane that read it from a tracker settles
              it.
            </p>
          ) : null}

          <ul className="border-t">
            {standing.rows.map((row) => (
              <Row
                key={`${row.list}:${row.id}${row.orphan ? ':orphan' : ''}`}
                row={row}
                onTick={(r) => onTick(standing.ref, r)}
                trouble={trouble[row.id] ?? null}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

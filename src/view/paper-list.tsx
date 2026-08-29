import { useState } from 'react'

import type { Paper, PaperItem } from '../../list/papers.ts'
import type { PaperEdit } from '@/store/ask.ts'

import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'

/**
 * The hand-written checklist for one paper.
 *
 * ## Why this is not `StandingCard` with the verdicts taken out
 *
 * Every row on the other component reports something that happened somewhere
 * else — a pipeline ran, a review was left, an agent asserted a thing under its
 * own name — and the seven verdicts exist so that "nobody looked" is never drawn
 * as "the tracker said no". None of that applies here. A hand-written item has
 * exactly two states, ticked and not, because there is nothing behind it to have
 * been read: a person typed the line, and either the work is done or it is not.
 * Drawing `unasked` beside a sentence somebody typed would be this page
 * inventing a distinction the store does not have.
 *
 * ## Nothing is in a Badge, and that is deliberate
 *
 * shadcn's `Badge` carries `whitespace-nowrap` in its base, which is right for
 * the three words it is used for on the other list — `read`, `you`, `the owner`
 * — and would be catastrophic here. An item's text is up to 400 characters of
 * whatever somebody typed, and a 400-character string in a nowrap box sets a
 * min-content floor a thousand pixels wide under a pane that is 220. A sibling
 * module shipped exactly that and the pane scrolled sideways for the rest of the
 * day. So the text is plain wrapped prose in a `min-w-0 flex-1` column, and the
 * only fixed-width things on the row are the mark and the two move buttons.
 *
 * ## The controls are buttons rather than a drag
 *
 * Reordering has to be expressible and has to survive a reload; it does not have
 * to be a drag. A drag target inside a 220-pixel pane inside somebody's iframe
 * is a poor control on a touch device, unreachable from a keyboard without a
 * second implementation, and untestable in a headless browser — which would mean
 * the one thing about this feature that is easy to get quietly wrong is also the
 * one thing nothing measures. Two arrows move an item one place; the store
 * rewrites the whole order and answers with it.
 */
export function PaperList({
  paper,
  onEdit,
  trouble,
  busy,
}: {
  paper: Paper
  onEdit: (edit: PaperEdit) => void
  /** What went wrong the last time anything was pressed, if anything. */
  trouble: string | null
  busy: boolean
}) {
  const [typing, setTyping] = useState('')

  const add = () => {
    const text = typing.trim()
    if (!text) return
    /* Cleared before the answer, and this is the one optimistic thing on the
       page. It is safe in the way the tick is not: a refused add leaves the
       sentence in the refusal under the box, so nothing typed can be lost by
       clearing it, and a box that stayed full after a successful add is the
       fastest way to file the same item twice. */
    setTyping('')
    onEdit({ op: 'add', text })
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-baseline gap-1.5 px-2 py-1.5">
        <h2 className="min-w-0 flex-1 text-[0.8rem] font-semibold">
          <span className="break-words">{paper.epic}</span>
        </h2>
        <span
          className={cn(
            'shrink-0 text-[0.7rem] tabular-nums',
            paper.total > 0 && paper.done === paper.total ? 'text-done' : 'text-muted-foreground',
          )}
        >
          {paper.done}/{paper.total}
        </span>
      </div>

      <p className="border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground">
        What this paper still owes, as somebody wrote it down. Nothing here is derived — no tracker has an opinion
        about what a document is missing — so this list is only ever what a person or an agent has typed, in the order
        they put it in. An agent working over this app’s MCP door can add, tick, reorder and remove these; every tick
        says who made it.
      </p>

      {paper.trouble ? (
        <p className="border-t border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
          {paper.trouble}
        </p>
      ) : null}

      {paper.items.length ? (
        <ul className="border-t">
          {paper.items.map((item, at) => (
            <PaperRow
              key={item.id}
              item={item}
              at={at}
              last={at === paper.items.length - 1}
              onEdit={onEdit}
              busy={busy}
            />
          ))}
        </ul>
      ) : (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          Nothing is written down against this paper yet. That is not an error and not a gap this app can fill for
          you: what a paper owes is a judgement, and the first line below is where it starts.
        </p>
      )}

      <div className="flex flex-col gap-1 border-t p-2">
        <label className="text-[0.65rem] leading-4 text-muted-foreground" htmlFor="paper-add">
          Add a line
        </label>
        <textarea
          id="paper-add"
          rows={2}
          value={typing}
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => {
            /* Enter files it and shift-enter is a newline, which is the pair
               every message box on this machine already uses. A textarea rather
               than an input because an item is often a sentence and a
               single-line box that scrolls sideways hides the middle of it. */
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              add()
            }
          }}
          placeholder="What does this paper still owe?"
          className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-1.5">
          <Button type="button" size="pane" disabled={busy || !typing.trim()} onClick={add}>
            Add
          </Button>
          <span className="min-w-0 flex-1 text-[0.65rem] leading-4 text-muted-foreground">
            Enter adds it; shift-enter is a new line.
          </span>
        </div>
        {trouble ? <p className="text-[0.7rem] leading-4 text-failed">{trouble}</p> : null}
      </div>
    </section>
  )
}

/**
 * One hand-written item.
 *
 * The whole row is the tick target, the way the owner's row is on the derived
 * list, because a checkbox-sized target on a row this narrow is a miss waiting
 * to happen. Unticking is ONE press here where withdrawing the owner's agreement
 * takes two, and the asymmetry is the point: `agreed` is a claim other people
 * have already acted on, and this is a line on somebody's own list.
 *
 * Dropping takes two presses, for the reason `agreed` does — it is the only
 * irreversible thing on this page, and `window.confirm` is ignored inside the
 * host's sandbox (`allow-modals` is not set), so the second press is asked for in
 * the row where it can actually be seen.
 */
function PaperRow({
  item,
  at,
  last,
  onEdit,
  busy,
}: {
  item: PaperItem
  at: number
  last: boolean
  onEdit: (edit: PaperEdit) => void
  busy: boolean
}) {
  const [arming, setArming] = useState(false)
  const done = item.done

  return (
    <li data-paper-item={item.id} data-done={done ? 'yes' : 'no'} className="border-t px-2 py-1.5 first:border-t-0">
      <button
        type="button"
        disabled={busy}
        aria-pressed={Boolean(done)}
        title={done ? 'Ticked. Press to take it back.' : 'Press when this is actually done.'}
        onClick={() => onEdit({ op: 'tick', id: item.id, done: !done })}
        className="flex w-full items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-px inline-flex size-4 shrink-0 items-center justify-center rounded border text-[0.7rem] leading-none font-bold',
            done ? 'border-done/40 text-done' : 'border-todo/50 text-todo',
          )}
        >
          {done ? '✓' : ''}
        </span>
        {/* `min-w-0` and `break-words` together are what keep a 400-character
            item, or an unbroken URL somebody pasted, inside a 220px pane. Never a
            Badge and never `truncate`: the text IS the item. */}
        <span
          className={cn(
            'min-w-0 flex-1 break-words text-left text-[0.8rem] leading-5',
            done && 'text-muted-foreground line-through decoration-1',
          )}
        >
          {item.text}
        </span>
        <span className="sr-only">{done ? 'ticked' : 'not ticked'}</span>
      </button>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[1.375rem] text-[0.7rem] text-muted-foreground">
        <span>
          {done
            ? `ticked by ${done.by}${done.viaMcp ? ', over MCP' : ''}`
            : `written by ${item.by}`}
        </span>
        <span className="flex items-center gap-0.5">
          {/* Move buttons rather than a drag; see the essay above. Each is
              disabled at the end it cannot go, so nothing presses to no effect. */}
          <Button
            type="button"
            variant="ghost"
            size="pane"
            className="px-1"
            disabled={busy || at === 0}
            title="Move up"
            onClick={() => onEdit({ op: 'move', id: item.id, to: at - 1 })}
          >
            <span aria-hidden="true">↑</span>
            <span className="sr-only">Move up</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="pane"
            className="px-1"
            disabled={busy || last}
            title="Move down"
            onClick={() => onEdit({ op: 'move', id: item.id, to: at + 1 })}
          >
            <span aria-hidden="true">↓</span>
            <span className="sr-only">Move down</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="pane"
            className="px-1"
            disabled={busy}
            title={arming ? 'Press again to take this off the list' : 'Take this off the list'}
            onClick={() => {
              if (!arming) {
                setArming(true)
                return
              }
              setArming(false)
              onEdit({ op: 'drop', id: item.id })
            }}
            onBlur={() => setArming(false)}
          >
            <span aria-hidden="true">×</span>
            <span className="sr-only">{arming ? 'Press again to remove' : 'Remove'}</span>
          </Button>
        </span>
      </div>

      {done?.note ? (
        <p className="mt-1 pl-[1.375rem] text-[0.7rem] leading-4 text-muted-foreground">{done.note}</p>
      ) : null}

      {arming ? (
        <p className="mt-1 pl-[1.375rem] text-[0.7rem] leading-4 text-pending">
          Press × again to take this off the list for good, along with any tick on it. Ticking is what you want if it
          is done; this is for a line that turned out not to be owed.
        </p>
      ) : null}
    </li>
  )
}

/**
 * The screen for a pane that has no paper, which is a real state and not an
 * empty list.
 *
 * `context.epic` is nullable, and there are three separate ways to arrive here:
 * nothing is framing this page at all, a host is here and the canvas is on no
 * epic, or a host has not said anything yet. None of them is an error, none of
 * them is "this paper has no items", and drawing an empty checklist for any of
 * them would be this app stating something it has not been told — the same fault
 * as `unasked` drawn as `unknown` on the other list.
 *
 * So it says which of the three it is, and then it offers what it actually has:
 * the papers something has already been written against, openable here, the way
 * the reference buttons work with no canvas. That is the difference between a
 * screen and a blank.
 */
export function NoPaper({
  where,
  written,
  onPick,
}: {
  where: 'unhosted' | 'no-epic' | 'listening'
  written: { epic: string; done: number; total: number }[]
  onPick: (epic: string) => void
}) {
  const said =
    where === 'listening'
      ? 'Waiting to hear whether anything is framing this page, and therefore which paper is open.'
      : where === 'unhosted'
        ? 'Nothing is framing this page, so nothing has said which paper is open. A hand-written checklist is kept against the epic a paper is aimed at, and with no host there is no epic — but the lists themselves are held here, so any that have been started are below.'
        : 'A host is here and the canvas is on no epic. A hand-written checklist belongs to the paper an epic is aimed at, so there is no list to show until one is open — open an epic on the canvas, or pick one below.'

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="px-2 py-1.5 text-[0.8rem] font-semibold">No paper is open</h2>
      <p className="border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground">{said}</p>
      {written.length ? (
        <div className="border-t p-2">
          <p className="mb-1 text-[0.7rem] leading-4 text-muted-foreground">
            {written.length === 1 ? 'One paper has' : `${written.length} papers have`} a hand-written checklist in this
            app’s store. Open one here without a canvas:
          </p>
          <div className="flex flex-wrap gap-1">
            {written.map((w) => (
              <Button
                key={w.epic}
                variant="outline"
                size="pane"
                className="max-w-full font-mono"
                onClick={() => onPick(w.epic)}
              >
                <span className="min-w-0 truncate">{w.epic}</span>
                <span className="shrink-0 tabular-nums opacity-70">
                  {w.done}/{w.total}
                </span>
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          Nothing has been written down against any paper yet, so there is nothing to open. These lists start with
          somebody typing a line — here with a paper open, or through this app’s MCP door with an epic named.
        </p>
      )}
    </section>
  )
}

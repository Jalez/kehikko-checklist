import { useState } from 'react'

import type { Held, Target } from '@/store/ask.ts'
import type { Edit } from '@/store/ask.ts'
import { targetKey, targetName, targetNoun } from '../../list/targets.ts'

import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'

/**
 * One checklist, held against one target.
 *
 * ## What this component is not
 *
 * It is not the old `StandingCard` with the verdicts taken out. Every row on
 * that component reported something that happened somewhere else — a pipeline
 * ran, a review was left — and it drew seven verdicts so that "nobody looked"
 * was never shown as "the tracker said no". None of that applies. An item here
 * has exactly two states, ticked and not, because there is nothing behind it to
 * have been read: a person typed the line, and either the work is done or it is
 * not. Drawing `unasked` beside a sentence somebody typed would be this page
 * inventing a distinction the store does not have.
 *
 * It is also not a list of the targets a checklist has been used on. The user
 * was direct about that:
 *
 * > "The checklist I don't think needs to show a list of items it has
 * > references recorded for. It should just show the checklist."
 *
 * So what is drawn is the checklist, once, with the ticks for whichever target
 * is in front. The other targets are reachable from the one row that says which
 * target this is — a switch, not a directory — because ticks that exist and
 * cannot be got back to are ticks that look like they were never made.
 *
 * ## Nothing is in a Badge, and that is deliberate
 *
 * shadcn's `Badge` carries `whitespace-nowrap` in its base, which is right for
 * the three words it was used for on the old list and would be catastrophic
 * here. An item's text is up to 400 characters of whatever somebody typed, and a
 * 400-character string in a nowrap box sets a min-content floor a thousand
 * pixels wide under a container that is 220. A sibling module shipped exactly that
 * and the container scrolled sideways for the rest of the day. So every piece of
 * authored text on this page is plain wrapped prose in a `min-w-0 flex-1`
 * column, and the only fixed-width things on a row are the mark and the buttons.
 *
 * ## The controls are buttons rather than a drag
 *
 * Reordering has to be expressible and has to survive a reload; it does not have
 * to be a drag. A drag target inside a 220-pixel container inside somebody's iframe
 * is a poor control on a touch device, unreachable from a keyboard without a
 * second implementation, and untestable in a headless browser — which would mean
 * the one thing about this feature that is easy to get quietly wrong is also the
 * one thing nothing measures. Two arrows move an item one place; the store
 * rewrites the whole order and answers with it.
 */
export function ChecklistView({
  held,
  targets,
  candidates,
  onTarget,
  onEdit,
  onAnother,
  trouble,
  busy,
}: {
  held: Held
  /** Every target this list already has ticks against. */
  targets: { target: Target; done: number }[]
  /** Targets the context is offering: the canvas's selection, and this epic's paper. */
  candidates: Target[]
  onTarget: (target: Target | null) => void
  onEdit: (edit: Edit) => void
  /** Go back to the pick screen, forgetting the remembered choice for this kehikko. */
  onAnother: () => void
  trouble: string | null
  busy: boolean
}) {
  const [typing, setTyping] = useState('')
  const [arming, setArming] = useState(false)
  const target = held.target

  const add = () => {
    const text = typing.trim()
    if (!text) return
    /* Cleared before the answer, and this is the one optimistic thing on the
       page. A refused add leaves the sentence in the refusal under the box, so
       nothing typed can be lost by clearing it, and a box that stayed full after
       a successful add is the fastest way to file the same item twice. */
    setTyping('')
    onEdit({ op: 'add', id: held.checklist.id, text })
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-checklist={held.checklist.id}>
      <div className="flex items-baseline gap-1.5 px-2 py-1.5">
        <h2 className="min-w-0 flex-1 text-[0.8rem] font-semibold">
          <span className="break-words">{held.checklist.name}</span>
        </h2>
        <span
          className={cn(
            'shrink-0 text-[0.7rem] tabular-nums',
            held.total > 0 && held.done === held.total ? 'text-done' : 'text-muted-foreground',
          )}
          data-count
        >
          {held.done}/{held.total}
        </span>
      </div>

      <TargetRow target={target} targets={targets} candidates={candidates} onTarget={onTarget} busy={busy} />

      {held.rows.length ? (
        <ul className="border-t">
          {held.rows.map((row, at) => (
            <ItemRow
              key={row.item.id}
              list={held.checklist.id}
              row={row}
              at={at}
              last={at === held.rows.length - 1}
              target={target}
              onEdit={onEdit}
              busy={busy}
            />
          ))}
        </ul>
      ) : (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          This checklist has no items yet. That is not an error and not a gap this app can fill for you: what a piece
          of work owes is a judgement, and the first line below is where it starts.
        </p>
      )}

      <div className="flex flex-col gap-1 border-t p-2">
        <label className="text-[0.65rem] leading-4 text-muted-foreground" htmlFor="add-item">
          Add a line
        </label>
        <textarea
          id="add-item"
          rows={2}
          value={typing}
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              add()
            }
          }}
          placeholder="What is still owed?"
          className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="container" disabled={busy || !typing.trim()} onClick={add}>
            Add
          </Button>
          <span className="min-w-0 flex-1 text-[0.65rem] leading-4 text-muted-foreground">
            An item belongs to the list, so it is added for every target this list is held against.
          </span>
        </div>
        {trouble ? <p className="text-[0.7rem] leading-4 text-failed">{trouble}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t bg-muted/40 px-2 py-1.5">
        <Button type="button" variant="outline" size="container" onClick={onAnother} data-another>
          Use another checklist
        </Button>
        {/*
          Removing takes two presses, and it used to be a `window.confirm()`.

          The asymmetry with everything else on this page is deliberate: this is
          the one irreversible act here — it takes every tick anybody ever made on
          this list, against every target, and none of it can be got back.

          What changed is HOW the second press is asked for, and it changed
          because the old way was measured and found dead:

              [console] Ignored call to 'confirm()'. The document is sandboxed,
                        and the 'allow-modals' keyword is not set.
              confirm() inside the checklist frame returns: false

          The host frames this module with `allow-scripts allow-forms
          allow-popups allow-same-origin` and no `allow-modals` — a reasonable
          sandbox, and not something this module should ask to widen for one
          dialog. The consequence was the worst shape a failure can have:
          `confirm` returns `false`, the handler returns early, the button does
          nothing at all, and there is nothing on screen saying why. A person
          would press it, watch it not move, and conclude it could not be done.

          So the second press is asked for IN the row. It needs no permission
          from anybody's sandbox, it is visible rather than modal, it can be
          abandoned by simply not pressing again, and it says the same sentence
          the dialog used to.
        */}
        <Button
          type="button"
          variant="ghost"
          size="container"
          disabled={busy}
          data-forget
          onClick={() => {
            if (!arming) {
              setArming(true)
              return
            }
            setArming(false)
            onEdit({ op: 'forget', id: held.checklist.id })
          }}
          onBlur={() => setArming(false)}
        >
          {arming ? 'Press again to remove it' : 'Remove this checklist'}
        </Button>
        {arming ? (
          <p className="w-full text-[0.7rem] leading-4 text-pending">
            Pressing again removes “{held.checklist.name}” for good, along with every tick made on it against every
            target. Nobody gets it back. “Use another checklist” is what you want if you only meant to look at a
            different one.
          </p>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Which target this list is being held against, and how to hold it against
 * another.
 *
 * One row rather than a screen, because the target is a fact about what is in
 * front of the reader rather than a thing they are meant to be managing. What it
 * offers is, in order: the targets the CONTEXT is proposing — the canvas's
 * selection and the epic's paper, which is where a target should come from when
 * there is a host — then the ones this list already has ticks against, so
 * nothing recorded can become unreachable, and then a box for typing one, which
 * is how this works with nothing else running at all.
 *
 * A target with no ticks yet and no context proposing it simply does not appear,
 * and that is correct: it is not a thing that exists, it is a thing somebody
 * could type.
 */
function TargetRow({
  target,
  targets,
  candidates,
  onTarget,
  busy,
}: {
  target: Target | null
  targets: { target: Target; done: number }[]
  candidates: Target[]
  onTarget: (target: Target | null) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [typing, setTyping] = useState('')

  /* Deduplicated on the key rather than on the object, because a candidate the
     canvas is proposing and a target this list already has ticks against are
     very often the same target arriving from two places — and drawing it twice
     would make a reader wonder which of the two they are looking at. */
  const seen = new Set<string>()
  const offered: { target: Target; done: number | null }[] = []
  for (const one of candidates) {
    const key = targetKey(one)
    if (seen.has(key)) continue
    seen.add(key)
    offered.push({ target: one, done: targets.find((t) => targetKey(t.target) === key)?.done ?? null })
  }
  for (const one of targets) {
    const key = targetKey(one.target)
    if (seen.has(key)) continue
    seen.add(key)
    offered.push({ target: one.target, done: one.done })
  }

  const type = () => {
    const ref = typing.trim()
    if (!ref) return
    setTyping('')
    setOpen(false)
    onTarget({ kind: 'ref', ref })
  }

  return (
    <div className="border-t bg-muted/40 px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 text-[0.65rem] text-muted-foreground">Held against</span>
        <span className="min-w-0 flex-1 break-words text-[0.75rem] font-medium" data-target>
          {target ? targetName(target) : 'nothing yet'}
        </span>
        <Button type="button" variant="ghost" size="container" onClick={() => setOpen((was) => !was)} data-switch>
          {open ? 'done' : 'change'}
        </Button>
      </div>
      <p className="mt-0.5 text-[0.65rem] leading-4 text-muted-foreground">
        {target
          ? `A ${targetNoun(target)}. Ticks belong to this list and this target together — the same list held against something else keeps its own.`
          : 'Nothing has said what this list is being held against, so nothing below can be ticked. Pick or type a target.'}
      </p>

      {open ? (
        <div className="mt-1 flex flex-col gap-1">
          {offered.length ? (
            <div className="flex flex-wrap gap-1">
              {offered.map(({ target: one, done }) => {
                const key = targetKey(one)
                return (
                  <Button
                    key={key}
                    type="button"
                    variant={target && targetKey(target) === key ? 'default' : 'outline'}
                    size="container"
                    disabled={busy}
                    data-pick-target={key}
                    className="max-w-full"
                    onClick={() => {
                      setOpen(false)
                      onTarget(one)
                    }}
                  >
                    {/* `min-w-0 truncate` inside a `max-w-full` button: a target
                        name is short by construction — every component of one is
                        bounded at 80 characters and may not contain a space — so
                        truncation here loses a suffix rather than a sentence, and
                        the full name is printed above the moment it is picked. */}
                    <span className="min-w-0 truncate">{targetName(one)}</span>
                    {done === null ? null : (
                      <span className="shrink-0 tabular-nums opacity-70">{done}</span>
                    )}
                  </Button>
                )
              })}
            </div>
          ) : (
            <p className="text-[0.65rem] leading-4 text-muted-foreground">
              Nothing is proposing a target: no canvas has selected a reference, no epic is open, and this list has no
              ticks against anything yet. Type one below.
            </p>
          )}
          <div className="flex items-center gap-1">
            <input
              value={typing}
              onChange={(e) => setTyping(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  type()
                }
              }}
              placeholder="gh#105, !44, #12"
              aria-label="Hold this checklist against a reference"
              data-type-target
              className="min-w-0 flex-1 rounded border bg-background px-1.5 py-1 font-mono text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="button" size="container" disabled={busy || !typing.trim()} onClick={type}>
              Hold
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One item, and the tick made on it FOR THIS TARGET.
 *
 * The whole row is the tick target, because a checkbox-sized target on a row
 * this narrow is a miss waiting to happen. Unticking is one press: this is a
 * line on somebody's own list and a tick taken back is a tick that can be made
 * again.
 *
 * With no target there is nothing for a tick to be about, so the row is not a
 * control — it is text. That is different from a target with nothing ticked yet,
 * and the row above says which is which rather than leaving somebody pressing a
 * button that does nothing.
 */
function ItemRow({
  list,
  row,
  at,
  last,
  target,
  onEdit,
  busy,
}: {
  list: string
  row: Held['rows'][number]
  at: number
  last: boolean
  target: Target | null
  onEdit: (edit: Edit) => void
  busy: boolean
}) {
  const [arming, setArming] = useState(false)
  const done = row.done
  const item = row.item

  const mark = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'mt-px inline-flex size-4 shrink-0 items-center justify-center rounded border text-[0.7rem] leading-none font-bold',
          done ? 'border-done/40 text-done' : 'border-todo/50 text-todo',
        )}
      >
        {done ? '✓' : ''}
      </span>
      {/* `min-w-0` and `break-words` together are what keep a 400-character item,
          or an unbroken URL somebody pasted, inside a 220px container. Never a Badge
          and never `truncate`: the text IS the item. */}
      <span
        className={cn(
          'min-w-0 flex-1 break-words text-left text-[0.8rem] leading-5',
          done && 'text-muted-foreground line-through decoration-1',
        )}
      >
        {item.text}
      </span>
    </>
  )

  return (
    <li data-item={item.id} data-done={done ? 'yes' : 'no'} className="border-t px-2 py-1.5 first:border-t-0">
      {target ? (
        <button
          type="button"
          disabled={busy}
          aria-pressed={Boolean(done)}
          title={done ? 'Ticked for this target. Press to take it back.' : 'Press when this is actually done here.'}
          onClick={() => onEdit({ op: 'tick', id: list, item: item.id, target, done: !done })}
          className="flex w-full items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {mark}
          <span className="sr-only">{done ? 'ticked' : 'not ticked'}</span>
        </button>
      ) : (
        <div className="flex items-start gap-1.5">{mark}</div>
      )}

      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[1.375rem] text-[0.7rem] text-muted-foreground">
        <span>
          {/* Who ticked it and whether it came through the MCP door, always, and
              never a bare checkmark. An agent may tick anything on this list —
              every item is a line somebody wrote and an agent is often the one
              who did the work — and what makes that safe is that the claim is
              legible as one and reversible by the person who can judge it. See
              the essay on ticks in `list/checklists.ts`. */}
          {done ? `ticked by ${done.by}${done.viaMcp ? ', over MCP' : ''}` : `written by ${item.by}`}
        </span>
        <span className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="px-1"
            disabled={busy || at === 0}
            title="Move up"
            onClick={() => onEdit({ op: 'move', id: list, item: item.id, to: at - 1 })}
          >
            <span aria-hidden="true">↑</span>
            <span className="sr-only">Move up</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="px-1"
            disabled={busy || last}
            title="Move down"
            onClick={() => onEdit({ op: 'move', id: list, item: item.id, to: at + 1 })}
          >
            <span aria-hidden="true">↓</span>
            <span className="sr-only">Move down</span>
          </Button>
          {/* Two presses again, and for the reason set out above: `window.confirm`
              is ignored inside the host's sandbox, so the second press is asked
              for where it can actually be seen. */}
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="px-1"
            disabled={busy}
            title={arming ? 'Press again to take this off the list' : 'Take this off the list'}
            onClick={() => {
              if (!arming) {
                setArming(true)
                return
              }
              setArming(false)
              onEdit({ op: 'drop', id: list, item: item.id })
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
          Press × again to take this off the list for good, along with every tick on it against every target. Ticking
          is what you want if it is done; this is for a line that turned out not to be owed.
        </p>
      ) : null}
    </li>
  )
}

import { useState } from 'react'

import type { Held, Target } from '@/store/ask.ts'
import type { Edit } from '@/store/ask.ts'
import { briefOf, saidOf, type Narrowed } from '../../list/scope.ts'
import { targetKey, targetName, targetNoun } from '../../list/targets.ts'

import { Button } from '@/components/ui/button.tsx'
import { Sheet } from '@/view/sheet.tsx'
import type { Room } from '@/view/room.ts'
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
 *
 * ## Two shapes, and `room` decides which
 *
 * In a container with height to spare this is one card that flows: header, target,
 * items, a box to type in, a footer. That is what it always was and it is still
 * right whenever the frame can hold it.
 *
 * Short, it is a card the height of the frame with exactly one scroller in it —
 * the items — and everything that says WHAT you are looking at pinned above
 * them: the list's name, the count, the target. Measured before this existed, at
 * 220×300 with six ordinary items, 160 of the 300 pixels were spent above the
 * first item and not one item was fully visible; the add box took another 147.
 * Now the items get what is left of the frame, they snap, and the things a
 * reader does occasionally — typing a line, switching target, leaving — are one
 * press away over the whole frame instead of a permanent strip. See `room.ts`
 * for every threshold and the reading it came from.
 */
export function ChecklistView({
  held,
  targets,
  candidates,
  narrowed,
  onTarget,
  onWiden,
  onEdit,
  onAnother,
  trouble,
  busy,
  room,
}: {
  held: Held
  /** Every target this list already has ticks against. */
  targets: { target: Target; done: number }[]
  /** Targets the context is offering: the canvas's selection, and this epic's paper. */
  candidates: Target[]
  /** Which rung of a paper this is, and how many ticks that rung is not showing. */
  narrowed: Narrowed
  onTarget: (target: Target | null) => void
  /** Climb one rung out of a narrowed paper. Never called when `narrowed.wider` is null. */
  onWiden: () => void
  onEdit: (edit: Edit) => void
  /** Go back to the pick screen, forgetting the remembered choice for this kehikko. */
  onAnother: () => void
  trouble: string | null
  busy: boolean
  /** What this container has room for. See `src/view/room.ts`. */
  room: Room
}) {
  const [typing, setTyping] = useState('')
  /** Which thing, if any, is being done over the whole frame. Only ever one. */
  const [sheet, setSheet] = useState<null | 'add' | 'target' | 'more'>(null)
  const target = held.target
  const overlaid = room.compose === 'overlay'

  const add = () => {
    const text = typing.trim()
    if (!text) return
    /* Cleared before the answer, and this is the one optimistic thing on the
       page. A refused add leaves the sentence in the refusal under the box, so
       nothing typed can be lost by clearing it, and a box that stayed full after
       a successful add is the fastest way to file the same item twice. */
    setTyping('')
    setSheet(null)
    onEdit({ op: 'add', id: held.checklist.id, text })
  }

  const compose = (
    <div className="flex flex-col gap-1">
      {/* The label goes when the overlay's own title already says it. Two "Add a
          line"s stacked in a 220-pixel column is the padding this whole change
          is against — and the field keeps the name for anything not reading the
          screen. */}
      {overlaid ? null : (
        <label className="text-[0.65rem] leading-4 text-muted-foreground" htmlFor="add-item">
          Add a line
        </label>
      )}
      <textarea
        id="add-item"
        aria-label="Add a line"
        rows={overlaid ? 5 : 2}
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
        {room.prose ? (
          <span className="min-w-0 flex-1 text-[0.65rem] leading-4 text-muted-foreground">
            An item belongs to the list, so it is added for every target this list is held against.
          </span>
        ) : null}
      </div>
      {trouble ? <p className="text-[0.7rem] leading-4 text-failed">{trouble}</p> : null}
    </div>
  )

  const leaving = (
    <div className={cn('flex flex-wrap items-center gap-1.5', !overlaid && 'border-t bg-muted/40 px-2 py-1.5')}>
      <Button type="button" variant="outline" size="container" onClick={onAnother} data-another>
        Use another checklist
      </Button>
      <Forget id={held.checklist.id} name={held.checklist.name} busy={busy} onEdit={onEdit} />
    </div>
  )

  return (
    <section
      /* `relative` is load-bearing and not decoration.
         Every button on this page carries an `sr-only` label, and Tailwind's
         `sr-only` is `position: absolute`. An absolutely positioned box is
         clipped by an ancestor's `overflow` only if that ancestor is ALSO its
         containing block — so without this, the sr-only label on the sixteenth
         item resolved against the initial containing block, escaped the scroller
         it lives in, and made the document itself 188 pixels taller than the
         frame. Measured: the whole card scrolled off the top of a 200-pixel
         container that was supposed to have no page scroll at all, and every
         element on it measured as fitting. */
      className={cn('relative overflow-hidden rounded-lg border bg-card', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-checklist={held.checklist.id}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      <div className="flex shrink-0 items-baseline gap-1.5 px-2 py-1.5">
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

      <TargetRow
        target={target}
        targets={targets}
        candidates={candidates}
        narrowed={narrowed}
        onTarget={onTarget}
        onWiden={onWiden}
        busy={busy}
        room={room}
        open={sheet === 'target'}
        onOpen={(want) => setSheet(want ? 'target' : null)}
      />

      {held.rows.length ? (
        <ul
          className={cn(
            'border-t',
            room.pinned && 'min-h-0 flex-1 overflow-y-auto',
            /* `proximity`, never `mandatory`, and only where there is a scroller
               of our own to snap in. See the essay on `snap` in `room.ts`. */
            room.snap && 'snap-y snap-proximity',
          )}
          data-scroller={room.pinned ? 'items' : undefined}
        >
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
              room={room}
            />
          ))}
        </ul>
      ) : (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          {room.prose
            ? 'This checklist has no items yet. That is not an error and not a gap this app can fill for you: what a '
              + 'piece of work owes is a judgement, and the first line below is where it starts.'
            : 'No items yet. Nothing ships a list — the first line is yours to write.'}
        </p>
      )}

      {overlaid ? (
        /* The bar that replaced the strip. Two presses live here instead of 250
           pixels of permanent controls: one to write a line, one for the things
           a reader does rarely. */
        <div className="flex shrink-0 items-center gap-1.5 border-t bg-muted/40 px-2 py-1.5">
          <Button
            type="button"
            size="container"
            className="flex-1"
            disabled={busy}
            data-open-add
            onClick={() => setSheet('add')}
          >
            Add a line
          </Button>
          <Button type="button" variant="ghost" size="container" data-open-more onClick={() => setSheet('more')}>
            <span aria-hidden="true">⋯</span>
            <span className="sr-only">More</span>
          </Button>
        </div>
      ) : (
        <>
          <div className="border-t p-2">{compose}</div>
          {leaving}
        </>
      )}

      {/* A refusal is drawn where it was caused. With the box behind a press
          there is no "where" left on the card, and a sentence that only appeared
          inside a sheet nobody had open would be a refusal nobody ever read. */}
      {overlaid && trouble && sheet === null ? (
        <p className="shrink-0 border-t px-2 py-1.5 text-[0.7rem] leading-4 text-failed">{trouble}</p>
      ) : null}

      {sheet === 'add' ? (
        <Sheet title="Add a line" onClose={() => setSheet(null)}>
          {compose}
        </Sheet>
      ) : null}

      {sheet === 'more' ? (
        <Sheet title="This checklist" onClose={() => setSheet(null)}>
          <div className="flex flex-col gap-2">
            {leaving}
            <p className="text-[0.7rem] leading-4 text-muted-foreground">
              {target
                ? `Held against ${targetName(target)}, a ${targetNoun(target)}. Ticks belong to this list and this `
                  + 'target together — the same list held against something else keeps its own.'
                : 'Nothing has said what this list is being held against, so nothing can be ticked yet.'}
            </p>
          </div>
        </Sheet>
      ) : null}
    </section>
  )
}

/**
 * Removing the checklist, which takes two presses — and it used to be a
 * `window.confirm()`.
 *
 * The asymmetry with everything else on this page is deliberate: this is the one
 * irreversible act here — it takes every tick anybody ever made on this list,
 * against every target, and none of it can be got back.
 *
 * What changed is HOW the second press is asked for, and it changed because the
 * old way was measured and found dead:
 *
 *     [console] Ignored call to 'confirm()'. The document is sandboxed,
 *               and the 'allow-modals' keyword is not set.
 *     confirm() inside the checklist frame returns: false
 *
 * The host frames this module with `allow-scripts allow-forms allow-popups
 * allow-same-origin` and no `allow-modals` — a reasonable sandbox, and not
 * something this module should ask to widen for one dialog. The consequence was
 * the worst shape a failure can have: `confirm` returns `false`, the handler
 * returns early, the button does nothing at all, and there is nothing on screen
 * saying why. A person would press it, watch it not move, and conclude it could
 * not be done.
 *
 * So the second press is asked for IN the row. It needs no permission from
 * anybody's sandbox, it is visible rather than modal, it can be abandoned by
 * simply not pressing again, and it says the same sentence the dialog used to.
 *
 * It is a component of its own because it is now drawn in two places — the
 * card's footer where there is room for one, and the overlay where there is not
 * — and two copies of a two-press arm is two places for one of them to lose its
 * second sentence.
 */
function Forget({
  id,
  name,
  busy,
  onEdit,
}: {
  id: string
  name: string
  busy: boolean
  onEdit: (edit: Edit) => void
}) {
  const [arming, setArming] = useState(false)
  return (
    <>
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
          onEdit({ op: 'forget', id })
        }}
        onBlur={() => setArming(false)}
      >
        {arming ? 'Press again to remove it' : 'Remove this checklist'}
      </Button>
      {arming ? (
        <p className="w-full text-[0.7rem] leading-4 text-pending">
          Pressing again removes “{name}” for good, along with every tick made on it against every target. Nobody gets
          it back. “Use another checklist” is what you want if you only meant to look at a different one.
        </p>
      ) : null}
    </>
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
 *
 * ## What the switch does when there is nowhere to open downwards
 *
 * The same thing, over the frame. Opened inline it puts a wrapping strip of
 * target buttons and a text box between the header and the list — at 220×300
 * that pushed every item off the bottom, so a reader choosing a target could not
 * see the ticks they were choosing it for. As an overlay the offered targets get
 * the full width, and the list is where they left it when they come back.
 *
 * The ROW itself never moves and never folds away at any size. It is the answer
 * to "what are these ticks about", and a tick whose target is off screen is a
 * tick that means nothing.
 */
function TargetRow({
  target,
  targets,
  candidates,
  narrowed,
  onTarget,
  onWiden,
  busy,
  room,
  open,
  onOpen,
}: {
  target: Target | null
  targets: { target: Target; done: number }[]
  candidates: Target[]
  narrowed: Narrowed
  onTarget: (target: Target | null) => void
  onWiden: () => void
  busy: boolean
  room: Room
  /** Whether this is the overlay showing. Held by the card, so only one ever is. */
  open: boolean
  onOpen: (want: boolean) => void
}) {
  const [inline, setInline] = useState(false)
  const [typing, setTyping] = useState('')
  const overlaid = room.compose === 'overlay'
  const showing = overlaid ? open : inline

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

  const close = () => (overlaid ? onOpen(false) : setInline(false))

  const type = () => {
    const ref = typing.trim()
    if (!ref) return
    setTyping('')
    close()
    onTarget({ kind: 'ref', ref })
  }

  const picking = (
    <div className={cn('flex flex-col gap-1', !overlaid && 'mt-1')}>
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
                  close()
                  onTarget(one)
                }}
              >
                {/* `min-w-0 truncate` inside a `max-w-full` button: a target
                    name is short by construction — every component of one is
                    bounded at 80 characters and may not contain a space — so
                    truncation here loses a suffix rather than a sentence, and
                    the full name is printed above the moment it is picked. */}
                <span className="min-w-0 truncate">{targetName(one)}</span>
                {done === null ? null : <span className="shrink-0 tabular-nums opacity-70">{done}</span>}
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
  )

  /*
   * What the row CALLS the target, which is not always what the target is
   * called.
   *
   * `targetName` prints a paper target as `epic · chapters:3_methods#sec:meth-design`.
   * That is the right answer for an agent — it is an address — and it is sixty
   * characters of one in a column that is two hundred and twenty pixels wide,
   * most of it a slug this reader wrote as a `\label` and does not need read back
   * to them. So on a paper the row prints the rung: the whole paper, the file's
   * own name, or the words at the top of the section. A ref is left exactly as it
   * was: `gh#105` is short, it is what a person typed, and there is no ladder
   * over it.
   *
   * Nothing is lost. `saidOf` is the `title`, so the full address is one hover
   * away, and the switcher below still lists every target by its real name.
   */
  const scoped = narrowed.scope.kind !== 'elsewhere'
  const name = target ? (scoped ? briefOf(narrowed.scope) : targetName(target)) : 'nothing yet'

  return (
    <div className="shrink-0 border-t bg-muted/40 px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 text-[0.65rem] text-muted-foreground">Held against</span>
        <span
          className="min-w-0 flex-1 break-words text-[0.75rem] font-medium"
          data-target
          data-rung={narrowed.scope.kind}
          title={scoped ? saidOf(narrowed.scope) : undefined}
        >
          {name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="container"
          onClick={() => (overlaid ? onOpen(!open) : setInline((was) => !was))}
          data-switch
          /* The paragraph below is dropped in a narrow container; the fact it carries
             is not. A `title` is a poor place for a sentence nobody can reach on
             a touch screen, and the right place for one they can do without. */
          title={
            target
              ? `A ${targetNoun(target)}. Ticks belong to this list and this target together — the same list held against something else keeps its own.`
              : 'Nothing has said what this list is held against.'
          }
        >
          {showing && !overlaid ? 'done' : 'change'}
        </Button>
      </div>

      {/* The paragraph goes when there is no room for it; the SENTENCE about
          nothing being tickable never does. One of them repeats the row above it
          and the other is the only thing on screen explaining why every row
          below is inert. */}
      {target ? (
        room.prose ? (
          <p className="mt-0.5 text-[0.65rem] leading-4 text-muted-foreground">
            A {targetNoun(target)}. Ticks belong to this list and this target together — the same list held against
            something else keeps its own.
          </p>
        ) : null
      ) : (
        <p className="mt-0.5 text-[0.65rem] leading-4 text-muted-foreground">
          Nothing has said what this list is being held against, so nothing below can be ticked. Pick or type a target.
        </p>
      )}

      {/*
        * What the narrowing is hiding, and the one press that undoes it.
        *
        * This never folds away at any size, and that is the whole point of it.
        * The ticks on this list belong to (list, target, item), so walking from
        * a paper into one of its sections replaces every tick on screen with
        * none — and a reader who ticked eight items yesterday and now reads
        * `0/12` has no way to tell narrowing from this app having lost them. A
        * container that cannot say what it is hiding is indistinguishable from a
        * broken one, which is a sentence this workspace has learned the hard way
        * more than once today.
        *
        * A number and a button, not a paragraph: the owner's standing complaint
        * is too much prose in a narrow column, and the number is the fact. The
        * list behind the number is already one press further on, in the switcher,
        * which names every target with a count beside it.
        */}
      {narrowed.wider ? (
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[0.65rem] leading-4 text-muted-foreground">
          {narrowed.elsewhere ? (
            <span data-elsewhere={narrowed.elsewhere}>
              {narrowed.elsewhere} ticked elsewhere in this paper.
            </span>
          ) : null}
          <button
            type="button"
            className="underline underline-offset-2"
            data-widen
            onClick={onWiden}
            title={saidOf(narrowed.wider)}
          >
            Show {briefOf(narrowed.wider)}
          </button>
        </p>
      ) : null}

      {showing && !overlaid ? picking : null}
      {showing && overlaid ? (
        <Sheet title="Hold this list against" onClose={() => onOpen(false)}>
          {picking}
        </Sheet>
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
 *
 * ## What a small container stops drawing, and what it never stops drawing
 *
 * Folded, the arrows and the × go behind one press on the row that wants them,
 * and "written by …" moves into the row's `title`. Between them they were a
 * whole extra line under every single item at 220 pixels — sixteen items became
 * thirty-two lines, half of them furniture around sentences nobody could finish
 * reading.
 *
 * Who TICKED it does not fold, at any size. `list/checklists.ts` argues that an
 * agent may tick anything on this list and that what makes that safe is that the
 * claim is legible as a claim and reversible by the person who can judge it. A
 * narrow container is not a reason to break that: a bare checkmark with nobody's
 * name against it is exactly the thing that essay refuses.
 */
function ItemRow({
  list,
  row,
  at,
  last,
  target,
  onEdit,
  busy,
  room,
}: {
  list: string
  row: Held['rows'][number]
  at: number
  last: boolean
  target: Target | null
  onEdit: (edit: Edit) => void
  busy: boolean
  room: Room
}) {
  const [arming, setArming] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const done = row.done
  const item = row.item
  const folded = room.controls === 'folded'
  const controls = !folded || unfolded

  /** Who ticked it — always — or, where there is room for it, who wrote it. */
  const said = done
    ? `ticked by ${done.by}${done.viaMcp ? ', over MCP' : ''}`
    : room.authorship
      ? `written by ${item.by}`
      : null

  const wrote = room.authorship ? '' : ` Written by ${item.by}.`

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
    <li
      data-item={item.id}
      data-done={done ? 'yes' : 'no'}
      className={cn('border-t px-2 py-1.5 first:border-t-0', room.snap && 'snap-start')}
    >
      <div className="flex items-start gap-1.5">
        {target ? (
          <button
            type="button"
            disabled={busy}
            aria-pressed={Boolean(done)}
            title={
              (done ? 'Ticked for this target. Press to take it back.' : 'Press when this is actually done here.')
              + wrote
            }
            onClick={() => onEdit({ op: 'tick', id: list, item: item.id, target, done: !done })}
            className="flex min-w-0 flex-1 items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {mark}
            <span className="sr-only">{done ? 'ticked' : 'not ticked'}</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-1.5" title={wrote.trim() || undefined}>
            {mark}
          </div>
        )}
        {folded ? (
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="shrink-0 px-1"
            data-unfold={unfolded ? 'open' : 'shut'}
            title={unfolded ? 'Hide move and remove' : 'Move or remove this line'}
            onClick={() => setUnfolded((was) => !was)}
          >
            <span aria-hidden="true">⋯</span>
            <span className="sr-only">{unfolded ? 'Hide move and remove' : 'Move or remove this line'}</span>
          </Button>
        ) : null}
      </div>

      {said || controls ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[1.375rem] text-[0.7rem] text-muted-foreground">
          {/* Who ticked it and whether it came through the MCP door, always, and
              never a bare checkmark. An agent may tick anything on this list —
              every item is a line somebody wrote and an agent is often the one
              who did the work — and what makes that safe is that the claim is
              legible as one and reversible by the person who can judge it. See
              the essay on ticks in `list/checklists.ts`. */}
          {said ? <span>{said}</span> : null}
          {controls ? (
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
              {/* Two presses again, and for the reason set out above `Forget`:
                  `window.confirm` is ignored inside the host's sandbox, so the
                  second press is asked for where it can actually be seen. */}
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
          ) : null}
        </div>
      ) : null}

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

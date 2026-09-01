import { useState } from 'react'

import type { Held, Outline, Target } from '@/store/ask.ts'
import type { Edit } from '@/store/ask.ts'
import { briefOf, saidOf, type Narrowed } from '../../list/scope.ts'
import { targetKey, targetName, targetNoun } from '../../list/targets.ts'

import { Button } from '@/components/ui/button.tsx'
import { Sheet } from '@/view/sheet.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * One checklist, held against one target — and now on one of two pages.
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
 * ## Two pages, and which is which
 *
 * > "perhaps the edit page to edit a checklist (remove, change checklist items,
 * > move them up and down etc) should be a separate page in it, with the other
 * > page showing the current condition of the item that is the other pair in
 * > their consumer/provider relationship."
 *
 * The second half of that sentence is the one that decides the split. This
 * module reacts to `passage` and narrows by grain: it is the CONSUMER, and the
 * paper is the provider. So the non-editing page is the one that answers "where
 * am I, and what is the state of the thing I am looking at" — which is what it
 * has always mostly been. It draws the list's name, the count, which rung of the
 * paper the ticks belong to, how many ticks that rung is hiding, and the items
 * with their ticks. Nothing on it changes the list.
 *
 * The edit page is the other half: add a line, reword one, move it up or down,
 * take it off, and leave or remove the checklist itself. Nothing on it is
 * ticked, and nothing on it names a target.
 *
 * ### What the split BUYS, which is the reason to do it at all
 *
 * Every row of the state page used to carry a `⋯` press to unfold the arrows and
 * the ×, and a line of provenance under the text. Sixteen items were thirty-two
 * lines, half of them furniture around sentences nobody could finish reading in
 * a 220-pixel column. Both are gone from that page entirely: a row is a mark and
 * a line of text, and pressing it ticks. The bottom bar goes with them — `Add a
 * line` and the `⋯` that held "use another checklist" are both on the edit page
 * now — so the state page is header, target row, items, and nothing else.
 *
 * ### What it costs
 *
 * Adding a line is two presses instead of one. That is the real price and it is
 * worth naming rather than hiding: adding is the commonest write on this page.
 * It was paid because the alternative — keeping a permanent `Add a line` bar on
 * the state page as well — would mean the same act had two homes, and the strip
 * it stands on is a whole line of a container the owner runs 300 pixels tall.
 *
 * ## How you move between them, and what was rejected
 *
 * One press, in the header, beside the count: `Edit` on the state page and
 * `Done` on the edit page. It is a `ghost` button at `container` size, so it
 * costs four pixels of an existing row rather than a row of its own.
 *
 * **Rejected: a filter group in the container header.** The host already draws
 * one control for this module (`roadmap.filters`, offering the grain), and
 * putting the page there would have cost this page nothing at all. It is wrong
 * for two reasons. A filter NARROWS what a module shows, and a mode is not a
 * narrowing — the protocol's own words for an empty offer are "there is nothing
 * here to narrow", which says nothing about which page. And the host remembers a
 * filter against a container forever: a reader who edited the list on Tuesday
 * would find the container opening on the edit page on Wednesday, in a module
 * whose whole argument (`list/scope.ts`) is that a remembered thing must not
 * outlive the context that justified it. Editing is a thing you finish.
 *
 * **Rejected: a tab row.** This app deleted one on purpose — see `src/app.tsx` —
 * because a tab row over one thing is furniture. Over two things it is a
 * permanent strip in a 300-pixel frame to say something one word already says.
 *
 * **Rejected: reusing the `⋯` press.** It is where "use another checklist"
 * already lived, so it looks free. But `⋯` means "the rest of it", and a press
 * that means "the rest of it" on one screen and "the other page" on another is
 * the sort of thing that is discovered by accident and never twice.
 *
 * ## Whether the edit page respects the grain filter, and why the answer is short
 *
 * It shows every item, and so does the state page, because **the grain has never
 * hidden an item**. `list/scope.ts` says it in as many words: "Nothing here drops
 * an item: an item belongs to the list and is drawn at every rung. What narrowing
 * moves is which TICKS are in front of you." So "editing a filtered list" is not
 * a state this module can be in, and there was no decision to make about it — the
 * honest thing is to say so rather than to invent a safeguard against a case that
 * cannot arise.
 *
 * What the edit page does drop is the target row and the tick marks, and that IS
 * a decision. An edit is a change to the list — an item added is added for every
 * target the list is ever held against, an item removed takes every tick on it
 * with it — and drawing a tick beside a line somebody is about to reword invites
 * exactly the wrong reading: that the reword is scoped to the target on screen.
 * The two-press arm on `×` says the unscoped truth in words for the one act that
 * cannot be undone.
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
 * ## Reordering is buttons rather than a drag, and this is the second time
 *
 * Reordering has to be expressible and has to survive a reload; it does not have
 * to be a drag. A drag target inside a 220-pixel container inside somebody's iframe
 * is a poor control on a touch device, unreachable from a keyboard without a
 * second implementation, and untestable in a headless browser — which would mean
 * the one thing about this feature that is easy to get quietly wrong is also the
 * one thing nothing measures. Two arrows move an item one place; the store
 * rewrites the whole order and answers with it.
 *
 * The move to a page of its own is what settles the argument rather than
 * reopening it. The case FOR a drag was always that two buttons a row is a lot
 * of furniture in a narrow column — and that objection has been answered by
 * taking the furniture off the page a reader spends their day on. On the edit
 * page the controls are the point, so they cost nothing they should not, and a
 * drag would still be a control that a keyboard cannot reach and a probe cannot
 * measure. `room.controls` decides only whether they sit beside the line or on
 * their own line under it; below 360 pixels they wrap either way, which is the
 * measurement in `src/view/room.ts`.
 *
 * ## Two shapes, and `room` decides which
 *
 * In a container with height to spare this is one card that flows: header,
 * target, items. Short, it is a card the height of the frame with exactly one
 * scroller in it — the items — and everything that says WHAT you are looking at
 * pinned above them. Measured before any of this, at 220×300 with six ordinary
 * items, 160 of the 300 pixels were spent above the first item and not one item
 * was fully visible. See `room.ts` for every threshold and the reading it came
 * from.
 */
export function ChecklistView({
  held,
  targets,
  candidates,
  narrowed,
  outline,
  onOutline,
  onTarget,
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
  /**
   * Which rung of a paper this is, and how many ticks that rung is not showing.
   *
   * Read for the NAME and the COUNT only. Climbing out of the rung is the host's
   * filter now — `narrowed.wider` is no longer a control on this page, and there
   * is no `onWiden` to go with it.
   */
  narrowed: Narrowed
  /**
   * The paper's files and their headings, once somebody has asked for them.
   *
   * Null means "not asked, or nothing to offer", and the picker says which in
   * one short line rather than drawing an empty list.
   */
  outline: Outline | null
  /** Ask for the outline. Called when the picker opens, and never before. */
  onOutline: () => void
  onTarget: (target: Target | null) => void
  onEdit: (edit: Edit) => void
  /** Go back to the pick screen, forgetting the remembered choice for this kehikko. */
  onAnother: () => void
  trouble: string | null
  busy: boolean
  /** What this container has room for. See `src/view/room.ts`. */
  room: Room
}) {
  /**
   * Which page. State, always, on first paint.
   *
   * Held here and written down nowhere: `state:keep` holds which checklist is
   * open on which kehikko and that is all (`list/keep.ts`), and a remembered
   * page would be the same defect as a remembered place — a container coming
   * back tomorrow in a mode nobody is in any more.
   */
  const [page, setPage] = useState<'state' | 'edit'>('state')
  /** Whether the target picker is showing over the frame. Held here so only one thing is. */
  const [picker, setPicker] = useState(false)
  const target = held.target

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
         element on it measured as fitting.

         `overflow-hidden` is the other half of that same pair and stays for the
         same reason: `relative` makes this the containing block and the overflow
         is what does the clipping. Neither of them is here to round a corner.

         ## What is not here any more: `rounded-lg border bg-card`

         The host already draws a container round this module — its own border,
         its own header, its own corners — so an edge drawn here was an edge with
         nothing on the far side of it to separate this from. A box in a box, and
         the gap between the two edges is space taken off the thing somebody is
         reading, which at 220 pixels is space this module does not have.

         `kehikko-learning` made the same removal, in the owner's words ("the
         Learning module doesn't need a separate container inside it — none of
         the other modules have that either") and for the same measured reason:
         a bordered, padded card inside a container is a card on a card. It kept
         its edge on exactly one rung — the one where several question cards sit
         in a list, and the edge is what tells one card from the next. That case
         does not arise here. This page has never been a list of cards; it is one
         card, and the separating is done by the `border-t` rules between rows,
         which are the reason the list reads as rows at all and which stay. */
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-checklist={held.checklist.id}
      data-page={page}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
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
        {/* The one control that moves between the two pages, and the whole of the
            chrome the split costs: a ghost press on a row that was already
            drawn. See the essay above for the three places it is deliberately
            not — the container header's filter, a tab row, and the `⋯`. */}
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="shrink-0 px-1.5"
          data-page-to={page === 'state' ? 'edit' : 'state'}
          title={
            page === 'state'
              ? 'Edit: add, reword, reorder or remove lines. Nothing there is ticked.'
              : 'Done: back to what is ticked, and what this list is held against.'
          }
          onClick={() => {
            setPicker(false)
            setPage((was) => (was === 'state' ? 'edit' : 'state'))
          }}
        >
          {/* The word costs nineteen pixels of a 220-pixel container, because it
              takes the width the list's NAME needs on the same row and pushes it
              to a second line. Measured rather than guessed, and the decision
              lives in `room.ts` with the reading beside it. The word itself is
              never lost: it is the `sr-only` label and the `title` at every
              size. */}
          {room.pageSwitch === 'named' ? (
            page === 'state' ? 'Edit' : 'Done'
          ) : (
            <>
              <span aria-hidden="true">{page === 'state' ? '\u270E' : '\u2713'}</span>
              <span className="sr-only">{page === 'state' ? 'Edit' : 'Done'}</span>
            </>
          )}
        </Button>
      </div>

      {page === 'edit' ? (
        <EditPage
          held={held}
          onEdit={onEdit}
          onAnother={onAnother}
          trouble={trouble}
          busy={busy}
          room={room}
        />
      ) : (
        <>
          <TargetRow
            target={target}
            targets={targets}
            candidates={candidates}
            narrowed={narrowed}
            outline={outline}
            onOutline={onOutline}
            onTarget={onTarget}
            busy={busy}
            room={room}
            open={picker}
            onOpen={setPicker}
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
              {held.rows.map((row) => (
                <ItemRow
                  key={row.item.id}
                  list={held.checklist.id}
                  row={row}
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
                  + 'piece of work owes is a judgement, and Edit is where the first line starts.'
                : 'No items yet. Nothing ships a list — press Edit and write the first line.'}
            </p>
          )}

          {/* A refusal is drawn where it was caused. A tick is refused on this
              page and there is nowhere else on it for the sentence to go, so it
              is drawn at the bottom of the card rather than inside a picker
              nobody has open. */}
          {trouble && !picker ? (
            <p className="shrink-0 border-t px-2 py-1.5 text-[0.7rem] leading-4 text-failed">{trouble}</p>
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * The edit page: everything that changes the list, and nothing that ticks it.
 *
 * ## No target row, and no ticks
 *
 * Both are facts about ONE pairing of this list with one piece of work, and
 * every act on this page is about the list itself. An item added is added for
 * every target the list is ever held against; an item removed takes every tick
 * on it, against every target, with it. Drawing a tick beside a line somebody is
 * about to reword would suggest the reword is scoped to whatever is on screen,
 * which is the "two halves quietly disagreeing" failure this workspace keeps
 * finding. The one act that cannot be undone says the unscoped truth in words,
 * in the row, where it is about to happen.
 *
 * ## The box is at the top and it is always drawn
 *
 * On the state page a permanent box was half of a 300-pixel frame, which is what
 * `Sheet` was built to answer. Here the whole frame IS the box's screen: a
 * reader pressed `Edit` to write something, and putting the box behind a second
 * press would be asking them to say so twice. Two rows rather than five, because
 * the items under it are the other reason to be here.
 */
function EditPage({
  held,
  onEdit,
  onAnother,
  trouble,
  busy,
  room,
}: {
  held: Held
  onEdit: (edit: Edit) => void
  onAnother: () => void
  trouble: string | null
  busy: boolean
  room: Room
}) {
  const [typing, setTyping] = useState('')

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
    <>
      <div className="flex shrink-0 flex-col gap-1 border-t bg-muted/40 px-2 py-1.5">
        <textarea
          id="add-item"
          aria-label="Add a line"
          rows={2}
          value={typing}
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => {
            /* Enter files it and shift-enter is a newline, which is the pair
               every message box on this machine already uses. */
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
        <Keying room={room} />
      </div>

      {held.rows.length ? (
        <ul
          className={cn('border-t', room.pinned && 'min-h-0 flex-1 overflow-y-auto')}
          data-scroller={room.pinned ? 'edit' : undefined}
        >
          {held.rows.map((row, at) => (
            <EditRow
              key={row.item.id}
              list={held.checklist.id}
              item={row.item}
              at={at}
              last={at === held.rows.length - 1}
              onEdit={onEdit}
              busy={busy}
              room={room}
            />
          ))}
        </ul>
      ) : (
        /* `flex-1` only where the card is a flex column, which is only where it
           is pinned. Flowing, it is an ordinary paragraph in an ordinary
           document and `flex-1` would be a rule with no container to act in. */
        <p
          className={cn(
            'border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground',
            room.pinned && 'min-h-0 flex-1',
          )}
        >
          Nothing on this list yet. The box above is where the first line goes.
        </p>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t bg-muted/40 px-2 py-1.5">
        <Button type="button" variant="outline" size="container" onClick={onAnother} data-another>
          Use another checklist
        </Button>
        <Forget id={held.checklist.id} name={held.checklist.name} busy={busy} onEdit={onEdit} />
      </div>
    </>
  )
}

/**
 * How ticks are keyed, said once, on the page where somebody is setting a list up.
 *
 * ## Why it is here and not on the state page
 *
 * It was on the state page, under the target row, and the owner moved it:
 *
 * > "Shouldn't this show in the edit view of the checklist?"
 *
 * Yes, and for the reason every other request on this module has had: the state
 * page shows state and the edit page explains itself. "Ticks belong to this list
 * and one target together" is not a fact about the moment — it is true of every
 * target this list will ever be held against, it cannot change while somebody
 * looks at it, and it is read ONCE, by whoever is deciding whether one list or
 * two is the right shape for the work. Standing on the state page it is a
 * paragraph of documentation between the reader and the items, and at 220 pixels
 * it is a paragraph standing ON the items.
 *
 * ## It names no target, which is what makes it true
 *
 * The old wording opened with the target's own kind — "A section of a paper.
 * Ticks belong to…" — because it was drawn beside that target. This page has no
 * target and must not grow one: `EditPage`'s whole argument is that nothing here
 * is scoped to one pairing. So the sentence says the general thing, which is the
 * thing it was always actually saying. The kind of the current target still has
 * a place: it is the `title` on the state page's change press, where it is about
 * the row it sits on rather than about the list.
 *
 * ## `room.prose`, like its neighbour
 *
 * Dropped in a container too narrow for prose, on the same rule as the sentence
 * about an item being added for every target — which is the other half of the
 * same idea, four words above it. Neither is the only thing explaining an inert
 * screen, which is the test a sentence has to pass here to be drawn at all
 * sizes.
 */
function Keying({ room }: { room: Room }) {
  if (!room.prose) return null
  return (
    <p className="text-[0.65rem] leading-4 text-muted-foreground" data-keying>
      Ticks belong to this list and one target together — the same list held against something else keeps its own.
    </p>
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
 * It is a component of its own because a two-press arm whose second sentence is
 * missing is a dialog with the warning deleted, and this one is now drawn beside
 * `Use another checklist` — the press somebody meant when they only wanted to
 * look at a different list, which is why that distinction is in the sentence.
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
 * nothing recorded can become unreachable, then, for a paper, its own files and
 * the headings inside them, and last a box for typing one, which is how this
 * works with nothing else running at all.
 *
 * A target with no ticks yet, no context proposing it and no place in the paper
 * simply does not appear, and that is correct: it is not a thing that exists, it
 * is a thing somebody could type.
 *
 * ## The files, which are the change, and why offering them is not guessing
 *
 * > "In checklist you still can only type something there, you don't get a list
 * > of options to choose from (in the case where the checklist is targeting a
 * > paper it should offer a checklist for different chapters)."
 *
 * `src/view/choose.tsx` carries an essay called "why there is no default and no
 * guess", and the two have to be read together or this looks like a reversal. It
 * is not. That essay refuses to CHOOSE for somebody — to open on a list nobody
 * picked, to hold work against a target nothing named — and every word of it
 * survives here: nothing below is preselected, the row still says `nothing yet`
 * when nothing has named a target, and the rows below it still refuse to tick.
 *
 * What is removed is a different thing: the requirement that a reader SPELL a
 * name this program minted. A section target is `chapters:3_methods#sec:meth-design`,
 * which is not a name anybody chose — it is a slug `list/scope.ts` builds out of
 * a `\label` — and asking a person to type it is asking them to reimplement
 * `slug()` in their head. Enumerating what exists so somebody can point at one is
 * the opposite of guessing: it is refusing to make them guess. The scan is
 * `file/outline.ts`, which reuses this module's one heading scanner and opens the
 * files itself rather than asking the paper module for its outline.
 *
 * ## The box stays, at every size, and that is the point of it
 *
 * A person naming something the scan cannot see — a file nobody has written yet,
 * a tracker reference, anything that is not a document at all — must not be
 * blocked by a picker. So the list is a convenience over the freedom rather than
 * a replacement for it: the box is drawn whether the scan found seven files or
 * none, and it is drawn identically for a checklist held against an issue, which
 * has no chapters and never will.
 *
 * There is deliberately no way to type a SECTION id here, and only one box. Two
 * boxes, or a box with a kind switch beside it, would be two controls in a
 * 220-pixel column for a spelling this program mints and a person does not have.
 * Where a section genuinely does not exist yet there is nothing to hold a tick
 * against but the file or the paper, and both of those are one press away above.
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
  outline,
  onOutline,
  onTarget,
  busy,
  room,
  open,
  onOpen,
}: {
  target: Target | null
  targets: { target: Target; done: number }[]
  candidates: Target[]
  narrowed: Narrowed
  outline: Outline | null
  onOutline: () => void
  onTarget: (target: Target | null) => void
  busy: boolean
  room: Room
  /** Whether this is showing. Held by the card, so only one thing ever is. */
  open: boolean
  onOpen: (want: boolean) => void
}) {
  const [typing, setTyping] = useState('')
  const overlaid = room.compose === 'overlay'

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

  const scoped = narrowed.scope.kind !== 'elsewhere'
  /* Which paper the files below would belong to. Read off the scope rather than
     off `target`, because the scope is what the SERVER resolved and the target
     is what this page asked for — and `scopeOfTarget` is the one place that
     reconciles them. Null for a ref, which is the whole of "an issue's screen
     looks exactly as it does now". */
  const epic = narrowed.scope.kind === 'elsewhere' ? null : narrowed.scope.epic
  /* The file the reader is actually in, so its headings are already unfolded.
     A paper rung has no file, and neither does an issue. */
  const here = narrowed.scope.kind === 'file' || narrowed.scope.kind === 'section' ? narrowed.scope.file : null

  const close = () => onOpen(false)

  const type = () => {
    const ref = typing.trim()
    if (!ref) return
    setTyping('')
    close()
    onTarget({ kind: 'ref', ref })
  }

  const hold = (one: Target) => {
    close()
    onTarget(one)
  }

  const picking = (
    <div className={cn('flex flex-col gap-1.5', !overlaid && 'mt-1')}>
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
                onClick={() => hold(one)}
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

      {epic ? (
        <Paper
          epic={epic}
          outline={outline}
          here={here}
          target={target}
          targets={targets}
          busy={busy}
          onHold={hold}
        />
      ) : null}

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
  /*
   * ...and the one case where `briefOf` cannot know the words: a section the
   * reader picked but is not standing in.
   *
   * `scopeOfTarget` in `list/scope.ts` explains why it prints the id there — it
   * only has the author's real heading when the passage under the reader IS the
   * section the target names, and printing a title from somewhere else would be
   * the two-halves-disagreeing failure. That was right when the only way to get a
   * section target was to walk into it. The picker made it the ORDINARY case:
   * press "Research design" from the list and the row came back reading
   * `sec:meth-design`, which is a slug the reader wrote as a `\label` being read
   * back at them instead of the words they had just pressed. Found by
   * `dev/picker.probe.mjs`, not by looking at the code.
   *
   * So the words come from the outline — the same scan the button was drawn
   * from, so the row and the press cannot disagree about what a heading is
   * called. It is not a second source and it is not a guess: an id absent from
   * the outline (a target from another paper, an agent's, one whose heading has
   * been renamed since) falls straight back to `briefOf` and its honest id.
   */
  const rung = narrowed.scope
  const titled = rung.kind === 'section'
    ? outline?.files.flatMap((file) => file.sections).find((one) => one.id === rung.id)?.title ?? null
    : null
  const name = target ? (scoped ? titled ?? briefOf(narrowed.scope) : targetName(target)) : 'nothing yet'

  return (
    /* `data-strip` is for the probes, in the same spirit as `data-target` and
       `data-count` beside it: the thing this change is measured by is how tall
       this strip is, and a probe that had to guess which `div` it was would be
       measuring whatever the last refactor left. See `dev/filters.probe.mjs`. */
    <div className="shrink-0 border-t bg-muted/40 px-2 py-1.5" data-strip>
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
          onClick={() => {
            /* Asked for here and nowhere else, because this is the press that
               makes the answer worth having. The outline opens every file of a
               paper; fetching it on every context — one arrives after every
               selection change anywhere on the canvas — would read the whole
               thesis several times a second for a list nobody is looking at. */
            if (!open && epic) onOutline()
            onOpen(!open)
          }}
          data-switch
          /* What KIND of thing the row above is naming, which is the one fact the
             name alone cannot carry — `gh#105` and a `\label` look alike at this
             size. The article comes from `targetNoun` and is never written here;
             see the essay on it in `list/targets.ts` for why a caller that
             prepends one is guessing.

             What is NOT here any more is the sentence about how ticks are keyed.
             That moved to the edit page — see the essay on `Keying` below. */
          title={
            target
              ? `Held against ${targetNoun(target)}. Press to change it.`
              : 'Nothing has said what this list is held against.'
          }
        >
          {open && !overlaid ? 'done' : 'change'}
        </Button>
      </div>

      {/* The SENTENCE about nothing being tickable never goes at any size: it is
          the only thing on screen explaining why every row below is inert.

          Its old counterpart — "A section of a paper. Ticks belong to this list
          and this target together…" — is gone from this page rather than folded
          away, and the owner is the one who moved it:

          > "Shouldn't this show in the edit view of the checklist?"

          It should, and the reason is the split this whole module is built on.
          How ticks are KEYED is a fact about the list — true of every target it
          will ever be held against, unchanged by anything on this page, and read
          once while somebody is setting a list up. The state page answers "where
          am I and what is the state of the thing in front of me". A permanent
          paragraph of documentation on it is furniture, and at 220 pixels it is
          furniture standing on the items. It is in `EditPage` now, next to the
          sentence about an item being added for every target, which is the other
          half of the same idea. */}
      {target ? null : (
        <p className="mt-0.5 text-[0.65rem] leading-4 text-muted-foreground">
          Nothing has said what this list is being held against, so nothing below can be ticked. Pick or type a target.
        </p>
      )}

      {/*
        * What the narrowing is hiding. The count, and no longer the press.
        *
        * This never folds away at any size, and that is the whole point of it.
        * The ticks on this list belong to (list, target, item), so walking from
        * a paper into one of its sections replaces every tick on screen with
        * none — and a reader who ticked eight items yesterday and now reads
        * `0/12` has no way to tell narrowing from this app having lost them. A
        * container that cannot say what it is hiding is indistinguishable from a
        * broken one.
        *
        * ## Why the count stayed when the widen press left
        *
        * The press went to the container header, where `roadmap.filters` puts
        * every module's narrowing control — the ladder is offered there as a
        * grain, and `src/app.tsx` says at length why that is honest. The count
        * could not follow it: a host sees rows it does not render, in a store on
        * another origin, and cannot add up ticks it has never been told about.
        * The protocol says the same thing on `filterOptionSchema` — a header
        * control can say THAT something is narrowed, never how much.
        *
        * So the split is truth here, choice there. What that is worth is a whole
        * line of a 300-pixel-tall container back: the row is drawn now only when
        * there is actually something hidden, where before it was drawn on every
        * rung below the paper, because the press had to be reachable even when
        * the count was nought.
        */}
      {narrowed.elsewhere ? (
        <p className="mt-0.5 text-[0.65rem] leading-4 text-muted-foreground" data-elsewhere={narrowed.elsewhere}>
          {narrowed.elsewhere} ticked elsewhere in this paper.
        </p>
      ) : null}

      {open && !overlaid ? picking : null}
      {open && overlaid ? (
        <Sheet title="Hold this list against" onClose={close}>
          {picking}
        </Sheet>
      ) : null}
    </div>
  )
}

/**
 * The paper's own files, and the headings in each of them.
 *
 * ## A row per file, rather than every target as a button
 *
 * The owner's thesis is seven files and about fifty headings. As a wrapping
 * strip of buttons — which is how the targets above are drawn, and is right for
 * the three or four of them — that is fifty small boxes in a 220-pixel column,
 * which is a wall rather than a list. So the files are rows, one per line, and a
 * file's headings are behind the `⌄` on its own row.
 *
 * ## Which file is already open, and why it is not "the first one"
 *
 * The file the reader is standing in. That is the one they are likeliest to want
 * a heading out of, it is free — `narrowed.scope` already knows it — and it is
 * not a guess about their intent, it is a fact about where they are. Opening the
 * first file instead would be this program choosing, which is the thing
 * `src/view/choose.tsx` refuses.
 *
 * ## Pressing a file holds the list against the file
 *
 * Not "expands it". The `⌄` is a separate, small, second press for exactly that
 * reason: `chapters/3_methods.tex` is itself a perfectly good target — it is the
 * middle rung of the ladder in `list/scope.ts` — and a row whose only behaviour
 * was to expand would make the file rung unreachable from the one screen that
 * lists the files.
 *
 * ## The count beside a row is ticks, and its absence is not zero
 *
 * A number is drawn only where this list actually has ticks against that target,
 * because that is the fact worth knowing before pressing: this is somewhere work
 * has already been recorded. Nothing is drawn where there are none, rather than
 * a `0`, so the eye finds the ones that matter instead of reading fifty zeroes.
 */
function Paper({
  epic,
  outline,
  here,
  target,
  targets,
  busy,
  onHold,
}: {
  epic: string
  outline: Outline | null
  /** The file the reader is standing in, whose headings start unfolded. */
  here: string | null
  target: Target | null
  targets: { target: Target; done: number }[]
  busy: boolean
  onHold: (target: Target) => void
}) {
  const [shut, setShut] = useState<Record<string, boolean>>({})
  const done = (section: string | null) =>
    targets.find((one) => targetKey(one.target) === targetKey({ kind: 'paper', epic, section }))?.done ?? null
  const chosen = (section: string | null) =>
    Boolean(target && targetKey(target) === targetKey({ kind: 'paper', epic, section }))

  if (!outline) {
    /* Null is "not asked yet, or nothing to offer", and the two are not worth
       distinguishing on screen: both mean the files are not below, and the box
       under this paragraph types anything either way. The alternative — a
       spinner and then a different sentence — spends two states of a 220-pixel
       column on a fetch that reads seven local files. */
    return (
      <p className="text-[0.65rem] leading-4 text-muted-foreground" data-paper="none">
        No files of this paper could be read from here. The whole paper is above, and the box below takes anything.
      </p>
    )
  }

  if (!outline.files.length) {
    return (
      <p className="text-[0.65rem] leading-4 text-muted-foreground" data-paper="empty">
        This paper has no files this app can read. The whole paper is above, and the box below takes anything.
      </p>
    )
  }

  return (
    <div className="flex flex-col" data-paper={outline.files.length}>
      <span className="text-[0.65rem] leading-4 text-muted-foreground">In this paper</span>
      <ul className="rounded border">
        {outline.files.map((file) => {
          /* Open by default for the file the reader is in, shut for the rest,
             and the state records DEPARTURES from that rather than the truth —
             so walking into another chapter re-opens the right one without this
             component having to notice that it moved. */
          const open = shut[file.id] === undefined ? file.file === here : !shut[file.id]
          const count = done(file.id)
          return (
            <li key={file.id} className="border-t first:border-t-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  data-pick-file={file.id}
                  title={file.file}
                  onClick={() => onHold({ kind: 'paper', epic, section: file.id })}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left text-[0.75rem] leading-4 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                    chosen(file.id) && 'font-semibold text-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 break-words">{file.name}</span>
                  {count === null ? null : (
                    <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">{count}</span>
                  )}
                </button>
                {file.sections.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="container"
                    className="shrink-0 px-1"
                    data-open-file={open ? 'open' : 'shut'}
                    title={open ? `Hide the headings in ${file.name}` : `${file.sections.length} headings`}
                    onClick={() => setShut((was) => ({ ...was, [file.id]: open }))}
                  >
                    <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
                    <span className="sr-only">
                      {open ? `Hide the headings in ${file.name}` : `Show the headings in ${file.name}`}
                    </span>
                  </Button>
                ) : null}
              </div>
              {open && file.sections.length ? (
                <ul className="border-t bg-muted/30">
                  {file.sections.map((section) => {
                    const at = done(section.id)
                    return (
                      <li key={section.id}>
                        <button
                          type="button"
                          disabled={busy}
                          data-pick-section={section.id}
                          onClick={() => onHold({ kind: 'paper', epic, section: section.id })}
                          /* Indented by depth, capped at three steps. A
                             `\subparagraph` is seven levels down in LaTeX and
                             seven indents is half the width of this column gone
                             to whitespace. Three is enough to read the shape and
                             leaves the words the rest. */
                          style={{ paddingLeft: `${0.375 + Math.min(Math.max(section.level - 1, 0), 3) * 0.5}rem` }}
                          className={cn(
                            'flex w-full items-center gap-1 py-1 pr-1.5 text-left text-[0.7rem] leading-4 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                            chosen(section.id) ? 'font-semibold text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {/* Never truncated: the words at the top of a section
                              are how somebody tells one from another, and a
                              heading is one line of prose rather than an
                              address. */}
                          <span className="min-w-0 flex-1 break-words">{section.title}</span>
                          {at === null ? null : <span className="shrink-0 tabular-nums">{at}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
      {outline.capped ? (
        <span className="text-[0.65rem] leading-4 text-muted-foreground">
          Only part of this paper was read. Anything missing can still be typed below.
        </span>
      ) : null}
    </div>
  )
}

/**
 * One item on the state page, and the tick made on it FOR THIS TARGET.
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
 * ## There is no furniture on this row at any size, and there used to be a lot
 *
 * A mark, the words, and nothing else. What was here:
 *
 * - **The arrows and the ×**, inline in a wide container and behind a `⋯` press
 *   in a narrow one. They are on the edit page now, where they are the point
 *   rather than a cost, so neither the buttons nor the press that hid them is
 *   drawn here.
 * - **"written by …"** under an unticked line, at sizes with room for it.
 * - **"ticked by claude, over MCP"** under a ticked one, at every size.
 *
 * ## Who ticked it is not drawn, and the argument that said it must be is
 * answered here rather than deleted
 *
 * What stood in this file said: an agent may tick anything on this list, every
 * item is a line somebody wrote, and what makes an agent's tick safe is that the
 * claim is legible AS a claim — so a bare checkmark with nobody's name against it
 * is exactly what `list/checklists.ts` refuses, and a narrow container is not a
 * reason to break that.
 *
 * The owner has answered it:
 *
 * > "in checklist, information about what checklist items is and isn't written
 * > by Claude is not important information, get rid of it."
 *
 * Which is a judgement about this container and not a hole in the reasoning, so
 * it is worth being exact about which part was overtaken and which part still
 * holds.
 *
 * **Overtaken: that the ROW is where the claim has to be legible.** That was
 * always the weakest link in the chain. A name under a tick is read by somebody
 * who is already looking at the tick and who, in this container, is nearly always
 * the only person using it — so the line was spending one of very few lines to
 * tell one reader what they already knew, sixteen times over.
 *
 * **Still holds, and is still enforced: the tick may not be anonymous, and it is
 * not.** `by` and `viaMcp` are still written on every tick and still stored — the
 * display came out, the record did not, and dropping the fields would be a
 * migration with no undo for a rewording of one line of UI. `viaMcp` is still
 * never inferred from the name. And the MCP door still answers an agent with
 * `… is ticked for <target>, by <name>`, which is where a claim being legible
 * actually matters: the agent is told what it just asserted and in whose name.
 *
 * **Still holds, and was always the load-bearing half: one press takes it back.**
 * The essay's own sentence was "legible as a claim and REVERSIBLE by the person
 * who can judge it". Reversibility is what makes an agent's tick safe, it is a
 * property of this row, and this row still has it — pressing a ticked line
 * unticks it, at every size, with nothing hidden behind anything.
 *
 * `list/checklists.ts` has been rewritten to say the same, so the two files do
 * not disagree about what the promise is.
 */
function ItemRow({
  list,
  row,
  target,
  onEdit,
  busy,
  room,
}: {
  list: string
  row: Held['rows'][number]
  target: Target | null
  onEdit: (edit: Edit) => void
  busy: boolean
  room: Room
}) {
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
            title={done ? 'Ticked for this target. Press to take it back.' : 'Press when this is actually done here.'}
            onClick={() => onEdit({ op: 'tick', id: list, item: item.id, target, done: !done })}
            className="flex min-w-0 flex-1 items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {mark}
            <span className="sr-only">{done ? 'ticked' : 'not ticked'}</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-1.5">{mark}</div>
        )}
      </div>

      {/* The note an agent left saying HOW it knows, which is content rather than
          provenance: a sentence somebody wrote about the work, not a badge saying
          who they were. It survives the removal above for that reason, and it is
          only ever there when somebody bothered to write one. */}
      {done?.note ? (
        <p className="mt-1 pl-[1.375rem] text-[0.7rem] leading-4 text-muted-foreground">{done.note}</p>
      ) : null}
    </li>
  )
}

/**
 * One item on the edit page: its words, and the three things that can be done to
 * them.
 *
 * ## The text is the reword control, so rewording costs no button
 *
 * Pressing the line turns it into a box holding exactly what was there. That is
 * one fewer control per row than a pencil would be, in a column where three
 * controls a row was already the thing the fold was invented to hide — and it is
 * how every list on this machine that can be edited in place already behaves, so
 * it is discoverable by trying rather than by being labelled.
 *
 * Escape abandons it and leaves the line as it was, Enter files it, and
 * shift-Enter is a newline — the same pair as every other box in this module. A
 * reword to the same words, or to nothing at all, is dropped rather than sent:
 * an empty item is a row nobody can read and the store would refuse it anyway,
 * which would put a refusal on screen for a press that meant "never mind".
 *
 * ## `room.controls` decides where the arrows sit, and never whether
 *
 * `beside` above 360 pixels, `under` below it, and that threshold is the
 * measurement in `src/view/room.ts` rather than a round number: at 320 the three
 * controls beside the text wrapped anyway and cost MORE than putting them on
 * their own line. Nothing here is ever behind a press — this is the page whose
 * job they are.
 */
function EditRow({
  list,
  item,
  at,
  last,
  onEdit,
  busy,
  room,
}: {
  list: string
  item: Held['rows'][number]['item']
  at: number
  last: boolean
  onEdit: (edit: Edit) => void
  busy: boolean
  room: Room
}) {
  const [arming, setArming] = useState(false)
  const [typing, setTyping] = useState<string | null>(null)

  const reword = () => {
    const text = (typing ?? '').trim()
    setTyping(null)
    if (!text || text === item.text) return
    onEdit({ op: 'reword', id: list, item: item.id, text })
  }

  const controls = (
    <span className="flex shrink-0 items-center gap-0.5">
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
      {/* Two presses, and for the reason set out above `Forget`:
          `window.confirm` is ignored inside the host's sandbox, so the second
          press is asked for where it can actually be seen. */}
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
  )

  return (
    <li data-item={item.id} className="border-t px-2 py-1.5 first:border-t-0">
      <div className={cn('flex gap-1.5', room.controls === 'beside' ? 'items-start' : 'flex-col')}>
        {typing === null ? (
          <button
            type="button"
            disabled={busy}
            data-reword={item.id}
            title="Press to reword this line"
            onClick={() => setTyping(item.text)}
            className="min-w-0 flex-1 break-words rounded text-left text-[0.8rem] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {item.text}
          </button>
        ) : (
          <textarea
            aria-label="Reword this line"
            autoFocus
            rows={3}
            value={typing}
            onChange={(e) => setTyping(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setTyping(null)
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                reword()
              }
            }}
            onBlur={reword}
            className="min-w-0 flex-1 resize-y rounded border bg-background px-1.5 py-1 text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        {controls}
      </div>

      {arming ? (
        <p className="mt-1 text-[0.7rem] leading-4 text-pending">
          Press × again to take this off the list for good, along with every tick on it against every target. Ticking
          is what you want if it is done; this is for a line that turned out not to be owed.
        </p>
      ) : null}
    </li>
  )
}

import { useState } from 'react'

import type { Edit, Held, Here } from '@/store/ask.ts'
import { labelOf } from '../../list/scope.ts'
import { targetKey, targetNoun, type Target } from '../../list/targets.ts'
import { evidenceOf } from '../../list/evidence.ts'
import { focusLine, type Focus } from '../../list/focus.ts'
import { FOCUS_WHERE, type TrackerRow } from 'kehikot-module-protocol'

import { Button } from '@/components/ui/button.tsx'
import { FactLine, RefFacts, type Facts } from '@/view/facts.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The reading page: every checklist held against what is in front of the
 * reader, and nothing else.
 *
 * ## The sentence this page is
 *
 * > "by default when I am scrolling in a paper i want to see the checklist(s)
 * > that I have assigned for that section/file in question. I dont want to see
 * > it swapping its mind on what its connected to — infact I dont need the
 * > information on 'Reading x, Nothing has been ticked yet'-bullshit, or 'hold
 * > it against x.tex' its completely useless information, I just want to see
 * > the instances of the checklists connected to that section of the paper
 * > that is being scrolled through. Or, in the case of selecting a specific
 * > issue or an mr or a pr, I want to see the checklists specific to those
 * > issues etc."
 *
 * So this page draws instances. An instance is one checklist against one of
 * its targets — `showing` in `list/holding.ts` decides which, from where the
 * reader is and what every list is held against — and each is its name, its
 * count, one short line saying WHICH of its targets these ticks belong to, and
 * its items, tickable. Nothing here changes what a list is connected to: the
 * one press per instance leads to the edit page, which is where that lives.
 *
 * ## What is deliberately not on it
 *
 * The row that said `Reading <file>` and the press that said `change`. The
 * screen that said "not held here" with a press to hold the list there. The
 * sentence about nothing having been ticked yet. All of them were the previous
 * model explaining, on every scroll, a decision it was making on the reader's
 * behalf — and once the decision is a person's, made once on the edit page,
 * none of them has anything to say. The owner called them useless; they were,
 * because the thing they were about no longer happens.
 *
 * What survives of that row is ONE muted line under each name, and it says
 * something different: not where the reader is, but which target this
 * instance IS. It is there because several instances can be on screen at once
 * — the chapter's list and the whole thesis's — and two lists of ticks with
 * nothing saying which is which would be the two-halves-disagreeing failure
 * this workspace keeps finding. It is a label, not a sentence, and it never
 * offers anything.
 *
 * ## Zero, one, several
 *
 * None: one line, and the way to every checklist beside it. Which line
 * depends on whether there is anything in front of the reader at all — "no
 * list is held against this" and "nothing is open or selected" send a person
 * to two different places, and only the first is fixed on an edit page. And a
 * third line, ahead of both, when it was the PICKS that emptied the page:
 * "paper and journeys are picked out; no checklist is held against what they
 * show". A pane that went empty because a neighbour was ticked has to say so,
 * or its emptiness has no visible cause — the sentence names the containers,
 * says which of them show nothing, and the way out is the filter in this
 * container's own header. `list/aim.ts` writes it.
 *
 * One: the list, its label, its items.
 *
 * Several: stacked, in the order `showing` gives — the selected references'
 * lists first, then the paper's — each foldable so a reader in a 300-pixel
 * frame can put one away while ticking another. The fold is session state and
 * is written down nowhere.
 *
 * ## The parts focus, which is the one line this page prints about itself
 *
 * When a person has picked parts of the epic out in the host's bar, the lists
 * held against references outside those parts are put aside, and a line at
 * the top says so: how many, which parts, and — when one is on screen — that
 * the paper's lists were not narrowed. It is the same rule as the sentence
 * for picked-out containers above, applied before the page is empty rather
 * than only once it is, because this narrowing has no control in this
 * container's header to explain it: the pick is the host's. Nothing is drawn
 * with nothing picked. `list/focus.ts` writes it.
 *
 * ## The way to everything
 *
 * `All checklists` is a strip at the bottom rather than a heading at the top,
 * because it is the way OUT of this page and not what the page is for; pinned,
 * the strip stays put while the instances scroll under it, so it is reachable
 * from anywhere in a long list.
 */
export function HereView({
  here,
  somewhere,
  why = null,
  onEdit,
  onOpen,
  onAll,
  trouble,
  busy,
  room,
  facts = null,
  focus = null,
}: {
  /** What the server said is in front of the reader, or null before it has said anything. */
  here: Here | null
  /** Whether there is anything at all in front of the reader: an epic, a passage, a selection, or something a container shows. */
  somewhere: boolean
  /** Why the page is empty when the picks emptied it, or null when they did not. See `whyEmpty` in `list/aim.ts`. */
  why?: string | null
  onEdit: (edit: Edit) => void
  /** Open one checklist's edit page. */
  onOpen: (id: string) => void
  /** Go to the screen that lists every checklist in the project. */
  onAll: () => void
  trouble: string | null
  busy: boolean
  room: Room
  /** What the host's tracker reading says about the refs in front, or null when there is none. See `facts.tsx`. */
  facts?: Facts | null
  /** What the parts focus put aside, or null when no part of the epic is picked out. See `list/focus.ts`. */
  focus?: Focus | null
}) {
  /* Which instances are folded, keyed by list and target, so the same list
     against two targets folds separately. Departures from "open", so a new
     instance arriving after a scroll is open without this noticing. */
  const [shut, setShut] = useState<Record<string, boolean>>({})

  /* Not read yet. `App` draws the shared cover for that — waiting for a host, loading, or this
     app's own server not answering — so there is nothing of this screen's to draw. */
  if (!here) return null

  const several = here.instances.length > 1

  return (
    <section
      /* `relative overflow-hidden`, and no card, for the reasons given at
         length in `edit.tsx`: an `sr-only` label escapes a scroller that is
         not its containing block, and the host already draws the container. */
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-here={here.instances.length}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      {/* Above the lists and outside the scroller, so it stays put while they
          scroll: it is the reason the page is shorter than it was. Wrapped and
          never truncated, like every line here. */}
      {focus ? (
        <p
          className="shrink-0 border-b bg-muted/40 px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground"
          data-focus={focus.outside}
          title={FOCUS_WHERE}
        >
          {focusLine(focus)}
        </p>
      ) : null}

      {here.instances.length ? (
        <div
          className={cn(room.pinned && 'min-h-0 flex-1 overflow-y-auto', room.snap && 'snap-y snap-proximity')}
          data-scroller={room.pinned ? 'instances' : undefined}
        >
          {here.instances.map((held) => {
            const target = held.target as Target
            const key = `${held.checklist.id}|${targetKey(target)}`
            return (
              <Instance
                key={key}
                held={held}
                target={target}
                label={labelOf(target, here.placed, null)}
                open={!shut[key]}
                foldable={several}
                onFold={() => setShut((was) => ({ ...was, [key]: !was[key] }))}
                onEdit={onEdit}
                onOpen={onOpen}
                busy={busy}
                room={room}
                facts={facts}
              />
            )
          })}
        </div>
      ) : (
        <p
          className={cn('px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground', room.pinned && 'min-h-0 flex-1')}
          data-none={why ? 'narrowed' : somewhere ? 'held' : 'front'}
        >
          {why
            ?? (somewhere
              ? 'No checklist is held against what is in front of you.'
              : 'Nothing is in front of you: no paper is open and nothing is selected.')}
        </p>
      )}

      {trouble ? (
        <p className="shrink-0 border-t px-2 py-1.5 text-[0.7rem] leading-4 text-failed">{trouble}</p>
      ) : null}

      <div className="flex shrink-0 items-center gap-1.5 border-t bg-muted/40 px-2 py-1.5">
        <Button type="button" variant="ghost" size="container" data-all onClick={onAll}>
          All checklists
        </Button>
      </div>
    </section>
  )
}

/**
 * One checklist against one target: name, count, which target, items.
 *
 * `label` comes in from the page rather than being derived here, because the
 * page is the one holding `placed` — the file and the heading the reader is
 * actually in — and a section's real words are only known there.
 */
function Instance({
  held,
  target,
  label,
  open,
  foldable,
  onFold,
  onEdit,
  onOpen,
  busy,
  room,
  facts,
}: {
  held: Held
  target: Target
  label: string
  open: boolean
  foldable: boolean
  onFold: () => void
  onEdit: (edit: Edit) => void
  onOpen: (id: string) => void
  busy: boolean
  room: Room
  facts: Facts | null
}) {
  const ref = target.kind === 'ref' ? target.ref : null
  const refRow = ref ? (facts?.rows[ref] ?? null) : null
  return (
    <section
      className="border-t first:border-t-0"
      data-instance={held.checklist.id}
      data-target={targetKey(target)}
      data-open={open ? 'yes' : 'no'}
    >
      <div className="flex items-start gap-1.5 px-2 py-1.5">
        {foldable ? (
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="shrink-0 px-1"
            data-fold
            title={open ? 'Fold this list away' : 'Unfold this list'}
            onClick={onFold}
          >
            <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
            <span className="sr-only">{open ? 'Fold' : 'Unfold'}</span>
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[0.8rem] font-semibold">{held.checklist.name}</h2>
          {/* The one line that says which target these ticks belong to. A label
              and never a sentence; `title` carries the kind for anybody who
              needs it, with its article from `targetNoun` and not from here. */}
          <p
            className="text-[0.65rem] leading-4 text-muted-foreground"
            data-label
            title={`Held against ${targetNoun(target)}.`}
          >
            {label}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 text-[0.7rem] tabular-nums',
            held.total > 0 && held.done === held.total ? 'text-done' : 'text-muted-foreground',
          )}
          data-count
        >
          {held.done}/{held.total}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="shrink-0 px-1.5"
          data-edit={held.checklist.id}
          title="Edit: the lines, and what this list is held against. Nothing there is ticked."
          onClick={() => onOpen(held.checklist.id)}
        >
          {room.pageSwitch === 'named' ? (
            'Edit'
          ) : (
            <>
              <span aria-hidden="true">{'✎'}</span>
              <span className="sr-only">Edit</span>
            </>
          )}
        </Button>
      </div>

      {/* What the tracker says about the ref, beside the list and under its
          name — only open, so a folded instance is one line again. */}
      {open && ref ? <RefFacts refName={ref} facts={facts} /> : null}

      {open ? (
        held.rows.length ? (
          <ul className="border-t">
            {held.rows.map((row) => (
              <ItemRow
                key={row.item.id}
                list={held.checklist.id}
                row={row}
                target={target}
                onEdit={onEdit}
                busy={busy}
                room={room}
                read={row.item.fact && ref ? { row: refRow, refName: ref, facts } : null}
              />
            ))}
          </ul>
        ) : (
          <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
            No items yet. Nothing ships a list — press Edit and write the first line.
          </p>
        )
      ) : null}
    </section>
  )
}

/**
 * One item on the reading page, and the tick made on it FOR THIS TARGET.
 *
 * The whole row is the tick target, because a checkbox-sized target on a row
 * this narrow is a miss waiting to happen. Unticking is one press: this is a
 * line on somebody's own list and a tick taken back is a tick that can be made
 * again.
 *
 * ## There is no furniture on this row at any size, and there used to be a lot
 *
 * A mark, the words, and nothing else. The arrows and the × are on the edit
 * page, where they are the point rather than a cost. "Ticked by …" is not
 * drawn at any size:
 *
 * > "in checklist, information about what checklist items is and isn't written
 * > by Claude is not important information, get rid of it."
 *
 * The record did not go with the display — `by` and `viaMcp` are still
 * written on every tick, and the MCP door still answers an agent with
 * `… is ticked for <target>, by <name>`. What made an agent's tick safe was
 * never the badge under it; it was that the claim is reversible by the person
 * who can judge it, and that is a property of this row, which still has it.
 * `list/checklists.ts` says the same from the other side.
 */
function ItemRow({
  list,
  row,
  target,
  onEdit,
  busy,
  room,
  read,
}: {
  list: string
  row: Held['rows'][number]
  target: Target
  onEdit: (edit: Edit) => void
  busy: boolean
  room: Room
  /**
   * The tracker's reading of this row's ref, when the item names a fact and
   * the target is a ref; null otherwise. A tick made with a row in hand
   * carries what the item's fact said as the reader pressed.
   */
  read: { row: TrackerRow | null; refName: string; facts: Facts | null } | null
}) {
  const done = row.done
  const item = row.item
  const evidence = !done && item.fact && read?.row ? evidenceOf(read.row, item.fact) : null

  return (
    <li
      data-item={item.id}
      data-done={done ? 'yes' : 'no'}
      className={cn('border-t px-2 py-1.5 first:border-t-0', room.snap && 'snap-start')}
    >
      <button
        type="button"
        disabled={busy}
        aria-pressed={Boolean(done)}
        title={done ? 'Ticked for this target. Press to take it back.' : 'Press when this is actually done here.'}
        onClick={() =>
          onEdit({ op: 'tick', id: list, item: item.id, target, done: !done, ...(evidence ? { evidence } : {}) })
        }
        className="flex w-full min-w-0 items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
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
            item, or an unbroken URL somebody pasted, inside a 220px container.
            Never a Badge and never `truncate`: the text IS the item. */}
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

      {/* The fact this line is checked against, as the tracker says it — read
          beside the press, never pressed by it. */}
      {item.fact && read ? (
        <FactLine fact={item.fact} done={done} row={read.row} refName={read.refName} facts={read.facts} />
      ) : null}

      {/* The note an agent left saying HOW it knows, which is content rather
          than provenance: a sentence somebody wrote about the work. */}
      {done?.note ? (
        <p className="mt-1 pl-[1.375rem] text-[0.7rem] leading-4 text-muted-foreground">{done.note}</p>
      ) : null}
    </li>
  )
}

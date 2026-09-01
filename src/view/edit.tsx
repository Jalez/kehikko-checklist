import { useState } from 'react'

import type { Edit, Held, Outline, Placed, Target } from '@/store/ask.ts'
import { labelOf } from '../../list/scope.ts'
import { targetKey, targetNoun } from '../../list/targets.ts'

import { Button } from '@/components/ui/button.tsx'
import { Sheet } from '@/view/sheet.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The edit page: everything that changes a list, including what it is held
 * against — and nothing that ticks it.
 *
 * ## Why what a list is held against lives HERE, and only here
 *
 * > "This part: `Reading main.tex / change / Nothing has been ticked … Hold it
 * > against what you are reading to start.` <-- Is supposed to be in the edit
 * > view of the checklist where you list the chapters and/or tex files that
 * > the checklist concerns. I dont want it to be able to change on the fly,
 * > only when I am in edit mode of that checklist."
 *
 * Which is the same split this page was already built on. An edit is a change
 * to the LIST — an item added is added for every target it is held against,
 * an item removed takes every tick on it with it — and what a list is ABOUT is
 * the most list-shaped fact there is. It is set here, deliberately, from the
 * paper's own files and headings and the canvas's selected references, and it
 * is written into the list in the project's file. The reading page reads it
 * and cannot change it. That is the whole of "I want that to stick".
 *
 * ## The picker, which is the target picker that used to be on the other page
 *
 * The same offer: the references the canvas has selected, the whole paper the
 * open epic is aimed at, the paper's files and the headings in each of them
 * (`file/outline.ts`, asked for when this page opens), and a box for typing a
 * reference — because a file nobody has written yet, or a target that is not a
 * document at all, must not be blocked by a picker. What changed is what a
 * press MEANS. It used to point the list at one target for the moment; now it
 * holds the list against one more target, for good, and pressing a held one
 * releases it. Every row says which it is.
 *
 * Holding is a claim that a piece of work owes what this list says, and it is
 * one press. Releasing is one press too, because it is safe: the ticks made
 * there stay in the file and come back when the target is held again — the
 * store says so in the sentence it answers with.
 *
 * ## When the paper cannot be listed
 *
 * The outline is found by climbing from the file the reader is in to the one
 * that declares `\documentclass`. A reader editing a list while an issue is
 * selected and no paper open has no such file, so the files cannot be offered
 * — the whole paper still can, from the epic alone, and so can any reference.
 * The line under the paper says what to do about it, which is to open the
 * paper. `src/app.tsx` keeps the last file the reader was in for the session,
 * so walking from a chapter to an issue and pressing Edit still offers the
 * chapters.
 *
 * ## Nothing here is ticked, and the row that used to name a target is gone
 *
 * Drawing a tick beside a line somebody is about to reword would suggest the
 * reword is scoped to one target, which it is not. The old target row named
 * the target in front; there is no target in front on this page — there is the
 * list of every target the list is held against, which is a different thing
 * and the right one.
 *
 * ## The box is at the top and it is always drawn
 *
 * A reader pressed `Edit` to change something, and putting the box behind a
 * second press would be asking them to say so twice. The targets come first
 * because a new list is held against nothing and is shown nowhere until it is
 * held against something — the fact this page exists to make settable.
 */
export function EditView({
  held,
  targets,
  epic,
  selection,
  placed,
  outline,
  paperKnown,
  onEdit,
  onDone,
  trouble,
  busy,
  room,
}: {
  held: Held
  /** Every target this list is held against, with how much is ticked on each. */
  targets: { target: Target; done: number }[]
  /** The epic the canvas is on, whose paper the files below belong to. */
  epic: string | null
  /** The references the canvas has selected, offered as targets. */
  selection: string[]
  /** Where the reader's document is, for naming a section by its words. */
  placed: Placed | null
  /** The paper's files and headings, or null while unknown or unknowable. */
  outline: Outline | null
  /** Whether a file of the paper is known to find the outline from. */
  paperKnown: boolean
  onEdit: (edit: Edit) => void
  /** Back to where the reader came from. */
  onDone: () => void
  trouble: string | null
  busy: boolean
  room: Room
}) {
  const [typing, setTyping] = useState('')
  /** Whether the target picker is showing. Held here so only one thing is. */
  const [picking, setPicking] = useState(false)

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
    <section
      /* `relative` is load-bearing and not decoration: every button on this page
         carries an `sr-only` label, `sr-only` is `position: absolute`, and an
         absolutely positioned box is clipped by an ancestor's `overflow` only if
         that ancestor is ALSO its containing block. Without this the label on
         the sixteenth item escaped the scroller and made the document taller
         than the frame. `overflow-hidden` is the other half of the pair.

         No `rounded-lg border bg-card`: the host draws the container, and a
         second frame inside it is a box in a box whose padding comes out of the
         list. */
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-checklist={held.checklist.id}
      data-page="edit"
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <h2 className="min-w-0 flex-1 break-words text-[0.8rem] font-semibold">{held.checklist.name}</h2>
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="shrink-0 px-1.5"
          data-done
          title="Done: back to what is in front of you."
          onClick={onDone}
        >
          {room.pageSwitch === 'named' ? (
            'Done'
          ) : (
            <>
              <span aria-hidden="true">{'✓'}</span>
              <span className="sr-only">Done</span>
            </>
          )}
        </Button>
      </div>

      <Holding
        list={held.checklist.id}
        targets={targets}
        epic={epic}
        selection={selection}
        placed={placed}
        outline={outline}
        paperKnown={paperKnown}
        open={picking}
        onOpen={setPicking}
        onEdit={onEdit}
        busy={busy}
        room={room}
      />

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
        {trouble && !picking ? <p className="text-[0.7rem] leading-4 text-failed">{trouble}</p> : null}
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
        <Forget id={held.checklist.id} name={held.checklist.name} busy={busy} onEdit={onEdit} />
      </div>
    </section>
  )
}

/**
 * What this list is held against, and the picker that changes it.
 *
 * One row that never folds away — the targets, or the fact that there are
 * none — and a press that opens the picker: inline where there is height for
 * it, over the frame where there is not, on the same rule the create box uses.
 */
function Holding({
  list,
  targets,
  epic,
  selection,
  placed,
  outline,
  paperKnown,
  open,
  onOpen,
  onEdit,
  busy,
  room,
}: {
  list: string
  targets: { target: Target; done: number }[]
  epic: string | null
  selection: string[]
  placed: Placed | null
  outline: Outline | null
  paperKnown: boolean
  open: boolean
  onOpen: (want: boolean) => void
  onEdit: (edit: Edit) => void
  busy: boolean
  room: Room
}) {
  const [typing, setTyping] = useState('')
  const overlaid = room.compose === 'overlay'
  const keys = new Set(targets.map((one) => targetKey(one.target)))
  const isHeld = (target: Target) => keys.has(targetKey(target))

  /* One press either way, and which it is comes from the store's own answer:
     a held target is released, an unheld one is held. */
  const toggle = (target: Target) => onEdit({ op: isHeld(target) ? 'release' : 'hold', id: list, target })

  const type = () => {
    const ref = typing.trim()
    if (!ref) return
    setTyping('')
    onEdit({ op: 'hold', id: list, target: { kind: 'ref', ref } })
  }

  const picker = (
    <div className={cn('flex flex-col gap-1.5', !overlaid && 'mt-1')} data-picker>
      {selection.length ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.65rem] leading-4 text-muted-foreground">Selected on the canvas</span>
          <div className="flex flex-wrap gap-1">
            {selection.map((ref) => {
              const target: Target = { kind: 'ref', ref }
              const on = isHeld(target)
              return (
                <Button
                  key={ref}
                  type="button"
                  variant={on ? 'default' : 'outline'}
                  size="container"
                  disabled={busy}
                  data-pick-target={targetKey(target)}
                  data-held={on ? 'yes' : 'no'}
                  className="max-w-full"
                  title={on ? `Release ${ref}` : `Hold this list against ${ref}`}
                  onClick={() => toggle(target)}
                >
                  <span className="min-w-0 truncate">{ref}</span>
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}

      {epic ? (
        <Paper
          epic={epic}
          outline={outline}
          paperKnown={paperKnown}
          here={placed?.file ?? null}
          isHeld={isHeld}
          done={(target) => targets.find((one) => targetKey(one.target) === targetKey(target))?.done ?? null}
          onToggle={toggle}
          busy={busy}
        />
      ) : (
        <p className="text-[0.65rem] leading-4 text-muted-foreground" data-paper="no-epic">
          No epic is open here, so there is no paper to hold this against. A reference can still be typed below.
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

  return (
    <div className="shrink-0 border-t bg-muted/40 px-2 py-1.5" data-holding={targets.length}>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 text-[0.65rem] text-muted-foreground">Held against</span>
        <span className="min-w-0 flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="container"
          data-switch
          title="Change what this list is held against: the paper's files and headings, or a reference."
          onClick={() => onOpen(!open)}
        >
          {open && !overlaid ? 'done' : 'change'}
        </Button>
      </div>

      {targets.length ? (
        <ul className="mt-0.5 flex flex-wrap gap-1" data-targets>
          {targets.map(({ target, done }) => {
            const key = targetKey(target)
            return (
              <li key={key} className="max-w-full">
                <button
                  type="button"
                  disabled={busy}
                  data-release={key}
                  title={`Held against ${targetNoun(target)}. Press to release it; the ticks made there are kept.`}
                  onClick={() => onEdit({ op: 'release', id: list, target })}
                  className="flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[0.7rem] leading-4 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className="min-w-0 truncate">{labelOf(target, placed, outline)}</span>
                  {done ? <span className="shrink-0 tabular-nums text-muted-foreground">{done}</span> : null}
                  <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                    ×
                  </span>
                  <span className="sr-only">Release</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        /* Never folds away at any size: it is the only thing explaining why a
           list somebody just made is not on the reading page. */
        <p className="mt-0.5 text-[0.65rem] leading-4 text-muted-foreground" data-targets="none">
          Nothing yet. This list is shown nowhere until it is held against a file, a heading or a reference.
        </p>
      )}

      {open && !overlaid ? picker : null}
      {open && overlaid ? (
        <Sheet title="Hold this list against" onClose={() => onOpen(false)}>
          {picker}
        </Sheet>
      ) : null}
    </div>
  )
}

/**
 * The paper: the whole of it, its files, and the headings in each.
 *
 * ## A row per file, rather than every target as a button
 *
 * The owner's thesis is seven files and about fifty headings. As a wrapping
 * strip of buttons that is fifty small boxes in a 220-pixel column, which is a
 * wall rather than a list. So the files are rows, one per line, and a file's
 * headings are behind the `⌄` on its own row.
 *
 * ## Which file is already open, and why it is not "the first one"
 *
 * The file the reader is standing in. That is the one they are likeliest to
 * want a heading out of, it is free, and it is not a guess about their intent,
 * it is a fact about where they are.
 *
 * ## Pressing a file holds the list against the file
 *
 * Not "expands it". `chapters/3_methods.tex` is itself a perfectly good target
 * — it is the middle rung of the ladder in `list/scope.ts` — and a row whose
 * only behaviour was to expand would make the file rung unreachable from the
 * one screen that lists the files.
 *
 * ## The count beside a row is ticks, and its absence is not zero
 *
 * A number is drawn only where this list actually has ticks against that
 * target, so the eye finds the ones that matter instead of reading fifty
 * zeroes. What is drawn on every held row is the mark, because which rows are
 * held is the fact this page exists to set.
 */
function Paper({
  epic,
  outline,
  paperKnown,
  here,
  isHeld,
  done,
  onToggle,
  busy,
}: {
  epic: string
  outline: Outline | null
  paperKnown: boolean
  /** The file the reader is standing in, whose headings start unfolded. */
  here: string | null
  isHeld: (target: Target) => boolean
  done: (target: Target) => number | null
  onToggle: (target: Target) => void
  busy: boolean
}) {
  const [shut, setShut] = useState<Record<string, boolean>>({})
  const paper = (section: string | null): Target => ({ kind: 'paper', epic, section })

  const row = (target: Target, words: string, attrs: Record<string, string>, indent = 0, muted = false) => {
    const on = isHeld(target)
    const count = done(target)
    return (
      <button
        type="button"
        disabled={busy}
        {...attrs}
        data-held={on ? 'yes' : 'no'}
        title={on ? `Release ${words}` : `Hold this list against ${words}`}
        style={indent ? { paddingLeft: `${0.375 + indent * 0.5}rem` } : undefined}
        onClick={() => onToggle(target)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left text-[0.75rem] leading-4 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
          on ? 'font-semibold text-foreground' : muted ? 'text-muted-foreground' : undefined,
        )}
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-[0.7rem]">
          {on ? '✓' : ''}
        </span>
        {/* Never truncated: the words at the top of a section are how somebody
            tells one from another. */}
        <span className="min-w-0 flex-1 break-words">{words}</span>
        {count === null ? null : <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">{count}</span>}
        <span className="sr-only">{on ? 'held' : 'not held'}</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col" data-paper={outline ? outline.files.length : paperKnown ? 'none' : 'unknown'}>
      <span className="text-[0.65rem] leading-4 text-muted-foreground">In this paper</span>
      <ul className="rounded border">
        <li>{row(paper(null), 'the whole paper', { 'data-pick-paper': epic })}</li>
        {outline?.files.map((file) => {
          /* Open by default for the file the reader is in, shut for the rest,
             and the state records DEPARTURES from that rather than the truth —
             so walking into another chapter re-opens the right one without
             this component having to notice that it moved. */
          const open = shut[file.id] === undefined ? file.file === here : !shut[file.id]
          return (
            <li key={file.id} className="border-t">
              <div className="flex items-center gap-1">
                {row(paper(file.id), file.name, { 'data-pick-file': file.id, title: file.file })}
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
                  {file.sections.map((section) => (
                    <li key={section.id} className="flex">
                      {/* Indented by depth, capped at three steps: a
                          `\subparagraph` is seven levels down and seven indents
                          is half the column gone to whitespace. */}
                      {row(
                        paper(section.id),
                        section.title,
                        { 'data-pick-section': section.id },
                        Math.min(Math.max(section.level - 1, 0), 3),
                        true,
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
      {outline ? (
        outline.capped ? (
          <span className="text-[0.65rem] leading-4 text-muted-foreground">
            Only part of this paper was read. Anything missing can still be typed below.
          </span>
        ) : null
      ) : (
        <span className="text-[0.65rem] leading-4 text-muted-foreground">
          {paperKnown
            ? 'No files of this paper could be read from here.'
            : 'Open the paper in the paper module to pick its files and headings here.'}
        </span>
      )}
    </div>
  )
}

/**
 * How ticks are keyed, said once, on the page where somebody is setting a list up.
 *
 * "Ticks belong to this list and one target together" is not a fact about the
 * moment — it is true of every target this list is held against, cannot change
 * while somebody looks at it, and is read ONCE, by whoever is deciding whether
 * one list or two is the right shape for the work. On the reading page it was a
 * paragraph of documentation standing on the items; here it sits beside the
 * targets it is about. Dropped in a container too narrow for prose, because it
 * is not the only thing explaining an inert screen.
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
 * The host frames this module with `allow-scripts allow-forms allow-popups
 * allow-same-origin` and no `allow-modals`. `confirm` returns `false` inside
 * that sandbox, the handler returns early, and the button does nothing at all
 * with nothing on screen saying why. So the second press is asked for IN the
 * row, where it can be seen, can be abandoned by not pressing again, and says
 * the same sentence the dialog used to. This is the one irreversible act here:
 * it takes every tick anybody ever made on this list, against every target.
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
          it back. To stop seeing it somewhere, release that target above instead.
        </p>
      ) : null}
    </>
  )
}

/**
 * One item on the edit page: its words, and the three things that can be done to
 * them.
 *
 * ## The text is the reword control, so rewording costs no button
 *
 * Pressing the line turns it into a box holding exactly what was there. Escape
 * abandons it and leaves the line as it was, Enter files it, and shift-Enter is
 * a newline — the same pair as every other box in this module. A reword to the
 * same words, or to nothing at all, is dropped rather than sent: an empty item
 * is a row nobody can read and the store would refuse it anyway.
 *
 * ## `room.controls` decides where the arrows sit, and never whether
 *
 * `beside` above 360 pixels, `under` below it — the measurement in
 * `src/view/room.ts`. Nothing here is ever behind a press: this is the page
 * whose job they are.
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
      {/* Two presses, for the reason set out above `Forget`. */}
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

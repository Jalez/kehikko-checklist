import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Edit, Held, Here, ItemInFront } from '@/store/ask.ts'
import { labelOf, placeAmong, under } from '../../list/scope.ts'
import { targetKey, targetName, targetNoun, type Target } from '../../list/targets.ts'
import { evidenceOf } from '../../list/evidence.ts'
import { countRows, stateOf, type TickState } from '../../list/shapes.ts'
import { clickedLine, nameOf, unpickLine } from '../../list/aim.ts'
import {
  angleLine,
  ANGLE_LABELS,
  NOTHING_PICKED,
  nothingLine,
  ruleName,
  typeName,
  typesName,
  undecidedLine,
  type Angle,
  type ItemType,
  type Role,
  type UndecidedRef,
} from '../../list/standing.ts'
import type { TrackerRow } from 'kehikot-module-protocol'

import { Button } from '@/components/ui/button.tsx'
import { FactLine, RefFacts, type Facts } from '@/view/facts.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The reading page: the checklists for the item somebody picked, from the
 * angle they want — and never a list of items to pick from.
 *
 * ## The sentence this page is
 *
 * > "The idea in the Checklist module is that you can create checklists
 * > specific to a type (issue, paper, MR, PR, task) + role (assignee,
 * > reviewer, etc.) combination across the project, while also being able to
 * > add instance-specific checklist items on top. I don't want to see a list of
 * > specific items to pick their checklist; it should always show the
 * > checklist(s) for an item we have picked, from the angle we want."
 *
 * So the page draws one SECTION per item picked on the canvas — the refs
 * somebody selected (or what the containers they picked out show), and the
 * paper when a reader is in it — and nothing for an item nobody picked. A
 * section says the angle in its first line ("As reviewer on !123"), then every
 * checklist that applies to the item from that angle (`list/standing.ts`),
 * every list held against it by hand, and last its own lines, "Only for !123".
 *
 * Each list is an instance — one checklist against one item, `inFront` in
 * `list/checklists.ts` decides which — with its name, its count, one short
 * line saying why it is here (which types × roles, or held by hand), and its
 * items, tickable. Nothing here changes what a list applies to: the one press
 * per instance leads to the edit page, which is where that lives. The item's
 * own lines are the exception, and are edited where they are, because they
 * belong to the item and to nothing else.
 *
 * ## The empty sentences
 *
 * - **Nothing picked**: one sentence, `NOTHING_PICKED`, and the way to manage
 *   the checklists in the strip below. No list of items, ever.
 * - **Nothing applies** to an item: said in its section, from its angle, with
 *   the two things to do about it — a checklist for that type and role, or a
 *   line just for that item.
 * - **The picks emptied it**: `why`, which names the picked-out containers.
 * - **The parts focus put it aside**: the protocol's sentence, in the section.
 *
 * ## Several roles, other angles
 *
 * Read automatically, an item is read from every role the person has on it,
 * and each list says through which role it is there. Lists that would apply
 * from a role outside the angle are not drawn; the section says which angles
 * have them and switches to one in a press.
 *
 * ## Zero, one, several
 *
 * Several lists are stacked, each foldable so a reader in a 300-pixel frame can
 * put one away while ticking another. The fold is session state and is
 * written down nowhere. Which of several start open is where the reader IS:
 * the lists on the rungs under their own place in the paper, and every list of
 * a picked ref; the rest of the paper's start folded, one line each with its
 * count.
 */
export function HereView({
  here,
  items = [],
  focusAside = [],
  why = null,
  aside = null,
  onEdit,
  onOpen,
  onAll,
  trouble,
  busy,
  room,
  facts = null,
  kehikko = null,
  clicked = null,
  onShowClicked,
  onAngle,
  onNewFor,
  onAddFor,
}: {
  /** What the server said is in front of the reader, or null before it has said anything. */
  here: Here | null
  /** The items picked, a section each, in order: each ref, then the paper. */
  items?: ItemInFront[]
  /** The items (`ref:…`, `paper:…`) whose every list the parts focus put aside. */
  focusAside?: string[]
  /** Why the page is empty when the picks emptied it, or null when they did not. See `whyEmpty` in `list/aim.ts`. */
  why?: string | null
  /** What is said about lists put aside while others are drawn, or null: a hint on "Manage checklists", never a row. See `whyAside` in `list/aim.ts`. */
  aside?: string | null
  onEdit: (edit: Edit) => void
  /** Open one checklist's edit page. */
  onOpen: (id: string) => void
  /** Go to the screen that manages every checklist in the project. */
  onAll: () => void
  trouble: string | null
  busy: boolean
  room: Room
  /** What the host's tracker reading says about the refs in front, or null when there is none. See `facts.tsx`. */
  facts?: Facts | null
  /** The kehikko this page is on, whose name a list held against a container on it is labelled with. */
  kehikko?: { key?: string; name: string } | null
  /**
   * Refs somebody clicked that the picks set aside, and the picked-out
   * containers — `setAside` in `list/aim.ts` (Jalez/kehikko-checklist#32).
   */
  clicked?: { refs: string[]; picked: string[] } | null
  /** Show the clicked refs instead: this container's aim on everything. Resolves false when the host would not. */
  onShowClicked?: () => Promise<boolean>
  /** Read from another angle: what a section's "other angles" press does. */
  onAngle?: (angle: Angle) => void
  /** Make a checklist for this type of item and this role, and open it. */
  onNewFor?: (type: ItemType, role: Role) => void
  /** Add a line for one item alone. */
  onAddFor?: (target: Target, text: string) => void
}) {
  /* Which instances a person folded or unfolded, keyed by list and target, so
     the same list against two targets folds separately. Only what was pressed
     is kept: anything else is open or folded by where the reader is — see
     "Several" above — so a new instance arriving after a scroll needs nothing
     from this. */
  const [turned, setTurned] = useState<Record<string, boolean>>({})
  /* Whether the host refused to move the aim, so the line says where to move it by hand. Reset by a new click. */
  const [refused, setRefused] = useState(false)
  const clickedKey = clicked ? clicked.refs.join(' ') : ''
  useEffect(() => setRefused(false), [clickedKey])

  /*
   * Which instance was at the scroller's top edge, and how far below the edge it sat, kept
   * across a change in WHICH instances are drawn. WebKit does no scroll anchoring of its own, so a
   * list arriving above the reader's place moved what was in view, and a part picked or released
   * (the whole set changing) left the old offset in a different list, at a place nobody had been.
   * When the instance the reader was on is still drawn it is put back where it was; when the set
   * is another set altogether the reader starts at its top. Nothing is done while the same
   * instances are drawn, so a tick, a fold or a context repeating itself moves nothing.
   * `dev/scroll.probe.mjs` reads it (`PART`).
   */
  /* An item whose every list the parts focus put aside is not drawn: the host's bar shows the pick, and the
     page says nothing about it while there is a list to draw — and the protocol's one sentence (`why`) when
     there is none. */
  const sections = groups(here?.instances ?? [], items).filter((one) => one.instances.length > 0 || !focusAside.includes(one.key))
  const shownInOrder = sections.flatMap((section) => section.instances)
  const scroller = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ key: string; offset: number } | null>(null)
  const drawn = useRef<string | null>(null)
  const keys = shownInOrder.map((held) => `${held.checklist.id}|${targetKey(held.target as Target)}`)
  const marked = keys.join('\n')
  const pinned = room.pinned
  const mark = () => {
    const root = scroller.current
    if (!root) return null
    const top = pinned ? root.getBoundingClientRect().top : 0
    const places = [...root.querySelectorAll('[data-instance]')]
    for (let at = 0; at < places.length; at += 1) {
      const box = places[at]!.getBoundingClientRect()
      if (box.bottom > top + 0.5) return { key: keys[at] ?? '', offset: box.top - top }
    }
    return null
  }
  /* Flowing, the document is the scroller and the element's own scroll event never fires. */
  const latest = useRef(mark)
  latest.current = mark
  useEffect(() => {
    const note = () => {
      anchor.current = latest.current()
    }
    window.addEventListener('scroll', note, { passive: true })
    return () => window.removeEventListener('scroll', note)
  }, [])
  useLayoutEffect(() => {
    const root = scroller.current
    const was = anchor.current
    if (root && was && drawn.current !== null && drawn.current !== marked) {
      const at = keys.indexOf(was.key)
      const place = at >= 0 ? root.querySelectorAll('[data-instance]')[at] : undefined
      if (place) {
        const top = pinned ? root.getBoundingClientRect().top : 0
        const delta = place.getBoundingClientRect().top - top - was.offset
        if (Math.abs(delta) >= 1) {
          if (pinned) root.scrollTop += delta
          else window.scrollBy(0, delta)
        }
      } else if (pinned) {
        root.scrollTop = 0
      }
    }
    drawn.current = marked
    anchor.current = mark()
  })

  /* Not read yet. `App` draws the shared cover for that — waiting for a host, loading, or this
     app's own server not answering — so there is nothing of this screen's to draw. */
  if (!here) return null

  const several = shownInOrder.length > 1
  /* Nothing picked, or the picks emptied the pane: one sentence, and no list of anything to pick. */
  const emptySaid = sections.length ? null : (why ?? NOTHING_PICKED)
  const emptyKind = why ? 'narrowed' : 'picked'

  return (
    <section
      /* `relative overflow-hidden`, and no card, for the reasons given at
         length in `edit.tsx`: an `sr-only` label escapes a scroller that is
         not its containing block, and the host already draws the container. */
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-here={shownInOrder.length}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      {/* A click the picks set aside, said where the click was expected to land
          (Jalez/kehikko-checklist#32): whether or not the picked containers have
          lists, and above them, because it is about what is NOT drawn. */}
      {clicked ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5 text-[0.7rem] leading-4" data-clicked={clicked.refs.join(' ')}>
          <span className="min-w-0 basis-full text-muted-foreground">{clickedLine(clicked)}</span>
          {onShowClicked ? (
            <Button
              type="button"
              variant="outline"
              size="container"
              data-show-clicked
              title="Show everything on this kehikko, whatever is picked out: this container's aim filter."
              onClick={() => {
                void onShowClicked().then((ok) => setRefused(!ok))
              }}
            >
              {`Show ${clicked.refs.length === 1 ? clicked.refs[0] : 'them'} instead`}
            </Button>
          ) : null}
          <span className="min-w-0 basis-full text-muted-foreground" data-unpick>
            {unpickLine(clicked.picked)}
          </span>
          {refused ? (
            <span className="min-w-0 basis-full text-muted-foreground" data-aim-refused>
              The host did not move it: choose “everything on this kehikko” under aim in this container’s header.
            </span>
          ) : null}
        </div>
      ) : null}

      {sections.length ? (
        <div
          /* `before:` is a snap area of no height at the very start, so the
             top of the scroller is a place it can rest. With only the rows
             snapping, the first snap position was the first ROW, 48 pixels
             down, and WebKit would not rest above it: the first list's name,
             label and Edit press could not be scrolled back to (issue #16;
             `dev/scroll.probe.mjs` reads it). It is the scroller's own and not
             the first header's, so a list arriving above the first one — a
             part picked — is drawn at the top instead of being scrolled past. */
          className={cn(
            room.pinned && 'min-h-0 flex-1 overflow-y-auto',
            room.snap && "snap-y snap-proximity before:block before:h-0 before:snap-start before:content-['']",
          )}
          data-scroller={room.pinned ? 'instances' : undefined}
          ref={scroller}
          onScroll={() => {
            anchor.current = mark()
          }}
        >
          {sections.map((section) => (
            <ItemSection
              key={section.key}
              section={section}
              undecided={(here.undecided ?? []).filter((row) => section.item?.target.kind === 'ref' && row.ref === section.item.target.ref)}
              onAngle={onAngle}
              onNewFor={onNewFor}
              onAddFor={onAddFor}
              busy={busy}
              snap={room.snap}
            >
              {section.instances.map((held) => {
                const target = held.target as Target
                const key = `${held.checklist.id}|${targetKey(target)}`
                const open = !several || (turned[key] ?? (target.kind === 'ref' || under(target, here.placed)))
                return (
                  <Instance
                    key={key}
                    held={held}
                    target={target}
                    label={labelFor(held, target, here, kehikko)}
                    open={open}
                    foldable={several}
                    onFold={() => setTurned((was) => ({ ...was, [key]: !open }))}
                    onEdit={onEdit}
                    onOpen={onOpen}
                    busy={busy}
                    room={room}
                    facts={facts}
                  />
                )
              })}
            </ItemSection>
          ))}
        </div>
      ) : emptySaid ? (
        <p
          className={cn('px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground', room.pinned && 'min-h-0 flex-1')}
          data-none={emptyKind}
        >
          {emptySaid}
        </p>
      ) : null}

      {trouble ? (
        <p className="shrink-0 border-t px-2 py-1.5 text-[0.7rem] leading-4 text-failed">{trouble}</p>
      ) : null}

      <div className="flex shrink-0 items-center gap-1.5 border-t bg-muted/40 px-2 py-1.5">
        {/* Lists put aside for another module's work get no line of their own: a row about what is
            not drawn costs the room the drawn lists need. What says it is the hint on the control
            that leads to every list, which is there anyway and is where the remedy is. */}
        <Button
          type="button"
          variant="ghost"
          size="container"
          data-all
          data-aside={aside && shownInOrder.length ? '' : undefined}
          title={aside && shownInOrder.length ? aside : undefined}
          onClick={onAll}
        >
          Manage checklists
        </Button>
      </div>
    </section>
  )
}

/** One section of the page: an item and the instances in front for it, or a group with no item (a container's lists). */
interface Section {
  key: string
  /** The item picked, or null for a group no item names: lists held against a container on this kehikko. */
  item: ItemInFront | null
  /** Its lists, the item's own lines last. */
  instances: Held[]
  /** The item's own lines, when it has any: "Only for !123". */
  own: Held | null
}

/** The key an instance's target is grouped under: its item, or its container group. */
function itemKey(target: Target | null): string {
  if (!target) return 'other'
  if (target.kind === 'ref') return `ref:${target.ref}`
  if (target.kind === 'paper') return `paper:${target.epic}`
  if (target.kind === 'kehikko') return 'kehikko'
  return 'other'
}

/**
 * The instances in sections, one per item in the order the items came, then
 * any group no item names — a container's lists — at the end. An instance of
 * an item's own lines goes last in its section.
 */
export function groups(instances: readonly Held[], items: readonly ItemInFront[]): Section[] {
  const byKey = new Map<string, Held[]>()
  for (const one of instances) {
    const key = itemKey(one.target)
    byKey.set(key, [...(byKey.get(key) ?? []), one])
  }
  const sections: Section[] = []
  const done = new Set<string>()
  const make = (key: string, item: ItemInFront | null): Section => {
    const all = byKey.get(key) ?? []
    const own = all.find((one) => one.checklist.only) ?? null
    return { key, item, instances: [...all.filter((one) => !one.checklist.only), ...(own ? [own] : [])], own }
  }
  for (const item of items) {
    const key = itemKey(item.target)
    if (done.has(key)) continue
    done.add(key)
    sections.push(make(key, item))
  }
  /* Lists for an item the server did not name — an older server — are that item's all the same, read from any role. */
  for (const [key, all] of byKey) {
    if (done.has(key)) continue
    done.add(key)
    const target = all[0]?.target ?? null
    const item: ItemInFront | null =
      target?.kind === 'ref'
        ? { target, type: null, as: ['any'], elsewhere: [] }
        : target?.kind === 'paper'
          ? { target: { kind: 'paper', epic: target.epic, section: null }, type: 'paper', as: ['any'], elsewhere: [] }
          : null
    sections.push(make(key, item))
  }
  return sections
}

/** What an instance says it is: which types × roles it applies by, held by hand, or a place in the paper. */
function labelFor(held: Held, target: Target, here: Here, kehikko: { key?: string; name: string } | null): string {
  const whose = held.checklist.for ? ` · for ${nameOf(held.checklist.for)}` : ''
  if (held.checklist.only) return `lines just for ${targetName(target)}`
  if (held.through?.length) {
    return held.through.map((rule) => (rule.kind === 'rule' ? ruleName(rule) : targetName(rule))).join('; ') + whose
  }
  if (target.kind === 'ref') return `held for ${target.ref}${whose}`
  return labelOf(target, placeAmong(target, here.positions) ?? here.placed, null, kehikko) + whose
}

/** What an item is called in its section's first line. */
function itemName(item: ItemInFront): string {
  if (item.target.kind === 'ref') return item.target.ref
  if (item.target.kind === 'paper') return `the paper ${item.target.epic}`
  return targetName(item.target)
}

/**
 * One item's section: the angle it is read from, its lists, its own lines,
 * and — when nothing applies — what to do about it.
 */
function ItemSection({
  section,
  undecided,
  onAngle,
  onNewFor,
  onAddFor,
  busy,
  snap,
  children,
}: {
  section: Section
  snap: boolean
  undecided: UndecidedRef[]
  onAngle?: (angle: Angle) => void
  onNewFor?: (type: ItemType, role: Role) => void
  onAddFor?: (target: Target, text: string) => void
  busy: boolean
  children: React.ReactNode
}) {
  const item = section.item
  const [adding, setAdding] = useState(false)
  const [typing, setTyping] = useState('')
  if (!item) {
    /* A group no item names: lists held against a container on this kehikko. */
    return (
      <section className="border-t first:border-t-0" data-section={section.key}>
        <p className={cn('px-2 pt-1.5 text-[0.65rem] font-semibold leading-4 text-muted-foreground', snap && 'snap-start')} data-angle>
          {section.key === 'kehikko' ? 'On this kehikko' : 'Also in front'}
        </p>
        {children}
      </section>
    )
  }
  const name = itemName(item)
  const empty = section.instances.length === 0
  const unsure = undecidedLine(undecided)
  const add = () => {
    const text = typing.trim()
    if (!text || !onAddFor) return
    setTyping('')
    setAdding(false)
    onAddFor(item.target, text)
  }
  const roles: Role[] = item.as.length ? item.as : ['any']
  return (
    <section className="border-t first:border-t-0" data-section={section.key}>
      {/* The angle, said once per item: "As reviewer on !123". */}
      <p
        className={cn('flex flex-wrap items-baseline gap-x-1.5 px-2 pt-1.5 text-[0.7rem] font-semibold leading-4', snap && 'snap-start')}
        data-angle={roles.join(' ')}
      >
        <span className="min-w-0 break-words">{angleLine(roles, name)}</span>
        {item.type && item.target.kind === 'ref' ? (
          <span className="text-[0.65rem] font-normal text-muted-foreground" data-type={item.type}>
            {typeName(item.type)}
          </span>
        ) : null}
      </p>

      {children}

      {empty ? (
        <p className="px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground" data-none="applies">
          {unsure ? null : nothingLine(name, roles)}
        </p>
      ) : null}
      {unsure ? (
        <p className="px-2 pb-1.5 text-[0.7rem] leading-4 text-muted-foreground" data-undecided>
          {unsure}
        </p>
      ) : null}

      {/* What to do when nothing applies: a checklist for this type and role, or a line just for this item. */}
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
        {empty && item.type && onNewFor
          ? roles.map((role) => (
              <Button
                key={role}
                type="button"
                variant="outline"
                size="container"
                disabled={busy}
                data-new-for={`${item.type}:${role}`}
                className="max-w-full"
                title="Start a checklist that is in front of every such item read from this role, and write its first line."
                onClick={() => onNewFor(item.type as ItemType, role)}
              >
                <span className="min-w-0 truncate">
                  {`Add a checklist for ${typesName([item.type as ItemType])} ${role === 'any' ? 'for any role' : `as ${role}`}`}
                </span>
              </Button>
            ))
          : null}
        {onAddFor && !section.own && !adding ? (
          <Button
            type="button"
            variant={empty ? 'outline' : 'ghost'}
            size="container"
            disabled={busy}
            data-add-for={section.key}
            className="max-w-full"
            title="A line this one item owes, on top of the checklists that apply to it. It is kept whatever happens to them."
            onClick={() => setAdding(true)}
          >
            <span className="min-w-0 truncate">{`Add an item just for ${item.target.kind === 'ref' ? item.target.ref : 'this paper'}`}</span>
          </Button>
        ) : null}
      </div>
      {adding ? (
        <AddLine
          label={`A line just for ${name}`}
          value={typing}
          onChange={setTyping}
          onAdd={add}
          onCancel={() => {
            setTyping('')
            setAdding(false)
          }}
          busy={busy}
        />
      ) : null}

      {/* Other angles that have lists for this item: one press reads from that angle. */}
      {item.elsewhere.length && onAngle ? (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 text-[0.65rem] leading-4 text-muted-foreground" data-elsewhere={item.elsewhere.join(' ')}>
          <span>Also checklists for {name} from</span>
          {item.elsewhere.map((role) => (
            <Button
              key={role}
              type="button"
              variant="ghost"
              size="container"
              data-angle-to={role}
              title={`Read every picked item ${ANGLE_LABELS[role].toLowerCase()}. The header's Angle says which angle is on.`}
              onClick={() => onAngle(role)}
            >
              {ANGLE_LABELS[role]}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** A box for one line, with Add and Cancel: the same Enter / shift-Enter pair every box here uses. */
function AddLine({
  label,
  value,
  onChange,
  onAdd,
  onCancel,
  busy,
}: {
  label: string
  value: string
  onChange: (text: string) => void
  onAdd: () => void
  onCancel?: () => void
  busy: boolean
}) {
  return (
    <div className="flex flex-col gap-1 px-2 pb-1.5" data-add-line>
      <textarea
        aria-label={label}
        autoFocus
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel) onCancel()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onAdd()
          }
        }}
        placeholder="What does this one still owe?"
        className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="container" disabled={busy || !value.trim()} onClick={onAdd}>
          Add
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="container" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
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
  const counts = countRows(held.rows)
  /* An item's own lines are edited where they are: they belong to that item and to no list somebody named. */
  const own = Boolean(held.checklist.only)
  const [editing, setEditing] = useState(false)
  return (
    <section
      className="border-t first:border-t-0"
      data-instance={held.checklist.id}
      data-target={targetKey(target)}
      data-open={open ? 'yes' : 'no'}
    >
      {/* A snap area like the rows under it, so every list has a place the
          scroller can rest with its name at the top edge — not only its rows. */}
      <div className={cn('flex items-start gap-1.5 px-2 py-1.5', room.snap && 'snap-start')}>
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
        <span className="shrink-0 text-right text-[0.7rem] tabular-nums">
          <span
            className={cn(
              held.total > 0 && counts.passed + counts.na === held.total && counts.failed === 0
                ? 'text-done'
                : 'text-muted-foreground',
            )}
            data-count
          >
            {counts.passed}/{held.total}
          </span>
          {/* Failed and not applicable are said in words beside the count and
              never folded into it: "3/4" with a failure in the fourth must not
              read as nearly done. */}
          {counts.failed || counts.na ? (
            <span className={cn('block', counts.failed ? 'text-failed' : 'text-muted-foreground')} data-count-more>
              {[counts.failed ? `${counts.failed} failed` : '', counts.na ? `${counts.na} n/a` : ''].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="shrink-0 px-1.5"
          data-edit={held.checklist.id}
          data-own={own ? (editing ? 'editing' : 'reading') : undefined}
          title={
            own
              ? editing
                ? 'Done: back to ticking these lines.'
                : 'Edit the lines just for this item: reword, drop, add. Their ticks are kept.'
              : 'Edit: the lines, and which types of item and roles this list applies to. Nothing there is ticked.'
          }
          onClick={() => (own ? setEditing(!editing) : onOpen(held.checklist.id))}
        >
          {room.pageSwitch === 'named' ? (
            own && editing ? 'Done' : 'Edit'
          ) : (
            <>
              <span aria-hidden="true">{own && editing ? '✓' : '✎'}</span>
              <span className="sr-only">{own && editing ? 'Done' : 'Edit'}</span>
            </>
          )}
        </Button>
      </div>

      {/* What the tracker says about the ref, beside the list and under its
          name — only open, so a folded instance is one line again. */}
      {open && ref ? <RefFacts refName={ref} facts={facts} /> : null}

      {open && own && editing ? (
        <OwnLines held={held} onEdit={onEdit} busy={busy} />
      ) : open ? (
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
 * An item's own lines, being edited: each line rewordable in place and
 * droppable with two presses, and a box for one more. The same writes the
 * edit page makes for a list, on the list that holds this item's own lines;
 * a reword keeps the line's ticks, and dropping the last line takes the list.
 */
function OwnLines({ held, onEdit, busy }: { held: Held; onEdit: (edit: Edit) => void; busy: boolean }) {
  const [typing, setTyping] = useState('')
  const list = held.checklist.id
  const add = () => {
    const text = typing.trim()
    if (!text) return
    setTyping('')
    onEdit({ op: 'add', id: list, text })
  }
  return (
    <div className="border-t" data-own-lines={list}>
      <ul>
        {held.rows.map((row) => (
          <OwnLine key={row.item.id} list={list} item={row.item} onEdit={onEdit} busy={busy} />
        ))}
      </ul>
      <div className="border-t pt-1.5">
        <AddLine label="Add a line just for this item" value={typing} onChange={setTyping} onAdd={add} busy={busy} />
      </div>
    </div>
  )
}

/** One of an item's own lines, being edited: press the words to reword them, × twice to drop it. */
function OwnLine({
  list,
  item,
  onEdit,
  busy,
}: {
  list: string
  item: Held['rows'][number]['item']
  onEdit: (edit: Edit) => void
  busy: boolean
}) {
  const [typing, setTyping] = useState<string | null>(null)
  const [arming, setArming] = useState(false)
  const reword = () => {
    const text = (typing ?? '').trim()
    setTyping(null)
    if (!text || text === item.text) return
    onEdit({ op: 'reword', id: list, item: item.id, text })
  }
  return (
    <li className="flex items-start gap-1.5 border-t px-2 py-1.5 first:border-t-0" data-own-line={item.id}>
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
          rows={2}
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
      <Button
        type="button"
        variant="ghost"
        size="container"
        className="shrink-0 px-1"
        disabled={busy}
        data-drop={item.id}
        title={arming ? 'Press again to drop this line and its ticks' : 'Drop this line'}
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
        <span className="sr-only">{arming ? 'Press again to drop' : 'Drop'}</span>
      </Button>
    </li>
  )
}

/** The shape of each state, so it is never told by colour alone. */
const MARKS: Record<TickState | 'unchecked', string> = { passed: '✓', failed: '✗', na: '–', unchecked: '' }

/** The words of each state: `short` is drawn, `long` is what a screen reader hears. */
const WORDS: Record<TickState | 'unchecked', { short: string; long: string }> = {
  passed: { short: 'Passed', long: 'passed' },
  failed: { short: 'Failed', long: 'failed' },
  na: { short: 'N/A', long: 'not applicable' },
  unchecked: { short: '', long: 'not checked' },
}

const MARK_STYLE: Record<TickState | 'unchecked', string> = {
  passed: 'border-done/40 text-done',
  failed: 'border-failed/50 text-failed',
  na: 'border-unknown/50 text-muted-foreground',
  unchecked: 'border-todo/50 text-todo',
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
  const state = stateOf(done)
  const evidence = !done && item.fact && read?.row ? evidenceOf(read.row, item.fact) : null
  const send = (next: { done: boolean; state?: TickState }) =>
    onEdit({ op: 'tick', id: list, item: item.id, target, ...next, ...(next.done && evidence ? { evidence } : {}) })
  /* One press on a state already set takes it back; on any other, sets it. */
  const set = (which: 'failed' | 'na') => send(state === which ? { done: false } : { done: true, state: which })

  return (
    <li
      data-item={item.id}
      data-done={done ? 'yes' : 'no'}
      data-state={state}
      className={cn('border-t px-2 py-1.5 first:border-t-0', room.snap && 'snap-start')}
    >
      <button
        type="button"
        disabled={busy}
        aria-pressed={state === 'passed'}
        title={
          state === 'passed'
            ? 'Passed for this target. Press to take it back.'
            : 'Press when this is actually done here.'
        }
        onClick={() => send({ done: state !== 'passed' })}
        className="flex w-full min-w-0 items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {/* The shape says the state without colour: a tick, a cross, a dash, an
            empty box. The word beside the line says it again. */}
        <span
          aria-hidden="true"
          data-mark
          className={cn(
            'mt-px inline-flex size-4 shrink-0 items-center justify-center rounded border text-[0.7rem] leading-none font-bold',
            MARK_STYLE[state],
          )}
        >
          {MARKS[state]}
        </span>
        {/* `min-w-0` and `break-words` together are what keep a 400-character
            item, or an unbroken URL somebody pasted, inside a 220px container.
            Never a Badge and never `truncate`: the text IS the item. */}
        <span
          className={cn(
            'min-w-0 flex-1 break-words text-left text-[0.8rem] leading-5',
            state === 'passed' && 'text-muted-foreground line-through decoration-1',
            state === 'na' && 'text-muted-foreground',
          )}
        >
          {item.text}
        </span>
        <span className="sr-only">{WORDS[state].long}</span>
      </button>

      {/* Set a different answer: failed, or not applicable. Small, always
          there, and each says its own name. Pressing the one that is on takes
          it back. */}
      <div className="mt-1 flex flex-wrap items-center gap-1 pl-[1.375rem]">
        {(['failed', 'na'] as const).map((which) => (
          <button
            key={which}
            type="button"
            disabled={busy}
            data-set={which}
            aria-pressed={state === which}
            title={state === which ? `Marked ${WORDS[which].short}. Press to take it back.` : `Mark this ${WORDS[which].short} for this target.`}
            onClick={() => set(which)}
            className={cn(
              'rounded border px-1 text-[0.65rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
              state === which ? 'border-foreground/60 bg-accent font-semibold' : 'border-border text-muted-foreground',
            )}
          >
            <span aria-hidden="true">{MARKS[which]} </span>
            {WORDS[which].short}
          </button>
        ))}
        {state !== 'unchecked' ? (
          <span className="text-[0.65rem] leading-4 text-muted-foreground" data-state-word>
            {WORDS[state].short}
          </span>
        ) : null}
      </div>

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

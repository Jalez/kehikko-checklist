import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { serverStanding } from 'kehikot-module-protocol/client'
import { Cover, coverFor, useFocus, useServerStanding, type CoverState } from 'kehikot-module-protocol/client/react'

import { ID } from '../manifest.ts'

import { aimOf, aimOffer, forPicked, inFrontOf, moduleLabels, setAside, whyAside, whyEmpty } from '../list/aim.ts'
import { angleOf, rolesFromMine, typeOfRow, typesName, type Angle, type ItemType, type RefsRead, type Role } from '../list/standing.ts'
import { NOUN, anchorOf, readParts } from '../list/focus.ts'
import {
  edit,
  everyChecklist,
  openChecklist,
  paperOutline,
  pointing,
  shown,
  unanswered,
  whatIsHere,
  runsInFront,
  hideRun,
  type RunItem,
  type Edit,
  type Here,
  type ItemInFront,
  type Target,
  type Opened,
  type Outline,
  type Summary,
} from '@/store/ask.ts'
import type { TrackerReading } from 'kehikot-module-protocol'
import { marksOf, useKehikot, type GotoHandler, type PressHandler } from '@/wire/use-kehikot.ts'
import { ANGLE_FILTER, angleOffer, headerFor, pressed } from '@/wire/header.ts'
import { StorageView } from '@/view/storage.tsx'
import { factsOf } from '@/view/facts.tsx'
import { OpenAddressContext } from '@/view/out-link.tsx'
import { AllView } from '@/view/all.tsx'
import { EditView } from '@/view/edit.tsx'
import { HereView } from '@/view/here.tsx'
import { Importing } from '@/view/importing.tsx'
import { Button } from '@/components/ui/button.tsx'
import { wantedHeight } from '@/view/room.ts'
import { useRoom } from '@/view/use-room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The page.
 *
 * ## What it shows, and the sentence that decides it
 *
 * > "Its all about knowing what is selected or seen in the app that's important
 * > in the consumer/provider relationships."
 *
 * So the page opens on what is in front of the reader: every checklist held
 * against the section or file under their passage, against a reference the
 * canvas has selected, or against anything a container on the kehikko says it
 * is showing — several at once when several apply, none when none does. And
 * when the person has picked containers out, only what THOSE show; see
 * `list/aim.ts` for the rule and the second sentence it implements. That is
 * `HereView`, and it is the default because it is the sentence.
 * From it, one press leads to a list's edit page (`EditView`), where what the
 * list says and what it is held against are changed, and one press leads to
 * every checklist in the project (`AllView`), where a list that is held
 * against nothing yet can still be found and started.
 *
 * Three screens, and which one is showing is `view` below: session state,
 * written down nowhere, opening on the reading page every time. A remembered
 * screen would be a container coming back tomorrow on the edit page of a list
 * somebody finished with.
 *
 * ## What used to be here, and why it is not
 *
 * This page used to open on a pick-or-create screen, remember the pick per
 * kehikko through the host's `state:keep`, show that ONE list, and decide on
 * every scroll which of that list's targets was in front — first by aiming it
 * at wherever the reader was, then by choosing among the targets it had ticks
 * on and calling anywhere else "not held here". The owner said, three times,
 * that a list's targets are ASSIGNED — in edit mode, to sections and files and
 * references, to stick — and that reading should show the lists assigned to
 * what is being read. Under that model a remembered pick answers a question
 * nobody asks: the reader's position and the lists' assignments between them
 * already say what is in front. So `list/keep.ts` is gone, `state:keep` is no
 * longer declared, and the kept string a host still holds is ignored.
 *
 * ## The filter offer, which was empty and is one group again
 *
 * This page used to offer the host a grain — `section` / `file` / `paper` —
 * over `kehikot.filters`, and there is an essay's worth of care in the history
 * about WHEN to send `[]`: an empty offer is a claim the host acts on by
 * pruning the container's stored choice, and sending it before the canvas had
 * spoken erased the reader's remembered grain on every reload. The grain went
 * with the model it served, and for a while the offer was `[]`, sent once,
 * so a host still holding a grain let it go.
 *
 * There is one group now, and it is not the grain come back. `aim` says
 * whether this container follows what is picked out on the kehikko or shows
 * everything on it whatever is picked — see `list/aim.ts` — and it is offered
 * ONLY when the host lists containers, because on a host that does not there
 * is nothing the control could turn off. The old care about timing does not
 * bite: the offer is a function of what the host said in the greeting, so it
 * is right from the first context, and it is re-sent whenever the count in
 * its label changes, which the protocol asks for. A host that never heard of
 * containers is sent `[]`, which is what it was sent before.
 *
 * ## A null projectPath stops the page, and a null kehikko does not
 *
 * `projectPath` decides where the checklists ARE — the store lives at
 * `<projectPath>/.kehikot/checklist/` (`lists.json` and `targets/`, see `list/book.ts`) — so without one there is
 * no file to read and nowhere to write, and the page says so and offers
 * nothing to press (the shared cover, below). `kehikko` decided where a pick
 * was remembered, and nothing is remembered any more, so a host with no
 * canvases gets the ordinary page.
 *
 * ## Switching project repaints, without a reload
 *
 * `projectPath` is a dependency of every fetch below. A host that moves a
 * person to another project sends one `kehikot.context`, this hook sets one
 * piece of state, and everything is re-read from the new project's folder.
 * The path IS the partition, so a different project is a different file
 * rather than a different subset of one.
 *
 * ## Identity is printed only when nothing is framing this page
 *
 * A host prints the module's name in the container header. Unframed there is
 * no header, so the heading stays; the test is `window.parent !== window`,
 * which is answerable before first paint and therefore does not blink.
 */
const framed = typeof window !== 'undefined' && window.parent !== window

/** Which of the three screens is showing, and for the edit page, which list and where Done leads. */
type View =
  | { kind: 'here' }
  | { kind: 'all' }
  | { kind: 'storage' }
  | { kind: 'edit'; id: string; back: 'here' | 'all' }

export function App() {
  const [lists, setLists] = useState<Summary[]>([])
  const [storeTrouble, setStoreTrouble] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>({ kind: 'here' })

  /** What is in front of the reader, as the server last said. Null before it has said. */
  const [here, setHere] = useState<Here | null>(null)
  /** The list on the edit page, on its own, with what it is held against. */
  const [opened, setOpened] = useState<Opened | null>(null)

  /**
   * A checklist that was being edited and is not here any more.
   *
   * Not a refusal of anything somebody pressed — the store moved underneath
   * an open edit page, which happens when a list is removed on another machine
   * or in another container. Held so the screen the reader lands on can say
   * what happened rather than opening as though nothing had.
   */
  const [gone, setGone] = useState<string | null>(null)

  /**
   * The project somebody picked to copy a checklist out of, and what is in it.
   *
   * Never a folder this page went looking for. Filled only by `pickProject`,
   * which asks the host to ask a person, and emptied by anything going wrong.
   * A module that could enumerate projects has been handed the disk.
   */
  const [from, setFrom] = useState<{ path: string; name: string } | null>(null)
  const [importable, setImportable] = useState<Summary[]>([])
  const [choosing, setChoosing] = useState(false)

  /**
   * Bumped whenever the store may have changed under this page: an edit made
   * here, or an agent coming through the MCP door, which the pump in `emit.ts`
   * is already polling for in order to announce it. Every fetch below depends
   * on it, so somebody watching this container while an agent ticks items off
   * sees the ticks land.
   */
  const [stamp, setStamp] = useState(0)
  const bump = useCallback(() => setStamp((was) => was + 1), [])

  const onGoto = useCallback<GotoHandler>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference. This container shows
       the checklists in front of the reader, so the honest answer to all three
       is that there is nothing here to be walked to — saying so quickly is what
       gets the reader the host's fallback link instead of a twelve-second
       wait. */
    answer(
      false,
      message.ref
        ? 'This container shows the checklists held against what is in front of you, so there is nothing here to walk to by reference.'
        : 'This container shows checklists, so there is nothing here to walk to by epic or step.',
    )
  }, [])

  /* What a press of the angle does, filled in below once the host's choice is known; a ref, so the press handler is made once. */
  const angleTo = useRef<(next: Angle) => void>(() => {})

  /* A press in the host's View menu: the same three screens the page's own buttons reach, or the angle. */
  const onPress = useCallback<PressHandler>((press) => {
    const wanted = pressed(press)
    if (typeof wanted === 'string') return wanted
    if ('angle' in wanted) angleTo.current(wanted.angle)
    else setView({ kind: wanted.view })
    return undefined
  }, [])

  const {
    where,
    epic,
    projectPath,
    project,
    kehikko,
    selection,
    passage,
    containers,
    chosen,
    resize,
    filters,
    pickProject,
    trackerAt,
    trackerReading,
    marks,
    parts,
    content,
    readTracker,
    readProject,
    readSummary,
    choose,
    header,
    openAddress,
  } = useKehikot(ID, onGoto, bump, onPress)

  /**
   * The angle the picked items are read from: the person's own roles on each
   * (`auto`), one role, or any role. Remembered per container as this
   * container's filter choice, which is the one thing a host keeps per
   * container; a press of the header's switch writes it there, and holds it
   * for the session when the host will not.
   */
  const choice = useMemo(() => (chosen ? (JSON.parse(chosen) as Record<string, string>) : {}), [chosen])
  const kept = angleOf(choice[ANGLE_FILTER])
  const [angleNow, setAngleNow] = useState<Angle | null>(null)
  useEffect(() => setAngleNow(null), [kept])
  const angle = angleNow ?? kept
  const onAngle = useCallback(
    (next: Angle) => {
      setAngleNow(next)
      void choose?.({ ...choice, [ANGLE_FILTER]: next })
    },
    [choose, choice],
  )
  angleTo.current = onAngle

  /**
   * Where the reader is pointing, inflated once from the string the wire holds.
   *
   * Memoised on that string, so a context that re-states the same passage —
   * which is every context, since one arrives after any change anywhere on the
   * canvas — hands back the same object and does not re-run the fetch below.
   */
  const at = useMemo(() => pointing(passage), [passage])

  /** The references the canvas has selected, as one string, for the same reason. */
  const selected = selection.join(' ')

  /**
   * The parts of the open epic, picked or not, inflated once from the string
   * the wire holds. Read here, ahead of what is in front, because a picked
   * part decides that too: see "Picked parts say it first" in `list/aim.ts`.
   */
  const epicParts = useMemo(() => readParts(parts), [parts])
  /* The protocol's rule over those parts: the one thing on this page that says what a pick shows. */
  const focus = useFocus({ parts: epicParts, epic, projectPath })
  const focusedNow = focus.focused

  /**
   * What is in front of the reader, once the picks are taken into account.
   *
   * Memoised on strings only — the passage's, the selection's, the host's list
   * of containers and the header's choice — and on whether a part is picked,
   * so that a context which re-states the same canvas hands back the same
   * object and the fetch below does not re-run. The rule is in `list/aim.ts`;
   * this is where its inputs meet.
   */
  const front = useMemo(
    () =>
      inFrontOf({
        passage: at,
        selection: selected ? selected.split(' ') : [],
        containers: shown(containers),
        aim: aimOf(chosen ? (JSON.parse(chosen) as Record<string, string>) : null),
        focused: focusedNow,
      }),
    [at, selected, containers, chosen, focusedNow],
  )
  /**
   * The places named to the server. None while the picked parts decide what
   * is in front (`front.documents` is empty then): `whole` is what is asked,
   * and the server answers with the file each list is held against.
   */
  const documents = front.documents
  /**
   * What a list held against a module's container on this kehikko is asked
   * by (Jalez/kehikko-checklist#27): this kehikko's key, the modules whose
   * containers are in front by the same rule as everything else — every one
   * while nothing is picked out, only the picked-out ones while the reader
   * follows them — and the open epic, whose run of the container the ticks
   * are for. Null on a host that sends no key.
   */
  const kehikkoKey = kehikko?.key ?? null
  const following = useMemo(
    () => (kehikkoKey ? { kehikko: kehikkoKey, modules: front.narrowed ? front.picked : front.modules, epic } : null),
    [kehikkoKey, front, epic],
  )
  /**
   * Every rule in the project — types × roles, of the project or of one epic
   * — off the list of every checklist. With none, nothing below asks anything.
   */
  const standingAll = useMemo(() => lists.flatMap((one) => one.applies ?? []), [lists])
  const standingEpics = useMemo(
    () => [...new Set(standingAll.flatMap((one) => (one.kind === 'rule' && one.epic ? [one.epic] : [])))].sort().join(' '),
    [standingAll],
  )
  /**
   * What the host's tracker reading says about the refs in front: each one's
   * type (its kind, and for a change its tracker: a GitLab merge request or a
   * GitHub pull request), the person's roles on it (`myRoles`), and which of
   * them each epic a rule names names. Asked whenever a ref is picked — the
   * angle line over its section says the person's role there, whatever list
   * it has — and again when the reading moves: a ref that came back `pending`
   * is decided then. The summary only, which is cheap at the tracker. Null
   * without a host: then a ref's own spelling is all there is, and the pane
   * says what is not known.
   */
  const refsInFront = front.refs.join(' ')
  const [refsRead, setRefsRead] = useState<RefsRead | null>(null)
  useEffect(() => {
    if (where !== 'hosted' || !refsInFront) {
      setRefsRead(null)
      return
    }
    let alive = true
    const refs = refsInFront.split(' ')
    const epics = standingEpics ? standingEpics.split(' ') : []
    void Promise.all([readSummary({ refs }), ...epics.map((one) => readSummary({ epic: one }))]).then(([mine, ...byEpic]) => {
      if (!alive) return
      const types: Record<string, ItemType> = Object.create(null)
      const roles: Record<string, Role[]> = Object.create(null)
      for (const row of mine?.rows ?? []) {
        if (!refs.includes(row.ref)) continue
        types[row.ref] = typeOfRow(row)
        const own = rolesFromMine(row.myRoles)
        if (own) roles[row.ref] = own
      }
      const named: Record<string, string[]> = Object.create(null)
      epics.forEach((one, at) => {
        const got = byEpic[at]
        /* An epic whose reading did not come back is left out, which is "not known" — never "names none". */
        if (!got) return
        const names = new Set([...got.rows.map((row) => row.ref), ...got.missing.map((row) => row.ref)])
        named[one] = refs.filter((ref) => names.has(ref))
      })
      setRefsRead({ types, roles, epics: named })
    })
    return () => {
      alive = false
    }
  }, [where, refsInFront, standingEpics, trackerAt, readSummary])
  const readKey = refsRead ? JSON.stringify(refsRead) : ''

  /**
   * Whether the paper is a picked item: a reader is in it, a container picked
   * out shows a place in it, or parts of it are picked. An epic open with no
   * page of its paper in front is not a paper picked — the pane does not list
   * what could be picked, it shows what was.
   */
  const paperPicked = Boolean(epic) && (documents.length > 0 || front.byParts)

  /** And the same, as one string, for the fetch to depend on. */
  const frontKey = JSON.stringify({ refs: front.refs, documents, whole: front.byParts, following, read: readKey, angle, paper: paperPicked })

  /**
   * Whether there is anywhere at all to read from or write to.
   *
   * Held from the server's answer rather than derived from `projectPath`
   * alone, because the server is the one that knows: a path may be present and
   * still name nothing this app will write under. It starts false and is only
   * DRAWN once the greeting has settled — see the guard on `screen` below — so
   * a page that has not been greeted yet does not announce "no project is
   * open" for one frame and then correct itself.
   */
  const [nowhere, setNowhere] = useState(false)
  /* The words of a write that could not be delivered — the server was away, or is a newer one — or null. */
  const [unsent, setUnsent] = useState<string | null>(null)

  /* The offer, once hosted, and again whenever the count in its label
     changes: the aim (none on a host that lists no containers — see the essay
     above), and the angle, which is how the host remembers it per container. */
  useEffect(() => {
    if (where === 'hosted') filters([...aimOffer(shown(containers)), ...angleOffer()])
  }, [where, filters, containers])

  /* The header says which screen is showing — the edit page counts as the one it was opened from — and the angle. */
  const showing = view.kind === 'edit' ? view.back : view.kind
  useEffect(() => {
    if (where === 'hosted') header(headerFor(showing, angle))
  }, [where, header, showing, angle])

  /* Every checklist that exists. This app's own material, read at load, after
     every change, and on the doorbell. */
  useEffect(() => {
    /* `alive`, so a slow read for the project just left cannot land after the
       new project's and paint its lists under it. */
    let alive = true
    void everyChecklist(projectPath)
      .then(({ lists: got, trouble: bad, nowhere: none }) => {
        if (!alive) return
        setLists(got)
        setStoreTrouble(bad)
        setNowhere(none)
      })
      .catch((caught: unknown) => {
        /* Nothing answered: `ask` has said so to `useServerStanding`, which draws the cover, and
           what was read stays underneath it. Anything else is a read that came back unusable. */
        if (alive && !unanswered(caught)) setLists([])
      })
    return () => {
      alive = false
    }
  }, [stamp, projectPath])

  /**
   * What is in front of the reader. The reading page's one request, re-asked
   * whenever the reader moves, the canvas selects, or the store changes.
   *
   * `alive` rather than an abort, so a slower earlier answer cannot paint over
   * a newer one. The dependencies are all strings or memoised on strings, so a
   * context that repeats itself does not fire this.
   */
  useEffect(() => {
    let alive = true
    /* No epic when the whole paper is not in front — see `paper` on
       `InFront`. The server builds the whole-paper rung from the epic alone,
       and a page narrowed to containers showing no document must not hand it
       one. */
    void whatIsHere(projectPath, paperPicked ? epic : null, documents, front.refs, front.byParts, following, refsRead, angle, paperPicked)
      .then((got) => {
        if (alive) setHere(got)
      })
      .catch((caught: unknown) => {
        if (alive && !unanswered(caught)) setHere(null)
      })
    return () => {
      alive = false
    }
    /* `frontKey` and not `front`: the value, not the identity. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, epic, frontKey, stamp])

  /**
   * What is in front once the parts focus is taken into account.
   *
   * The server is asked about everything in front — and, while the picked
   * parts decide it (`front.byParts`), about every list of the epic's paper —
   * and the lists held against a reference, a file or a section outside the
   * picked parts are put aside HERE, after the answer, not by asking about
   * less. That order is what lets an empty page know the pick emptied it:
   * something left out of the question would come back as nothing, and "no
   * checklist is in the picked part" needs there to have been one. Nothing is
   * said while a list is drawn.
   *
   * The rule is the protocol's (`focus.narrow`); this module gives it each
   * list's anchor (`anchorOf` in `list/focus.ts`) and the list in hand
   * (`keep`): the one whose edit page is open.
   *
   * With nothing picked `inFocus` is `here` itself, the same object, so no
   * effect below re-runs and the page is the page it was.
   *
   * A change of parts only ever changes what is ASKED and what is drawn. It
   * writes nothing: every tick stays in the file under its own checklist, item
   * and target, and the edit page — one list, with whatever is typed into it
   * — is not re-read for it.
   *
   * Only the reading page is narrowed. The list of every checklist is the way
   * to find a list wherever it is held, and the edit page is one list; neither
   * hides anything, so neither has anything to say about a focus.
   */
  const inHand = view.kind === 'edit' ? view.id : null
  const focused = useMemo(
    () =>
      focus.narrow(here?.instances ?? [], (one) => anchorOf(one, here?.positions), {
        noun: NOUN,
        keep: (one) => one.checklist.id === inHand,
      }),
    [here, focus, inHand],
  )
  const inFocus = useMemo(
    () => (here && focus.focused ? { ...here, instances: focused.shown } : here),
    [here, focus, focused],
  )
  /*
   * And then by whose work a list is for, while containers are picked out:
   * Paper, Slides and Screenplay can all be showing one chapter, and the list
   * about narration belongs in front of one of them. `forPicked` in
   * `list/aim.ts` is the rule. Like the focus it writes nothing.
   */
  const forThese = useMemo(() => forPicked(inFocus?.instances ?? [], front), [inFocus, front])
  const inSight = useMemo(
    () => (inFocus && forThese.aside.length ? { ...inFocus, instances: [...forThese.instances] } : inFocus),
    [inFocus, forThese],
  )
  /** The modules on this kehikko, which is what the edit page offers a list to be for. Never this one. */
  const modules = useMemo(
    () =>
      moduleLabels(shown(containers).map((one) => one.module))
        .map((one) => one.id)
        .filter((one) => one !== ID),
    [containers],
  )

  /** Which list the edit page is on, or null. A string, so the fetch keys on it by value. */
  /*
   * What the tracker says about the refs the lists in front are held against.
   *
   * Asked of the host — `tracker.get` with `detail: 'detail'` — whenever the
   * set of refs changes, and again whenever `context.tracker.at` moves, which
   * is `reacts: ['tracker']` doing what it says: a refresh pressed in any
   * container, or a background read of a ref that came back `pending`, lands
   * here as a new `at`. Keyed by the refs as one string, so a context that
   * changed nothing asks nothing.
   *
   * The last reading is kept while the next is asked for, and looked up by
   * ref, so a list arriving after a scroll does not blank the facts of the
   * lists already on screen.
   */
  const refsKey = useMemo(
    () =>
      [...new Set((inSight?.instances ?? []).flatMap((one) => (one.target?.kind === 'ref' ? [one.target.ref] : [])))]
        .sort()
        .join(' '),
    [inSight],
  )
  const [tracker, setTracker] = useState<TrackerReading | null>(null)
  useEffect(() => {
    if (where !== 'hosted' || !refsKey) return
    let alive = true
    void readTracker(refsKey.split(' ')).then((got) => {
      if (alive) setTracker(got)
    })
    return () => {
      alive = false
    }
  }, [where, refsKey, trackerAt, readTracker])
  const facts = useMemo(() => factsOf(tracker, marksOf(marks), trackerReading), [tracker, marks, trackerReading])

  /**
   * What the reading page draws: the lists and the sentence for an empty
   * page, both from one moment.
   *
   * A pick in the host's bar changes the QUESTION — every list of the paper,
   * or the lists under what is in front — and for the moment between the pick
   * and the server's answer `here` is still the answer to the other one. Read
   * under the new parts it is wrong both ways: unpicking would draw every list
   * of the paper, all open, until the answer landed. So what was last drawn
   * stays until the answer in hand is to the question now being asked.
   */
  const settled = !here || here.whole === front.byParts
  /*
   * The items picked, a section each: what the server said, or — from a
   * server that does not say — what was asked about, read from any role.
   */
  const itemsNow = useMemo<ItemInFront[]>(() => {
    if (here?.items?.length) return here.items
    const any: Role[] = ['any']
    return [
      ...front.refs.map((ref) => ({ target: { kind: 'ref', ref } as Target, type: null, as: any, elsewhere: [] })),
      ...(paperPicked && epic ? [{ target: { kind: 'paper', epic, section: null } as Target, type: 'paper' as ItemType, as: any, elsewhere: [] }] : []),
    ]
  }, [here, front, paperPicked, epic])
  /*
   * The items whose every list the parts focus put aside: their section says
   * the protocol's sentence rather than that nothing applies to them.
   */
  const asideNow = useMemo(() => {
    if (!focus.focused || !here) return [] as string[]
    const keyOf = (target: Target | null) =>
      target?.kind === 'ref' ? `ref:${target.ref}` : target?.kind === 'paper' ? `paper:${target.epic}` : ''
    const before = new Set(here.instances.map((one) => keyOf(one.target)))
    const after = new Set((inFocus?.instances ?? []).map((one) => keyOf(one.target)))
    return [...before].filter((key) => key && !after.has(key))
  }, [focus, here, inFocus])
  const drawnNow = {
    items: itemsNow,
    aside: asideNow,
    here: inSight,
    /* The focus first: when it put lists aside and none is left, that is the
       cause, whatever the picked-out containers were also doing. */
    why: focused.empty || whyEmpty(front, forThese.instances.length ? [] : forThese.aside),
    /* And with lists left, the ones put aside for another module's work are
       counted in the hint on "All checklists": no row is drawn for them. */
    putAside: whyAside((inFocus?.instances.length ?? 0) - forThese.instances.length, forThese.aside),
  }
  const drawn = useRef(drawnNow)
  if (settled) drawn.current = drawnNow

  const editing = view.kind === 'edit' ? view.id : null

  /*
   * What the reading page says beside its lists (Jalez/kehikko-checklist#32):
   * refs somebody clicked that the picks set aside, with the way to show them —
   * this container's aim on everything, the angle kept as it is.
   */
  const clicked = useMemo(() => setAside(front, selected ? selected.split(' ') : []), [front, selected])
  const onShowClicked = useCallback(() => choose({ ...choice, aim: 'all', [ANGLE_FILTER]: angle }), [choose, choice, angle])

  /*
   * "Add a checklist for merge requests as reviewer": a list made with its
   * rule said at once, opened on its edit page for its first line.
   */
  const onNewFor = useCallback(
    (type: ItemType, role: Role) => {
      const words = typesName([type])
      const name = `${words.charAt(0).toUpperCase()}${words.slice(1)} ${role === 'any' ? 'for any role' : `as ${role}`}`
      void onEditRef.current({ op: 'create', name, rule: { types: [type], roles: [role] } })
    },
    [],
  )
  /* A line for one item alone. */
  const onAddFor = useCallback((target: Target, text: string) => void onEditRef.current({ op: 'add-for', target, text }), [])

  /**
   * The automatic "Tests pass" items for the refs in front: what every module that runs things
   * published (`list/runs.ts`, read by this app's server). Read again when the refs change, when
   * the store changed, and when `context.content` moves — the host's watch of `.kehikot/` says so
   * when any `runs.json` changes, and this page does not know, or ask, whose it was.
   */
  const runRefs = front.refs.join(' ')
  const [runs, setRuns] = useState<Record<string, RunItem[]>>({})
  useEffect(() => {
    let alive = true
    void runsInFront(projectPath, runRefs ? runRefs.split(' ') : [])
      .then((got) => {
        if (alive) setRuns(got)
      })
      .catch(() => {
        /* Kept as it was: these items are an addition, and the cover says when the server is away. */
      })
    return () => {
      alive = false
    }
  }, [projectPath, runRefs, content, stamp])
  /* Hide one, or show it again: the one thing a person does to an automatic item. */
  const onHideRun = useCallback(
    (ref: string, label: string, hide: boolean) => {
      void hideRun(projectPath, ref, label, hide).then((answer) => {
        setTrouble(answer.ok ? null : answer.error)
        bump()
      })
    },
    [projectPath, bump],
  )

  /**
   * The list being edited, on its own.
   *
   * A checklist that is not there any more is not an error to be printed and
   * left. The edit page gives way to the list of every checklist, which says
   * what happened — because a container stuck on a sentence about a list that
   * was removed on another machine is a container a reader has no way out of.
   */
  useEffect(() => {
    if (!editing) {
      setOpened(null)
      return
    }
    let alive = true
    void openChecklist(editing, projectPath)
      .then((answer) => {
        if (!alive) return
        if ('error' in answer) {
          setGone(editing)
          setView({ kind: 'all' })
          return
        }
        setOpened(answer)
        setGone(null)
      })
      .catch((caught: unknown) => {
        /* Kept when it was only the server being away: the edit page stays mounted, and so does
           whatever somebody was typing into it. */
        if (alive && !unanswered(caught)) setOpened(null)
      })
    return () => {
      alive = false
    }
  }, [editing, projectPath, stamp])

  /**
   * The last file of a paper the reader was in, for the session.
   *
   * The outline is found by climbing from a file to the one declaring the
   * document, so it needs a file to start from. A reader who walks from a
   * chapter to an issue and presses Edit has no passage at that moment, and
   * would otherwise be offered no chapters. This is the one place a position
   * outlives its context, and it is allowed because it decides only which
   * files are OFFERED — never which are held, and never what is shown.
   */
  const [lastReading, setLastReading] = useState<string | null>(null)
  useEffect(() => {
    if (at?.path) setLastReading(at.path)
  }, [at])
  const reading = at?.path ?? lastReading

  /**
   * The paper's files and headings, which the edit page offers as targets.
   *
   * Asked for while a list is being edited and not on every context: this
   * opens every file of a paper, and a context arrives after every selection
   * change anywhere on the canvas. Dropped when the file under the reader
   * changes, because an outline is a fact about the DOCUMENT the reader is in
   * and goes stale when they open one belonging to another paper — not when
   * they hold the list against a different section of the one they are in.
   */
  const [outline, setOutline] = useState<Outline | null>(null)
  useEffect(() => {
    setOutline(null)
  }, [reading, projectPath])

  useEffect(() => {
    if (!editing || !reading || !projectPath) return
    let alive = true
    void paperOutline(projectPath, reading)
      .then((got) => {
        if (alive) setOutline(got)
      })
      .catch(() => {
        /* Swallowed to null, which is the same answer as "the fence refused
           it" and draws the same one line. */
        if (alive) setOutline(null)
      })
    return () => {
      alive = false
    }
  }, [editing !== null, reading, projectPath])

  const onEditRef = useRef<(change: Edit) => Promise<void>>(async () => {})
  const onEdit = useCallback(
    async (change: Edit) => {
      setBusy(true)
      try {
        const answer = await edit(change, projectPath)
        if (!answer.ok) {
          setTrouble(answer.error)
          /* The box it was typed into has already emptied itself — every view clears on the
             press — so when the write could not even be delivered, the words are kept here and
             drawn back where they can be copied. See `holding` below. */
          if (serverStanding() !== 'up') setUnsent('name' in change ? change.name : 'text' in change ? change.text : null)
          return
        }
        setTrouble(null)
        setLists(answer.lists)
        if (change.op === 'create' || change.op === 'import') {
          /* A list made here is opened here, on its edit page, because the
             next thing to do with a new list is say what it is held against
             — and a new list is held against nothing and shown nowhere until
             somebody does. The import screen is put away in the same breath. */
          setView({ kind: 'edit', id: answer.id, back: 'here' })
          setFrom(null)
          setImportable([])
        }
        if (change.op === 'forget') setView({ kind: 'all' })
        /* Everything is re-read from what the server now holds, never toggled
           locally: the server holds the order, the ticks and the targets, and
           a page that reordered itself on a refused write would show an order
           the file does not have. */
        bump()
      } finally {
        setBusy(false)
      }
    },
    [bump, projectPath],
  )

  const onCreate = useCallback((name: string) => void onEdit({ op: 'create', name }), [onEdit])
  onEditRef.current = onEdit

  /**
   * Ask the host to ask the person which project, then read what is in it.
   *
   * Every "nothing" — cancelled, declined, no host at all, a host too old to
   * have heard of the method — comes back the same way and is treated the same
   * way: the press un-presses and the screen does not change. The protocol
   * deliberately makes "you have no projects" and "I would rather not"
   * indistinguishable.
   */
  const onImport = useCallback(async () => {
    setChoosing(true)
    setTrouble(null)
    try {
      const picked = await pickProject()
      if (!picked) return
      const { lists: there, trouble: bad } = await everyChecklist(picked.path)
      setFrom(picked)
      setImportable(there)
      /* The refusal from the OTHER project's read, shown on the screen that is
         about that project — not in `storeTrouble`, which is about this one. */
      setTrouble(bad)
    } catch {
      /* A fetch to this app's own origin that did not happen. Nothing here a
         reader can act on. */
    } finally {
      setChoosing(false)
    }
  }, [pickProject])

  const onImportCancel = useCallback(() => {
    setFrom(null)
    setImportable([])
    setTrouble(null)
  }, [])

  /* Dropped whenever the open project changes: another project's checklists
     answer "what could I copy INTO this one", and the moment the reader is
     moved somewhere else it is an answer to a question nobody asked. The edit
     page is left too, for the same reason — its list belongs to the project
     that was open. */
  useEffect(() => {
    setFrom(null)
    setImportable([])
    setView({ kind: 'here' })
  }, [projectPath])

  /**
   * The shell element, held as STATE rather than in a ref, because `useRoom`
   * attaches a `ResizeObserver` to it and an effect keyed on a ref cannot know
   * when the ref was filled.
   */
  const [shell, setShell] = useState<HTMLDivElement | null>(null)
  const room = useRoom(shell)

  /** Say how tall we would like to be, whenever what is drawn changes size. See `wantedHeight`. */
  useEffect(() => {
    if (!shell || typeof ResizeObserver === 'undefined') return
    const say = () => {
      const scroller = shell.querySelector<HTMLElement>('[data-scroller]')
      resize(
        wantedHeight(
          shell.getBoundingClientRect().height,
          scroller?.scrollHeight ?? 0,
          scroller?.clientHeight ?? 0,
        ) + 16,
      )
    }
    const watch = new ResizeObserver(say)
    watch.observe(shell)
    say()
    return () => watch.disconnect()
  })

  /* How this page's own server last answered: `down` when nothing did, `stale` when it has restarted under this page. */
  const server = useServerStanding()

  /*
   * Whether somebody is in the middle of typing something that has not been sent — an item, a
   * name, a rewording. Asked of the page itself, once, at the moment its server stops answering,
   * and held until the server is back: the boxes are each view's own state, and this is the one
   * question about all of them. While it is true no cover is drawn over the page and this page
   * does not reload itself (the stale `Cover` is what reloads; `wire/use-kehikot.ts` turned the
   * hook's own reload off) — the words stay in front of the person, with a line saying what to
   * do with them. That does not stop Vite's dev client, which reloads the page by itself when its
   * server answers again; the line says so while there is still time to copy.
   */
  const typed = useRef(false)
  if (server === 'up') typed.current = false
  else if (!typed.current) typed.current = typing(shell)
  useEffect(() => {
    if (server === 'up') setUnsent(null)
  }, [server])
  const holding = typed.current || (server !== 'up' && unsent !== null)

  /*
   * Every not-ready moment is the protocol's one cover, in the order that makes each true: a page
   * that has not been greeted is `waiting`, never "no project". `nowhere` is the server's own
   * word — a path may be present and still name nothing this app will write under — and is the
   * same cover as no project at all. Whatever is covered stays MOUNTED underneath, hidden.
   */
  const cover: CoverState | null = holding
    ? null
    : server === 'stale'
      ? 'stale'
      : (coverFor({ where, projectPath })
        ?? (nowhere ? 'no-project' : server === 'down' ? 'down' : view.kind === 'here' && !from && !here ? 'loading' : null))

  const screen = from ? (
    /* Above the others on purpose. Somebody who is mid-import pressed Copy
       from the list of every checklist, and putting this under anything would
       mean pressing Copy and watching nothing happen. */
    <Importing
      from={from.name || from.path}
      lists={importable}
      onImport={(id) => void onEdit({ op: 'import', from: from.path, id })}
      onCancel={onImportCancel}
      trouble={trouble}
      busy={busy}
      reading={choosing}
      room={room}
    />
  ) : view.kind === 'edit' ? (
    opened ? (
      <EditView
        held={opened.held}
        targets={opened.targets}
        heldTotal={opened.heldTotal}
        modules={modules}
        kehikko={kehikko}
        epic={epic}
        /* Every reference in front — the canvas's selection and whatever the
           containers show — offered as targets, for the reason the selection
           was: a reference somebody has in front of them is the likeliest
           thing to hold a list against. */
        selection={front.refs}
        placed={here?.placed ?? null}
        outline={outline}
        paperKnown={reading !== null}
        onEdit={(change) => void onEdit(change)}
        onDone={() => setView({ kind: view.back })}
        trouble={trouble}
        busy={busy}
        room={room}
      />
    ) : (
      <p className="px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
        {trouble ?? 'Reading that checklist.'}
      </p>
    )
  ) : view.kind === 'storage' ? (
    <StorageView projectPath={projectPath} readProject={readProject} onBack={() => setView({ kind: 'here' })} onChanged={bump} room={room} />
  ) : view.kind === 'all' ? (
    <AllView
      lists={lists}
      onOpen={(id) => setView({ kind: 'edit', id, back: 'all' })}
      onCreate={onCreate}
      onImport={() => void onImport()}
      onBack={() => {
        setGone(null)
        setView({ kind: 'here' })
      }}
      onStorage={() => setView({ kind: 'storage' })}
      importing={choosing}
      trouble={trouble}
      busy={busy}
      said={gone ? 'That checklist is gone — removed here, or on another machine.' : null}
      room={room}
    />
  ) : (
    <HereView
      here={drawn.current.here}
      items={drawn.current.items}
      focusAside={drawn.current.aside}
      why={drawn.current.why}
      aside={drawn.current.putAside}
      onEdit={(change) => void onEdit(change)}
      onOpen={(id) => setView({ kind: 'edit', id, back: 'here' })}
      onAll={() => setView({ kind: 'all' })}
      trouble={trouble}
      busy={busy}
      room={room}
      facts={facts}
      kehikko={kehikko}
      clicked={clicked}
      onShowClicked={where === 'hosted' ? onShowClicked : undefined}
      onAngle={onAngle}
      onNewFor={onNewFor}
      onAddFor={onAddFor}
      runs={runs}
      onHideRun={onHideRun}
    />
  )

  /**
   * The shell, and the one line that decides whether this page scrolls or its
   * list does. Flowing, it is a column as tall as what it draws. Pinned, it is
   * exactly the height of the frame with `min-h-0`, which is what lets the one
   * scroller inside it be shorter than its content. No padding on it: the rows
   * keep their own `px-2`, and the dividers run the full width like the host's.
   */
  return (
    <OpenAddressContext.Provider value={openAddress}>
    <div
      ref={setShell}
      /* Not pinned under a cover: a cover fills a parent that has a height, and this page reports
         its height to the host — a cover as tall as the frame would ask for a taller frame, forever. */
      className={cn('flex flex-col gap-2 text-foreground', room.pinned && !cover && 'h-dvh min-h-0')}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      {framed ? null : (
        <header className="shrink-0 px-2 pt-2">
          <h1 className="text-sm font-semibold">Checklist</h1>
          <p className="text-[0.7rem] leading-4 text-muted-foreground">
            {room.prose
              ? 'Checklists somebody wrote, each held against the issues, changes, paper files and sections a person '
                + 'assigned it to, and shown wherever one of those is in front of the reader. Nothing here ships a list: '
                + 'every item is a line a person or an agent typed, and every tick belongs to a checklist, an item and a '
                + 'target together.'
              : 'Lists somebody wrote, shown against the issue, change, file or section in front of you.'}
          </p>
        </header>
      )}

      {/* A refusal, marked as one, kept off the host's edge so it reads as
          something this page is saying rather than as the host's chrome. */}
      {storeTrouble ? (
        <p className="mx-2 mt-2 shrink-0 rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
          {storeTrouble}
        </p>
      ) : null}

      {holding ? (
        <div role="alert" data-holding={server} className="mx-2 mt-2 flex shrink-0 flex-wrap items-center gap-1 rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4">
          <span className="min-w-0 basis-full">
            {server === 'stale'
              ? 'This page is older than its server, so what you have typed cannot be sent from it. Copy it now, then reload.'
              : 'Checklist’s own server is not answering, so what you have typed cannot be sent. Copy it now: when the server starts again this page reloads, and what is only here is lost.'}
          </span>
          {unsent ? (
            <span className="min-w-0 basis-full [overflow-wrap:anywhere]" data-unsent>
              Not sent: “{unsent}”
            </span>
          ) : null}
          {server === 'stale' ? (
            <Button type="button" size="container" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}

      {cover ? (
        <Cover
          state={cover}
          name="Checklist"
          onRetry={bump}
          /* A name is not a path, and this page will not guess: a guess writes somebody's list into a folder they will never look in. */
          detail={
            cover === 'no-project' && project && !projectPath
              ? `This canvas says the project is called “${project}” but not where it is on this machine. Checklists are kept inside the project, in a .kehikot folder there.`
              : cover === 'no-project' || cover === 'unhosted'
                ? 'Checklists are kept inside the project they are about, in a .kehikot folder there. Nothing has been lost and nothing has been written.'
                : null
          }
        />
      ) : null}
      <div hidden={cover !== null} className={cn('min-w-0', room.pinned && !cover && 'flex min-h-0 flex-1 flex-col')}>
        {screen}
      </div>
    </div>
    </OpenAddressContext.Provider>
  )
}

/** Whether any box on the page holds words somebody typed and has not sent. */
function typing(shell: HTMLElement | null): boolean {
  if (!shell) return false
  return [...shell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input:not([type="checkbox"])')].some(
    (box) => box.value.trim() !== '',
  )
}

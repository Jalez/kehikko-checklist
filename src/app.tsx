import { useCallback, useEffect, useMemo, useState } from 'react'

import { ID } from '../manifest.ts'
import { chosenOn } from '../list/keep.ts'
import type { Target } from '../list/targets.ts'

import {
  grainAt,
  ladderKey,
  narrow,
  offerAt,
  rungsOf,
  scopeOf,
  scopeOfTarget,
  widenedTarget,
} from '../list/scope.ts'

import { edit, everyChecklist, openChecklist, pointing, type Edit, type Opened, type Summary } from '@/store/ask.ts'
import { useRoadmap, type GotoHandler } from '@/wire/use-roadmap.ts'
import { ChecklistView } from '@/view/checklist.tsx'
import { Choose, Unplaced } from '@/view/choose.tsx'
import { Nowhere } from '@/view/nowhere.tsx'
import { wantedHeight } from '@/view/room.ts'
import { useRoom } from '@/view/use-room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The page.
 *
 * ## What it shows, and the sentence that decides it
 *
 * > "The checklist I don't think needs to show a list of items it has
 * > references recorded for. It should just show the checklist. Also I think we
 * > should simplify checklist in the sense that when user looks at the checklist
 * > for the first time in a kehikko they are supposed to pick an existing
 * > checklist or create their own checklist."
 *
 * So there are exactly two screens. Until a checklist has been picked for this
 * kehikko, the container is the pick-or-create screen. After that it is the
 * checklist, held against one target, and nothing else — no tab row, no
 * directory of references, no second kind of list. The tab row that used to be
 * here existed because there were three things this container could be showing; there
 * is one now, and a tab row over one thing is furniture.
 *
 * ## The choice is remembered per kehikko, and the host holds it
 *
 * `roadmap.context` carries `kehikko: {id, name} | null` — the only thing that
 * says where this container is standing, since a module's page is loaded once and
 * shown on whichever canvas asks for it. The host's kept state is keyed by
 * MODULE and by nothing else, so the per-kehikko map lives inside the one string
 * it keeps for us. See `list/keep.ts`.
 *
 * A null kehikko is a real state and gets `Unplaced` wrapped around the same
 * screens: the container says it cannot tell where it is, and then works anyway for
 * the session. Refusing to work would make a usable checklist unreachable
 * because of a field a host declined to fill in.
 *
 * ## A null projectPath is a real state too, and this one DOES stop the container
 *
 * The two nullable facts are not the same and are not treated the same, which is
 * worth saying out loud because the pair looks symmetrical.
 *
 * `kehikko` decides where a CHOICE is remembered. Without one the pick still
 * works and simply does not survive a reload — a smaller thing than not working.
 *
 * `projectPath` decides where the checklists ARE. This app's store moved into
 * the project (`<projectPath>/.kehikot/checklist/checklists.json`), so without one there is
 * no file to read and nowhere to write; every list on screen would have to be
 * invented and every press would have to go somewhere guessed. So the container says
 * so and offers nothing to press — see `src/view/nowhere.tsx`, and `store.ts`
 * for why a guessed location is worse than an absent one.
 *
 * ## Switching project repaints, without a reload
 *
 * `projectPath` is a dependency of both fetches below. A host that moves a
 * person to another project sends one `roadmap.context`, this hook sets one piece
 * of state, and both effects run: the lists are re-read from the new project's
 * folder and the open checklist is re-opened from it. Nothing is cached across
 * the change and nothing is filtered — the path IS the partition, so a different
 * project is a different file rather than a different subset of one.
 *
 * ## Identity is printed only when nothing is framing this page
 *
 * A host prints the module's name in the container header and hangs the manifest's
 * `summary` off it as a tooltip. A page that also printed "Checklist" at the top
 * of itself would be saying the name twice and spending a fixed strip of a
 * 340-pixel-tall container on the repetition. Unframed there is no container header and
 * nothing else would ever say what this program is, so the heading stays. The
 * test is `window.parent !== window`, which is answerable before first paint and
 * therefore does not blink.
 */
const framed = typeof window !== 'undefined' && window.parent !== window

export function App() {
  const [lists, setLists] = useState<Summary[]>([])
  const [storeTrouble, setStoreTrouble] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<Opened | null>(null)

  /**
   * A checklist picked here, for this session only.
   *
   * The mirror of the remembered choice rather than a duplicate of it. It is
   * what a pick becomes when there is nowhere to write it down — no host, or a
   * host that could not say which kehikko this is — and it is also what holds
   * the choice for the instant between pressing a name and the host acknowledging
   * anything. The remembered choice wins whenever there is one: two answers to
   * "which list am I looking at" with no way to tell them apart is exactly the
   * fault this app argues against everywhere else.
   */
  const [session, setSession] = useState<string | null>(null)

  /** A target picked here, which overrules what the context proposes. */
  const [picked, setPicked] = useState<Target | null>(null)

  /**
   * A checklist that was remembered and is not here any more.
   *
   * A separate state from `trouble` because it is not a refusal of anything
   * somebody just pressed — it is the store having moved underneath a
   * remembered choice, which happens when a list is removed on another machine
   * or in another container. Held so the pick screen can say what happened rather
   * than opening as though nothing had.
   */
  const [gone, setGone] = useState<string | null>(null)

  /**
   * Bumped whenever an agent comes through this app's MCP door.
   *
   * The pump in `emit.ts` is already polling for exactly that, in order to
   * announce it to a host, so this page learns of it on the same two-second read
   * rather than opening a second one — see the essay there. What it is FOR is
   * the case that makes this module worth having: somebody watching this container
   * while an agent ticks items off should see the ticks land, not a screen that
   * was right when they loaded it.
   */
  const [doorbell, setDoorbell] = useState(0)

  const onGoto = useCallback<GotoHandler>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference. This container draws one
       checklist against one target, so the honest answer to all three is that
       there is nothing here to be walked to — saying so quickly is what gets the
       reader the host's fallback link instead of a twelve-second wait. */
    answer(
      false,
      message.ref
        ? 'This container shows one checklist held against one target, so there is nothing here to walk to by reference.'
        : 'This container shows a checklist, so there is nothing here to walk to by epic or step.',
    )
  }, [])

  const onDoor = useCallback(() => setDoorbell((was) => was + 1), [])

  const {
    where,
    epic,
    projectPath,
    project,
    kehikko,
    selection,
    passage,
    chosen: filterChoice,
    kept,
    remember,
    resize,
    filters,
  } = useRoadmap(ID, onGoto, onDoor)

  /*
   * The ladder is offered to `roadmap.filters` — and this reverses an argument
   * that stood right here, so the argument is written out before it is answered.
   *
   * What stood here said: the protocol's filters are a choice from a fixed set
   * of options a module names, the ladder is a POSITION derived from the passage
   * the reader is standing in, there is no fixed set to enumerate, and the host
   * remembers a filter per container FOREVER — which is precisely what
   * `list/scope.ts` refuses under its "nothing is remembered" rule, because a
   * remembered scope outlives the context that justified it and the container
   * would come back tomorrow showing a section of a file the reader has left.
   *
   * Every sentence of that is true. The conclusion is still wrong, because it
   * offered the rungs as PLACES. Offer them as GRAIN instead — `section`,
   * `file`, `paper` — and the objection dissolves:
   *
   * - **There is a fixed set.** Three words, the same three next week, meaning
   *   the same thing on every canvas and in every document. What is derived is
   *   which section and which file, and that goes on being derived from
   *   `passage` on every context, exactly as before.
   *
   * - **Nothing that outlives its context is stored.** No path, no section id,
   *   no epic is in the offer or in the answer. What the host remembers is how
   *   narrow this reader likes it — a genuine preference, and one that SHOULD
   *   survive a restart: somebody who works section by section should still be
   *   section by section tomorrow, in whatever file they open tomorrow. The rule
   *   in `list/scope.ts` survives intact and now says so explicitly.
   *
   * - **A rung that is not there is not offered**, and a remembered one that is
   *   no longer available falls back rather than narrowing by nothing. See
   *   `offerAt` and `grainAt`.
   *
   * What the old argument was really defending is the pairing of the count with
   * the undo — `N ticked elsewhere in this paper` beside the way out. Only half
   * of that moves. The COUNT stays in the page, because the host cannot count
   * rows it does not render; the CONTROL goes to the header, where every other
   * module in this family already put its own. What the page gets back is the
   * strip of chrome that press was standing on, in a container the owner runs at
   * 220 pixels wide.
   */

  /**
   * Where the reader is pointing, inflated once from the string the wire holds.
   *
   * Memoised on that string, so a context that re-states the same passage — which
   * is every context, since one arrives after any change anywhere on the canvas —
   * hands back the same object and does not re-run the fetch below.
   */
  const at = useMemo(() => pointing(passage), [passage])

  /**
   * Whether there is anywhere at all to read from or write to.
   *
   * Held from the server's answer rather than derived from `projectPath` alone,
   * because the server is the one that knows: a path may be present and still
   * name nothing this app will write under — a folder that is not there, a
   * `.kehikot` that resolves outside the project. `store.ts` decides that, and
   * this is what it decided, so the page and the store can never disagree about
   * whether there is a store.
   *
   * It starts false and is only ever DRAWN once the greeting has settled — see
   * the guard on `screen` below. At mount there is no context yet, so the first
   * fetch goes out with no project and comes back `nowhere: true`, which is
   * true and is not yet worth saying: a page that announced "no project is
   * open" for one frame and was then greeted would teach the reader that this
   * screen is noise. That is the same argument as the greeting grace in
   * `use-roadmap.ts`, applied to the same 700 milliseconds.
   */
  const [nowhere, setNowhere] = useState(false)

  /** Which checklist is in front: the remembered one for this kehikko, or a session pick. */
  const remembered = chosenOn(kept, kehikko?.id ?? null)
  const chosen = remembered ?? session

  /* Every checklist that exists. This app's own material, so it is read at load
     and on the doorbell rather than being tied to anything on the wire. */
  useEffect(() => {
    /* `projectPath` is in the dependency list, which is the whole of "switching
       project repaints without a reload": a new context sets one piece of state
       and this runs again against a different folder. */
    void everyChecklist(projectPath)
      .then(({ lists: got, trouble: bad, nowhere: none }) => {
        setLists(got)
        setStoreTrouble(bad)
        setNowhere(none)
      })
      .catch(() => setLists([]))
  }, [doorbell, projectPath])

  /**
   * The targets the CONTEXT is proposing, in the order a reader would want them.
   *
   * The canvas's selection first, because a reference somebody just clicked is
   * the most likely thing they want a list held against; then the paper the open
   * epic is aimed at, which is the target that exists whenever an epic does.
   *
   * Memoised on the SPELLING rather than on the arrays: `selection` is a new
   * array on every context even when it names the same three refs, and the host
   * sends a context after every selection change anywhere on the canvas, so a
   * memo keyed on array identity would be no memo at all and everything
   * downstream of it — including the fetch — would fire on each one.
   */
  const key = `${selection.join(' ')}|${epic ?? ''}`
  const candidates = useMemo((): Target[] => {
    const [refs, paper] = key.split('|')
    const out: Target[] = (refs ? refs.split(' ') : []).filter(Boolean).map((ref) => ({ kind: 'ref', ref }))
    if (paper) out.push({ kind: 'paper', epic: paper, section: null })
    return out
  }, [key])

  /**
   * The target in front: the one picked here, or the first the context proposes.
   *
   * A pick made here survives the next context, which is the whole reason it is
   * held separately — a context arrives after every selection change anywhere on
   * the canvas, and a target that reset on each would be unusable in a workspace
   * where anything else is being clicked.
   *
   * It is dropped when the canvas selects something, because that IS somebody
   * saying what they are now looking at, and a local pick left standing under it
   * would be two answers with no way to tell them apart.
   */
  const proposal = candidates[0] ?? null

  /**
   * The rungs that exist right now, as one string.
   *
   * ## Built from where the reader is standing, not from what has ticks
   *
   * `scopeOf` takes the passage as the server resolved it — `opened.placed` —
   * so the ladder is the reader's position and nothing else. A file with no
   * labelled heading above them has no section rung, and the offer therefore has
   * no `This section` option: a header control that cannot be honoured is
   * indistinguishable from a broken one, so the offer is re-sent whenever the
   * ladder moves rather than being sent once at mount.
   *
   * ## A string, because everything downstream depends on it
   *
   * `rungsOf` and `scopeOf` build fresh objects on every render. An effect keyed
   * on either would post a `roadmap.filters` message on every render, and the
   * memo below would hand back a fresh target that re-ran the fetch that set the
   * state that caused the render. See the essay on `ladderKey`.
   *
   * ## No ladder while a target has been picked by hand
   *
   * A target chosen off the switcher is a decision about WHICH target, and a
   * grain control over it would be a lie — press `This file` while holding the
   * list against another chapter's section and either the press does nothing or
   * it throws away the pick. So the ladder is empty, the offer is withdrawn, and
   * the control disappears until the pick does — which the effects below already
   * make happen the moment the reader moves or the canvas selects something.
   * Same for a ref: an issue has no passage and no rungs, which is the whole of
   * "non-document targets are untouched".
   *
   * ## Null is "not known yet", and it is NOT the empty ladder
   *
   * The distinction cost a real bug, found by driving the real host rather than
   * reasoned about. Until the server has answered there is no `placed`, so the
   * ladder would compute as the bare paper — one rung, no offer — and the effect
   * below would post `groups: []` a moment after every load. An empty offer is
   * not silence: the protocol says it means "nothing here can be narrowed now",
   * and this host acts on it by pruning the container's stored choice against it
   * (`settle` in its `host/filters.ts`), which is correct behaviour and erases
   * the reader's grain on every reload. The symptom was a filter that worked
   * perfectly and never survived a refresh.
   *
   * So: null while `opened` is null — before the first answer, on the pick
   * screen, and after a read that failed — and the effect sends nothing at all,
   * leaving the last thing this page actually knew standing. A withdrawal is a
   * claim, and a page must only make it when it is true.
   *
   * `offerAt` answers null for a second reason of its own — a real ladder with
   * only one rung on it — and the two are the same instruction to the effect
   * below: say nothing. The one case that genuinely withdraws is a ref, which
   * has no ladder at all and never will.
   */
  const ladder = opened
    ? ladderKey(
      rungsOf(scopeOf(picked === null && proposal?.kind === 'paper' ? proposal.epic : null, opened.placed)),
    )
    : null

  /**
   * Say what this container can be narrowed by, whenever that answer changes.
   *
   * The ladder is the only dependency, and `filters` is stable. Re-sending an
   * identical offer on every render would be a message a second to every host on
   * the canvas for a change nobody could see; not re-sending at all would leave
   * `This section` in the header of a file that has no sections in it.
   */
  useEffect(() => {
    const groups = offerAt(ladder)
    /* Null is `offerAt` saying "nothing to say yet", which is not the same as an
       empty offer and must not become one — see the essay there. Posting `[]`
       out of ignorance is how the reader's stored grain got erased on every
       reload. */
    if (groups === null) return
    filters(groups)
  }, [filters, ladder])

  /**
   * How much of the paper the reader has asked for, of what is actually on offer.
   *
   * A grain the host remembers from a file with headings, replayed into one
   * without, is not honoured — `grainAt` falls back to the narrowest rung that
   * exists here, which is the same value the offer names as its fallback. The
   * host reconciles as well and is required to; it cannot do it before this page
   * has offered anything, and the greeting goes out first.
   */
  const grain = grainAt(filterChoice, ladder ?? '')

  /**
   * The target the grain means, when it means one at all.
   *
   * Null on the narrowest rung, which leaves the target exactly what it was
   * before any of this existed — the proposal, with no section on it — so the
   * server goes on resolving the passage itself. That keeps the untouched path
   * byte-for-byte the old path, which is what makes "nobody has pressed
   * anything" a case this change cannot have broken.
   *
   * Memoised on two strings, so the fetch below is not re-run by a fresh object
   * on every render.
   */
  const widened = useMemo(() => widenedTarget(ladder ?? '', grain), [ladder, grain])

  /**
   * The target in front: the one picked here, then the grain, then whatever the
   * context proposes.
   *
   * A pick made here survives the next context, which is the whole reason it is
   * held separately — a context arrives after every selection change anywhere on
   * the canvas, and a target that reset on each would be unusable in a workspace
   * where anything else is being clicked.
   *
   * It is dropped when the canvas selects something, because that IS somebody
   * saying what they are now looking at, and a local pick left standing under it
   * would be two answers with no way to tell them apart.
   */
  const target = picked ?? widened ?? proposal

  /**
   * Whether the target in front was DECIDED or derived from the passage.
   *
   * A bug the probe found rather than one this comment anticipated: pressing
   * "show the whole paper" set the target to `{epic, section: null}`, the next
   * fetch sent that alongside the path, and the server — which cannot tell a
   * deliberate "no section" from an unfilled one — resolved the path straight
   * back into the section the reader had just climbed out of. The control
   * appeared to do nothing, twice, and looked exactly like the bug it was
   * written to fix.
   *
   * The rule it settles is worth more than the fix: a passage exists to DERIVE a
   * default, and a derivation must never overrule a decision. That is why a
   * widen is `decided` here even though the press is now in the host's header
   * rather than in this page — moving the control changed who says it, not what
   * it means. The path still travels, because the heading wants the file's real
   * name and the section's real words either way; this only says which of the
   * two the server may act on.
   */
  const decided = picked !== null || widened !== null

  const selected = selection.join(' ')
  useEffect(() => {
    if (selected) setPicked(null)
  }, [selected])

  /**
   * And dropped again when the reader moves to somewhere else in the document.
   *
   * The same argument as the line above it, for the other half of "what am I
   * looking at". A pick names ONE target — this chapter's section, that issue —
   * and carrying it into the next chapter the reader opens would show one file's
   * ticks under another file's heading. That is the two-halves-disagreeing
   * failure, and it is why this module keeps no target in its `state:keep`
   * string either: a remembered PLACE outlives the context that justified it, and
   * this session-local one is dropped the moment its context does.
   *
   * The widen used to be a pick and was the main thing this dropped. It is the
   * host's remembered grain now, and is deliberately NOT dropped here — a grain
   * is a preference and travels with the reader, while the place it is applied to
   * is re-derived in the next file. That is the whole distinction the essay above
   * `filters` draws, seen from the side of the code that has to act on it.
   *
   * Keyed on the flat passage string rather than on `at`, so the effect and the
   * hook are comparing the same thing by value.
   */
  useEffect(() => {
    setPicked((was) => (was?.kind === 'paper' ? null : was))
  }, [passage])

  /**
   * Go back to the pick screen, forgetting the choice for this kehikko.
   *
   * `forget` and `another` are the same act with one difference, and the
   * difference is the whole reason there are two: `another` is somebody pressing
   * a button, so it clears the sentence explaining why the last list vanished,
   * and `forget` is the store having moved underneath us, so it must not — the
   * sentence is the only thing that will tell them what happened.
   */
  const forget = useCallback(() => {
    setSession(null)
    setOpened(null)
    if (kehikko) remember(kehikko.id, null)
  }, [kehikko, remember])

  const another = useCallback(() => {
    forget()
    setTrouble(null)
    setGone(null)
  }, [forget])

  /**
   * The chosen checklist, held against the current target.
   *
   * `alive` rather than an abort, so a slower earlier answer cannot paint over a
   * newer one. `target` is a safe dependency despite being an object: it is
   * either state the reader set, or `candidates[0]`, and the candidates are
   * memoised on their SPELLING — so a context that re-proposes the same targets
   * hands back the same array and this does not fire.
   *
   * A checklist that is not there any more is not an error to be printed and
   * left. The remembered choice is dropped, the pick screen comes back, and it
   * says what happened — because a container stuck on a sentence about a list that
   * was removed on another machine is a container a reader has no way out of.
   */
  useEffect(() => {
    if (!chosen) {
      setOpened(null)
      return
    }
    let alive = true
    void openChecklist(chosen, target, projectPath, at, decided)
      .then((answer) => {
        if (!alive) return
        if ('error' in answer) {
          setGone(chosen)
          forget()
          return
        }
        setOpened(answer)
        setTrouble(null)
        setGone(null)
      })
      .catch(() => {
        if (alive) setOpened(null)
      })
    return () => {
      alive = false
    }
  }, [chosen, target, doorbell, forget, projectPath, at, decided])

  const pick = useCallback(
    (id: string) => {
      setSession(id)
      setTrouble(null)
      setGone(null)
      if (kehikko) remember(kehikko.id, id)
    },
    [kehikko, remember],
  )

  const onEdit = useCallback(
    async (change: Edit) => {
      setBusy(true)
      try {
        const answer = await edit(change, projectPath)
        if (!answer.ok) {
          setTrouble(answer.error)
          return
        }
        setTrouble(null)
        setLists(answer.lists)
        if (change.op === 'create') {
          /* A list created here is opened here. Making somebody press the name
             they have just typed is the sort of step that reads as the app not
             having noticed. */
          setSession(answer.id)
          if (kehikko) remember(kehikko.id, answer.id)
          return
        }
        if (change.op === 'forget') {
          setSession(null)
          setOpened(null)
          if (kehikko) remember(kehikko.id, null)
          return
        }
        /* Painted from what came back, never toggled locally. The server holds
           the order and the ticks, and a list that reordered itself on a write
           that was refused would be showing an order the file does not have. */
        /* `placed` is carried through rather than cleared. It is a fact about
           where the reader's document is, and a tick did not move them — dropping
           it here would make the heading fall back to the file for one frame
           after every press, which reads as the container losing its place. */
        if (answer.held) {
          setOpened((was) => ({ held: answer.held!, targets: was?.targets ?? [], placed: was?.placed ?? null }))
        }
        /* And the targets are re-read, because a tick may have made a new one or
           emptied the last one — which is what the target switch is drawn from. */
        if (chosen) {
          const again = await openChecklist(chosen, target, projectPath, at, decided)
          if (!('error' in again)) setOpened(again)
        }
      } finally {
        setBusy(false)
      }
    },
    [at, chosen, decided, kehikko, projectPath, remember, target],
  )

  const onCreate = useCallback((name: string) => void onEdit({ op: 'create', name }), [onEdit])

  /**
   * The shell element, held as STATE rather than in a ref.
   *
   * `useRoom` attaches a `ResizeObserver` to it, and an effect keyed on a ref
   * cannot know when the ref was filled — it would observe null on the first
   * pass and never run again, so the width would stay at its opening guess for
   * the life of the page. A callback ref that sets state re-runs the effect on
   * the render the node exists, which is the ordinary fix and the only one that
   * does not involve observing something on every render.
   */
  const [shell, setShell] = useState<HTMLDivElement | null>(null)

  /** What this container has room for, and therefore what is drawn. See `src/view/room.ts`. */
  const room = useRoom(shell)

  /**
   * Say how tall we would like to be, whenever what is drawn changes size.
   *
   * Pinned, the shell is exactly as tall as the frame, so its own height says
   * nothing — `wantedHeight` adds back whatever the inner scroller is hiding, so
   * a host willing to grow this container is still asked to. Flowing, there is no
   * scroller and this is the same number it always was. See the essay on
   * `wantedHeight`.
   */
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

  /**
   * Why we are on the pick screen, in the words that fit the case.
   *
   * Four sentences rather than one, because they send a reader to four different
   * places: waiting to hear, standing on a named canvas for the first time,
   * standing on a canvas whose remembered list is gone, and running with nothing
   * framing this page at all. A single "pick a checklist" would be this app
   * telling a reader nothing at the moment it has something specific to say.
   */
  const said =
    where === 'listening'
      ? 'Waiting to hear whether anything is framing this page, and therefore which kehikko this is.'
      : gone
        ? 'That checklist is not here any more — it was removed, here or on another machine. Pick another, or start one.'
        : kehikko
          ? `Nothing has been picked for ${kehikko.name} yet. What is chosen here is remembered for this kehikko and no other, so a different canvas keeps its own.`
          : where === 'unhosted'
            ? 'Nothing is framing this page, so there is no kehikko to remember a choice against. Everything below is held here, on this machine, and works with nothing else running — the pick will last until this page is reloaded.'
            : 'Pick the checklist this work is held to, or start one. Nothing here ships a list.'

  /**
   * Which rung of the paper this container is on, and what that rung is not
   * showing.
   *
   * Both derived from the ANSWER rather than from the request: `held.target` is
   * the target the server actually read the ticks for — which is the passage
   * resolved to a section, unless somebody widened — and `placed` is where the
   * reader's document actually is. Deriving the heading from what this page
   * asked for instead would let the two disagree for exactly as long as a fetch
   * takes, which is the whole class of bug the single round trip was arranged to
   * remove. See the essay on `/api/checklist` in `doors.ts`.
   *
   * `narrow` is pure and lives in `list/scope.ts` with a table of cases beside
   * it, for the same reason `src/view/room.ts` does: the ladder is a decision,
   * decisions are testable without a browser, and a decision made inline in a
   * component is one nobody can put a case to.
   */
  const scope = scopeOfTarget(opened?.held.target ?? null, opened?.placed ?? null)
  const narrowed = narrow(scope, opened?.targets ?? [])

  /*
   * There is no `onWiden` here any more, and its absence is the change.
   *
   * Climbing a rung was a press in this page's own strip, which set `picked` to
   * the wider target. It is now a choice in the container header: the host draws
   * it from `offerAt`, remembers it against this container, and hands it back in
   * `context.filters`, where `grainAt` and `widenedTarget` above turn it into
   * the same target the press used to set. What is gone is the row of chrome the
   * press was standing on — see `src/view/checklist.tsx`, which still prints the
   * count the press stood beside, because a host cannot count rows it does not
   * render.
   */

  const screen = nowhere && where !== 'listening' ? (
    /* Above every other screen, and above `chosen`, because it is not a variant
       of the pick screen — there is nothing to pick FROM. A remembered choice
       from another project is deliberately left alone rather than forgotten:
       come back to that project and the same list is in front of you. */
    <Nowhere unhosted={where === 'unhosted'} project={project} />
  ) : opened && chosen ? (
      <ChecklistView
        held={opened.held}
        targets={opened.targets}
        candidates={candidates}
        narrowed={narrowed}
        onTarget={setPicked}
        onEdit={(change) => void onEdit(change)}
        onAnother={another}
        trouble={trouble}
        busy={busy}
        room={room}
      />
    ) : chosen ? (
      /* A list is chosen and has not come back yet — or came back refused, which
         is a sentence rather than a blank. Both are said, because "reading it"
         and "it could not be read" send a reader to two different places. */
      <p className="text-[0.7rem] leading-4 text-muted-foreground">
        {trouble ?? 'Reading that checklist.'}
        {trouble ? (
          <>
            {' '}
            <button type="button" className="underline underline-offset-2" onClick={another}>
              Pick another
            </button>
          </>
        ) : null}
      </p>
    ) : (
      <Choose
        lists={lists}
        onPick={pick}
        onCreate={onCreate}
        trouble={trouble}
        busy={busy}
        said={said}
        room={room}
      />
    )

  /**
   * The shell, and the one line that decides whether this page scrolls or its
   * list does.
   *
   * Flowing, it is what it always was: a column as tall as what it draws, in a
   * document the frame scrolls. Pinned, it is exactly the height of the frame
   * with `min-h-0` on it, which is what lets the one scroller inside it — the
   * items — actually be shorter than its content instead of growing the column.
   * `h-dvh` and not `h-screen`: inside an iframe the two agree, and `dvh` is the
   * one that stays right when a mobile host's own chrome moves.
   */
  return (
    <div
      ref={setShell}
      className={cn('flex flex-col gap-2 p-2 text-foreground', room.pinned && 'h-dvh min-h-0')}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      {framed ? null : (
        <header className="shrink-0">
          <h1 className="text-sm font-semibold">Checklist</h1>
          <p className="text-[0.7rem] leading-4 text-muted-foreground">
            {room.prose
              ? 'Checklists somebody wrote, and what has been ticked off against one issue, change or paper. Nothing '
                + 'here ships a list and nothing is computed: every item is a line a person or an agent typed, and '
                + 'every tick belongs to a checklist, an item and a target together. The lists and the ticks are held '
                + 'here, on this machine, in this app’s own store.'
              : 'Lists somebody wrote, ticked off against one issue, change or paper.'}
          </p>
        </header>
      )}

      {storeTrouble ? (
        <p className="shrink-0 rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
          {storeTrouble}
        </p>
      ) : null}

      {where === 'hosted' && !kehikko ? <Unplaced room={room}>{screen}</Unplaced> : screen}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'

import { ID } from '../manifest.ts'
import { chosenOn } from '../list/keep.ts'
import { holdingAt } from '../list/holding.ts'
import { targetKey, type Target } from '../list/targets.ts'

import {
  grainAt,
  ladderKey,
  narrow,
  offerAt,
  rungsOf,
  scopeOf,
  scopeOfTarget,
} from '../list/scope.ts'

import {
  edit,
  everyChecklist,
  openChecklist,
  paperOutline,
  pointing,
  type Edit,
  type Opened,
  type Outline,
  type Summary,
} from '@/store/ask.ts'
import { useRoadmap, type GotoHandler } from '@/wire/use-roadmap.ts'
import { ChecklistView } from '@/view/checklist.tsx'
import { Choose, Unplaced } from '@/view/choose.tsx'
import { Importing } from '@/view/importing.tsx'
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
   * The project somebody picked to copy a checklist out of, and what is in it.
   *
   * ## Why this state exists at all, and what it is not
   *
   * The user's ask was one sentence: *"the ability to import a checklist from
   * some other epic/project so that we dont have to start from scratch every
   * time. Are all the checklists (not their instances) Saved per project?"*
   *
   * They are, in one file: `<project>/.kehikot/checklist/checklists.json`. What
   * is per-KEHIKKO is only the PICK — which list a canvas shows, in
   * `list/keep.ts` — so every checklist in a project is already visible to every
   * canvas in it, and "between epics" is not the axis. Import is inherently
   * cross-project.
   *
   * Which runs straight into the rule this whole family keeps: a module is told
   * one `projectPath` and may read what the host named. So this state is never
   * a folder this page went looking for. It is filled only by `pickProject`,
   * which asks the host to ask a person, and is emptied by anything going wrong.
   * There is no code path here that can produce a second project on its own, and
   * there must never be one — a module that could enumerate projects has been
   * handed the disk.
   *
   * `lists` is that project's checklists, read through this app's own door with
   * the picked path on the query. That door already took a project on every read
   * for reasons that had nothing to do with this — the store moved into the
   * project a while ago — so reading a second project needed no new door, which
   * is a small piece of evidence that the partition was drawn in the right
   * place.
   */
  const [from, setFrom] = useState<{ path: string; name: string } | null>(null)
  const [importable, setImportable] = useState<Summary[]>([])
  /**
   * True from the press until there is something to show, or nothing to show.
   *
   * Covers two waits that a person experiences as one: the host asking them
   * which project — which lasts exactly as long as they take — and this app
   * reading that project's file afterwards. Splitting them on screen would mean
   * a button that says "Choosing…" and then blinks to "Reading…" for eighty
   * milliseconds.
   */
  const [choosing, setChoosing] = useState(false)

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
    pickProject,
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

  /*
   * There used to be a `const proposal = candidates[0] ?? null` here, and it was
   * the bug the owner reported.
   *
   * It said: the target of this checklist is the canvas's selection, or else the
   * paper the open epic is aimed at — a property of THE MOMENT, recomputed after
   * every context, which is after every selection change anywhere on the canvas
   * and after every scroll through a paper. So one list silently re-pointed
   * itself at whatever prose was in front of the reader, and "held against"
   * named a cursor rather than a claim.
   *
   * What replaces it is `holdingAt` in `list/holding.ts`, which has the whole
   * argument: a target is a property of the CHECKLIST — ticks are keyed by
   * `(list, target, item)`, so a pairing is durable and countable and the store
   * has always treated it so — and where the reader is standing chooses WHICH of
   * those pairings is in front, never what a list is about. The candidates are
   * still built above, because they are what the switcher offers somebody who
   * wants to make a new pairing by hand.
   */

  /**
   * Where the reader is standing, as one string: the rungs under their passage,
   * narrowest first.
   *
   * The POSITION, and never the target — the two were one value before this
   * change and that was the fault. It is computed from the epic and from where
   * the server said the reader turned out to be, and from nothing else: not from
   * the selection (a reference the canvas picked out does not move anybody
   * through a document) and not from what this list happens to be held against.
   *
   * Unlike `ladder` below it is NOT null before the first answer. `placed` is
   * null then, so this is the bare paper, which is exactly the target the page
   * has always fetched with at that moment — the one that makes the server
   * resolve the passage and hand back the rest of the ladder. Nothing draws this
   * container until that answer arrives, so nobody sees the coarse rung.
   */
  const here = ladderKey(rungsOf(scopeOf(epic ?? null, opened?.placed ?? null)))

  /** The references the canvas has selected, as one string. See `candidates`. */
  const selected = selection.join(' ')

  /**
   * How much of the paper the reader has asked for, of what is actually on offer.
   *
   * Read against `here` — the reader's POSITION — rather than against the offer
   * below, and that difference is new. The offer is withdrawn while a ref is in
   * front, and reconciling the grain against a withdrawn offer would answer
   * `null` for a reader standing in a chapter with a reference selected beside
   * it. The grain is a fact about how this person likes to work; it does not
   * stop being true because something else is on screen.
   *
   * A grain the host remembers from a file with headings, replayed into one
   * without, is not honoured — `grainAt` falls back to the narrowest rung that
   * exists here, which is the same value the offer names as its fallback. The
   * host reconciles as well and is required to; it cannot do it before this page
   * has offered anything, and the greeting goes out first.
   */
  const grain = grainAt(filterChoice, here)

  /**
   * The pairings this list has, as one string of keys.
   *
   * Keys and not the array, because `/api/checklist` builds a fresh `targets` on
   * every answer. A memo keyed on the array would recompute after every fetch,
   * hand back a fresh target object, and re-run the fetch that produced it —
   * which is not a slow render, it is a loop. The same argument `candidates`
   * makes about `selection` one screen up, and `ladderKey` makes about rungs.
   */
  const pairings = (opened?.targets ?? []).map((one) => targetKey(one.target)).join('\n')

  /**
   * Which pairing of this list with a target is in front of the reader.
   *
   * The argument is in `list/holding.ts` and is not repeated here. The one line
   * of it: a target belongs to the CHECKLIST — ticks are keyed by `(list,
   * target, item)` and always have been — so where the reader is standing
   * chooses which of the pairings somebody already made is shown, and never what
   * this list is about. `unheld` is the state the old model could not express,
   * and its absence is why the owner had to report this: the container is
   * somewhere this list is not held against, and now says so instead of
   * re-aiming itself at wherever they happen to be reading.
   *
   * Memoised on four strings and one piece of state, so a context that repeats
   * itself — and every context does — hands back the same target object and the
   * fetch below does not fire.
   */
  const holding = useMemo(
    () =>
      holdingAt({
        ladder: here,
        grain,
        pairings: pairings ? pairings.split('\n') : [],
        picked,
        selection: selected ? selected.split(' ') : [],
      }),
    [here, grain, pairings, picked, selected],
  )

  /**
   * The rungs this container offers to be narrowed by, as one string.
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
   * memo above would hand back a fresh target that re-ran the fetch that set the
   * state that caused the render. See the essay on `ladderKey`.
   *
   * ## No offer while what is in front is not on the ladder
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
   * What the model changed is which of those states this page is IN, not what it
   * does about them — and it sharpened the test from "was this picked" to "is
   * what is in front a rung of the ladder", which is `holding.grounded`. Two
   * cases move because of it, both in the direction of saying less:
   *
   * - A selected reference used to withdraw the offer by itself, because the
   *   selection WAS the target. It withdraws now only when this list is
   *   genuinely held against that reference — otherwise the container is showing
   *   a rung of the paper, the grain governs it, and the control says something
   *   true. `unheld` keeps the offer for the same reason: the grain is what
   *   names the rung a press would make the pairing at.
   *
   * - A pick that LANDS on the ladder no longer withdraws. It used to, and that
   *   was affordable while a hand-pick was rare. `Hold it against here` is an
   *   ordinary press now, its target is a rung by construction, and a withdrawal
   *   is a claim this host answers by pruning the grain it has remembered for
   *   this container — so the old rule would have spent the reader's stored
   *   preference every time they held a list against what they were reading.
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
   * claim, and a page must only make it when it is true. `here` above is
   * deliberately NOT null-guarded this way, and the pair is the point: one of
   * them is a fact this page needs in order to ask anything at all, the other is
   * a claim it makes to somebody else.
   *
   * `offerAt` answers null for a second reason of its own — a real ladder with
   * only one rung on it — and the two are the same instruction to the effect
   * below: say nothing. The one case that genuinely withdraws is a target that
   * is not on the ladder at all: a ref, or one somebody pointed at by hand.
   */
  const ladder = opened ? (holding.grounded ? here : '') : null

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

  /** The target the ticks on screen belong to, if there is one. See `holdingAt`. */
  const target = holding.target

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
   * widen is `decided` even though the press is now in the host's header rather
   * than in this page — moving the control changed who says it, not what it
   * means. The path still travels, because the heading wants the file's real
   * name and the section's real words either way; this only says which of the
   * two the server may act on.
   *
   * `holdingAt` keeps the rule word for word and applies it to one more case: a
   * pairing found on a rung WIDER than the one the reader is standing on is a
   * decision too, for exactly the reason a widen is. The narrowest rung is the
   * only thing that is not, because it is what the server would have resolved to
   * anyway.
   */
  const decided = holding.decided

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

  /**
   * The paper's files and headings, which the target picker offers instead of a
   * box to spell a section id into.
   *
   * ## Asked for by a press, and held until the reader moves
   *
   * `wanted` is set by the picker opening and by nothing else. The alternative —
   * fetching whenever there is a paper under the reader — would read every file
   * of a thesis on every context, and a context arrives after every selection
   * change anywhere on the canvas. So this costs nothing at all until somebody
   * presses `change`, which is the moment the answer becomes worth having.
   *
   * ## Dropped when the file under the reader changes, and not when the target does
   *
   * The distinction matters and it is the same one the rest of this file keeps.
   * An outline is a fact about the DOCUMENT the reader is in — `file/outline.ts`
   * climbs from that file to find the paper's root — so it goes stale when they
   * open a document belonging to another paper, and not when they hold the list
   * against a different section of the one they are in. Keying this on `target`
   * would re-read seven files every time somebody pressed a heading in the list
   * the read produced.
   *
   * The flag is dropped with it, so the next opening asks again. A picker that
   * opened on the last paper's chapters would be offering targets in a document
   * the reader has left, which is the "remembered place outliving its context"
   * failure `list/scope.ts` refuses.
   */
  const [outline, setOutline] = useState<Outline | null>(null)
  const [wanted, setWanted] = useState(false)
  const onOutline = useCallback(() => setWanted(true), [])
  /** The file under the reader, which is what an outline is a fact about. */
  const reading = at?.path ?? null

  useEffect(() => {
    setOutline(null)
    setWanted(false)
  }, [reading, projectPath])

  useEffect(() => {
    if (!wanted || !reading || !projectPath) return
    let alive = true
    void paperOutline(projectPath, reading)
      .then((got) => {
        if (alive) setOutline(got)
      })
      .catch(() => {
        /* Swallowed to null, which is the same answer as "the fence refused it"
           and draws the same one line. A picker that showed a network error for
           a fetch to its own origin would be reporting on this app's own bug in
           the place a reader is trying to choose a chapter. */
        if (alive) setOutline(null)
      })
    return () => {
      alive = false
    }
  }, [wanted, reading, projectPath])

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
        if (change.op === 'create' || change.op === 'import') {
          /* A list created here is opened here, and so is one copied in. Making
             somebody press the name they have just typed — or the name of the
             list they have just chosen out of another project — is the sort of
             step that reads as the app not having noticed.

             The import screen is put away in the same breath, because the thing
             it was open for has happened. Leaving it up with the copy's source
             still listed would invite a second press and a second copy, which
             would land as `"... (from thesis) 2"` and be nobody's intention. */
          setSession(answer.id)
          setFrom(null)
          setImportable([])
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
   * Ask the host to ask the person which project, then read what is in it.
   *
   * ## Two steps, one press, and nothing in between that this page decides
   *
   * The host draws the dialog and answers with one path or with nothing. Every
   * "nothing" — cancelled, declined, no host at all, a host too old to have
   * heard of the method — comes back the same way and is treated the same way
   * here: the press un-presses and the screen does not change. That is not
   * laziness. The protocol deliberately makes "you have no projects" and "I
   * would rather not" indistinguishable, so a page that drew four different
   * sentences would be guessing at which of them this was, in front of somebody
   * who already knows because they were just looking at the dialog.
   *
   * The read afterwards goes through this app's own door with the picked path on
   * the query, exactly as the open project's read does. A project whose file
   * will not parse comes back as `trouble` and is drawn on the import screen;
   * one with no checklists comes back as an empty list, which is a different
   * sentence and a perfectly ordinary answer.
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
         about that project. It must not go to `storeTrouble`, which is the box
         about the open project's own file — a reader would be told their
         checklists could not be read when it is somebody else's that could
         not. */
      setTrouble(bad)
    } catch {
      /* A fetch to this app's own origin that did not happen. Swallowed to the
         same non-event as a cancellation: there is nothing here a reader can act
         on, and a network error about localhost on the screen where they are
         choosing a project is this app reporting its own bug at them. */
    } finally {
      setChoosing(false)
    }
  }, [pickProject])

  const onImportCancel = useCallback(() => {
    setFrom(null)
    setImportable([])
    setTrouble(null)
  }, [])

  /* Dropped whenever the open project changes. A list of another project's
     checklists is an answer to "what could I copy INTO this one", and the moment
     the reader is moved somewhere else it is an answer to a question nobody
     asked — the same argument `list/scope.ts` makes about a remembered place
     outliving the context that justified it. */
  useEffect(() => {
    setFrom(null)
    setImportable([])
  }, [projectPath])

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
   * Whether anything has happened that a reader needs telling, and if so what —
   * otherwise nothing at all.
   *
   * ## It used to always say something, and that was the fault
   *
   * There were four sentences here and one of them fired in the ordinary case:
   * *"Nothing has been picked for Design yet. What is chosen here is remembered
   * for this kehikko and no other, so a different canvas keeps its own."* Under
   * a heading reading **Pick a checklist**, above the list of them, beside a
   * button that starts one. The user counted the result:
   *
   * > "Checklist also has some redundant lines when no checklist has been picked
   * > yet."
   *
   * They are right, and the interesting half is why that sentence was ever
   * written. It explains the program's own filing — which canvas a choice is
   * remembered against — to somebody whose next act is to press a name. Nothing
   * in it changes what they should press, and the screen already says what to do
   * in its heading and offers exactly two ways to do it.
   *
   * So `null` is the ordinary answer now, and this speaks only when something
   * has happened that a reader cannot see for themselves:
   *
   * - **`listening`** — we have not heard yet, so what is below may be about to
   *   change under them.
   * - **`gone`** — the list they had is not there any more. The sharpest of the
   *   three, and the reason this mechanism survives at all: it answers the
   *   question they are about to ask.
   * - **`unhosted`** — nothing is framing this page, so the pick lasts until a
   *   reload. A fact about what will happen later, which is exactly the kind a
   *   person cannot read off a screen.
   *
   * What is gone is the per-kehikko explanation, and not the behaviour: a pick
   * is still remembered per kehikko — `list/keep.ts` is untouched — and
   * `Unplaced` in `src/view/choose.tsx` still says so in the one case where it
   * is news, which is a canvas with no name to remember anything against.
   */
  const said =
    where === 'listening'
      ? 'Waiting to hear which kehikko this is.'
      : gone
        ? 'That checklist is gone — removed here, or on another machine.'
        : where === 'unhosted'
          ? 'Nothing is framing this page, so this pick lasts until it is reloaded.'
          : null

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
   * `context.filters`, where `grainAt` and `holdingAt` above turn it into the
   * same target the press used to set. What is gone is the row of chrome the
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
  ) : from ? (
    /* Above `chosen` on purpose. Somebody who is mid-import has a list open
       behind them as often as not, and putting this under the open checklist
       would mean pressing Copy and watching nothing happen. It is a screen and
       not an overlay for the reason in `importing.tsx`: at this width the two
       are the same thing, and drawing another project's names where this
       project's names were is what makes the swap legible. */
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
  ) : opened && chosen ? (
      <ChecklistView
        held={opened.held}
        standing={holding.standing}
        targets={opened.targets}
        candidates={candidates}
        narrowed={narrowed}
        outline={outline}
        onOutline={onOutline}
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
      <p
        /* Its own `px-2 py-1.5`, now the shell has none: this is one loose
           sentence with no row and no card under it, and every other line of
           text on this page is inset by exactly this much. */
        className="px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground"
      >
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
        onImport={() => void onImport()}
        importing={choosing}
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
   *
   * ## And no padding on it, which is the other half of removing the card
   *
   * This used to be `p-2`. Together with the card's own border and the `px-2`
   * every row already carries, a line of text on this page started seventeen
   * pixels in from a frame that is often two hundred and twenty pixels wide.
   * Eight of those were spent putting a gap between the host's edge and an edge
   * this module drew itself; one was that edge. Both are gone, the rows keep
   * their own `px-2`, and the reader's text starts at eight — which is exactly
   * where it starts in `kehikko-notes` (no padding on the shell, `px-2` on the
   * blocks inside it) and in `kehikko-learning` on the rungs where it draws no
   * card. The dividers between rows now run the full width of the container,
   * like the host's own.
   *
   * The padding survives in the one place that still needs it: the heading
   * below, which exists ONLY when nothing is framing this page. Unframed there
   * is no container to sit inside, so text against the window edge would be text
   * against the window edge. Framed, that heading is not drawn at all, so the
   * padding is not paid.
   */
  return (
    <div
      ref={setShell}
      className={cn('flex flex-col gap-2 text-foreground', room.pinned && 'h-dvh min-h-0')}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      {framed ? null : (
        <header className="shrink-0 px-2 pt-2">
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

      {/* `mx-2 mt-2` rather than the shell's old padding: this box has a border
          of its own that MEANS something — it is a refusal, marked as one — and
          a bordered box flush against the host's own edge reads as part of the
          host's chrome rather than as something this page is saying. It is drawn
          only when the store could not be read, so the margin is paid on the
          screen nobody wants to be looking at and on no other. */}
      {storeTrouble ? (
        <p className="mx-2 mt-2 shrink-0 rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
          {storeTrouble}
        </p>
      ) : null}

      {where === 'hosted' && !kehikko ? <Unplaced room={room}>{screen}</Unplaced> : screen}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { projectPickResult, type FilterGroup } from 'roadmap-module-protocol'
import {
  PERSON_ANSWERS_WITHIN_MS,
  connect,
  type Connection,
  type HostEvents,
} from 'roadmap-module-protocol/client'
import { pump } from './emit.ts'
import { wearTheme } from './theme.ts'

/**
 * The bridge, as one React value.
 *
 * The wire itself is `roadmap-module-protocol/client` and knows no React; this
 * is the only file that turns messages into state, and it is deliberately the
 * only one. Two places driving "what can this page see" would eventually
 * disagree.
 *
 * ## What used to be underneath this, and where it went
 *
 * `wire/host.ts` and `wire/mailbox.ts` — 418 lines, byte-identical to the copy
 * in eleven sibling modules. They are now one import. Nothing this page says on
 * the wire changed; what changed is that the essays explaining WHY the orderings
 * are what they are live in one place, next to the code that depends on them,
 * instead of in twelve places free to drift apart. Two of those copies had
 * already grown the same two bugs independently.
 *
 * The core client is used here rather than `…/client/react`, and the reason is
 * the state below: this hook flattens the passage to one string, compares a
 * kehikko by id before writing it, and normalises two spellings of "no
 * project" to one. A generic hook that handed back the whole context would make
 * every one of those a thing done downstream, on a fresh object identity every
 * two seconds. The client is a convenience and this is what it looks like to
 * take the half of it that helps.
 *
 * ## What this hook stopped doing, and it is most of what it used to do
 *
 * It used to hold a six-way `Sight` — `listening`, `unhosted`, `no-epic`,
 * `asking`, `refused`, `unread`, `read` — because the page derived checklist
 * items from a tracker reading a host handed over, and those six absences had
 * six different remedies. Nothing is derived any more. There is no `live.get`
 * here, no reading, no epic-change refetch, and no correlation guard on an
 * answer arriving after the epic moved, because no answer is being waited for.
 *
 * What is left is what a context actually carries: which epic is open, which
 * project, where in a document the reader is, what the canvas has picked out,
 * and the theme. Nothing is kept with the host any more: this hook used to read
 * a `state:keep` string carrying which checklist was picked per kehikko, and
 * that pick no longer exists — what is in front of a reader is decided by
 * where they are and what every list is held against (`list/holding.ts`), and
 * a remembered pick would have been a second answer to the same question.
 *
 * ## The grace, and why there is still one
 *
 * A page cannot know at load whether it is framed. It has to wait to find out,
 * because the greeting arrives when the host is ready rather than when we are,
 * and a page that concluded "nobody is there" in the first frame would say so
 * and then be greeted a moment later — the reader would see the standalone
 * paragraph flash past and be replaced, which teaches them that paragraph is
 * noise. So there is a `listening` state with its own words, it lasts under a
 * second, and only then does the page say the harder thing.
 *
 * It is not a spinner. It says what it is waiting for.
 */
const GREETING_GRACE_MS = 700

/**
 * Whether anything is framing this page, in the three states that matter.
 *
 * Three rather than a boolean, because "we have not heard yet" is not "nobody is
 * there": one lasts under a second and the other is the standalone case this app
 * is built to work in. Drawing the second while in the first is the flicker the
 * grace above exists to prevent.
 */
export type Where = 'listening' | 'unhosted' | 'hosted'

/** Which canvas this container is standing on, as the host says it. */
export interface Kehikko {
  id: number
  name: string
}

export interface Roadmap {
  where: Where
  /** The epic the canvas is on, or null. What makes a paper target offerable without typing a slug. */
  epic: string | null
  /**
   * Where the open project is on this machine, or null.
   *
   * The single most load-bearing field this hook reads, now that this app's
   * store lives inside the project: `<projectPath>/.kehikot/checklist/checklists.json`.
   * Every fetch below carries it, and a fetch without it comes back saying there
   * is nowhere to look.
   *
   * Null is a REAL state and not a missing one, twice over: nothing is framing
   * this page, or a host knows the project's NAME and has no folder to point at
   * — a hosted roadmap, a demo, a test harness. Both get a screen saying so
   * rather than a guess, because a guess here means writing somebody's checklist
   * into a repository they will never open. See `src/view/nowhere.tsx`.
   */
  projectPath: string | null
  /**
   * What the open project is CALLED, or null.
   *
   * Read only to put in a sentence. The pair is what makes the "no project"
   * screen able to say something specific: a host that sends a name and no path
   * has told this container which project it is looking at and given it nowhere to
   * open, which is a different sentence from a host that has said nothing at
   * all. Never used to locate anything — a name is not a path, and the protocol
   * says so at length on `projectPath`.
   */
  project: string | null
  /**
   * The kehikko this container is on, or null.
   *
   * Null is a REAL state and not a missing one: a host need not have canvases at
   * all. Nothing on this page is keyed by it any more — the per-kehikko pick
   * went with `list/keep.ts` — and it is carried because a context says it and
   * a later reader of this hook should not have to add it back.
   */
  kehikko: Kehikko | null
  /**
   * What the canvas has picked out, as the host last said it.
   *
   * Never what this page asked for — this page never asks. It declares no
   * `selection:set`, has no control that would set one, and its job is to answer
   * a question about what somebody else picked. A selected reference does two
   * things here: every checklist held against it is in front of the reader, and
   * the edit page offers it as a target to hold a list against.
   */
  selection: string[]
  /**
   * Where in a document the reader is pointing, as the host last said it.
   *
   * The other half of the same question `selection` answers, and new here. A
   * `selection` is a set of tracker references somebody clicked; a `passage` is a
   * file, a place in it and the words that were there. This module reacted to
   * the first and not the second, which is exactly the report this change
   * answers: the container did not move when the reader moved between the files
   * of their thesis, because nothing on this page had ever been told that they
   * had.
   *
   * Held as ONE STRING rather than as the protocol's object, and that is
   * load-bearing rather than tidy. A context arrives after every selection
   * change anywhere on the canvas, and a fresh `{path, from, to, …}` with
   * identical contents each time would be a new identity in every memo and every
   * effect downstream — including the fetch, which would then re-run several
   * times a second while a reader does nothing. A string compares by value, so
   * React bails out of the render when nothing moved. `src/app.tsx` parses it
   * back in one memo.
   *
   * `''` means no document is open, which is the protocol's `passage: null` and
   * is a real state rather than a missing one.
   */
  passage: string
  /**
   * Say what this page can be narrowed by, so the host draws the control.
   *
   * Fire and forget, like `resize`: the host may draw the offer, may draw part
   * of it, or may never have heard of the idea. This page offers NOTHING now,
   * and says so once — see the essay on the empty offer in `src/app.tsx` for
   * why that is a sentence rather than a silence. The client replays the last
   * offer after every greeting, so once is enough.
   */
  filters: (groups: FilterGroup[]) => void
  /** Say how tall this page would like its frame to be. Silent when nothing is framing it. */
  resize: (height: number) => void
  /**
   * Ask the person which project, and be told where it is — or be told no.
   *
   * ## The only way this app will ever learn about a second project
   *
   * A checklist lives in the project it is about, so importing one is
   * inherently cross-project, and this module is told exactly one
   * `projectPath`. It cannot list the projects on this machine, must never
   * grow a way to, and would be a different and much worse program if it
   * could: a module that can ask "what projects exist" has been handed the
   * disk.
   *
   * So it asks the host to ask a person. The host draws the dialog out of its
   * own material and answers with one path, or with nothing. What comes back
   * here is `null` for every no — cancelled, declined, refused, no host at all
   * — because the protocol deliberately makes "there are no projects" and "I
   * would rather not" indistinguishable, and a page that tried to tell them
   * apart would be re-inventing the enumeration one bit at a time. One screen
   * for all of them: nothing was imported, nothing has changed.
   *
   * ## It waits on a person, so it waits longer than anything else here
   *
   * `PERSON_ANSWERS_WITHIN_MS` rather than the wire's ordinary twelve seconds,
   * passed per call rather than set on the connection — a page that waited five
   * minutes on every request to find out the host was gone would be a page that
   * hangs.
   */
  pickProject: () => Promise<{ path: string; name: string } | null>
}

/**
 * What to do when the host says "go to this reference".
 *
 * Handed in rather than handled here, because the answer depends on what is on
 * screen, and that is the view's business. The contract is the protocol's:
 * `answer` must be called, and calling it late is the same as not calling it —
 * see the backstop in `host.ts`.
 */
export type GotoHandler = NonNullable<HostEvents['onGoto']>

export function useRoadmap(id: string, onGoto: GotoHandler, onDoor?: () => void): Roadmap {
  const [where, setWhere] = useState<Where>('listening')
  const [selection, setSelection] = useState<string[]>([])
  const [passage, setPassage] = useState('')
  const [epic, setEpic] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [kehikko, setKehikko] = useState<Kehikko | null>(null)
  const host = useRef<Connection | null>(null)

  /**
   * The handler, held in a ref and read at the moment a `goto` arrives.
   *
   * The view rebuilds this function whenever the rows change, and connecting to
   * the window again on every render would mean a torn-down listener during the
   * one millisecond a host chose to greet in. So the listener is established once
   * and always calls the newest handler — which is also the only one that knows
   * what is currently on screen.
   */
  const goto = useRef(onGoto)
  goto.current = onGoto

  /** The same arrangement, for "an agent came through the MCP door". */
  const door = useRef(onDoor)
  door.current = onDoor

  /** The epic the pump files an announcement under, read at each tick rather than captured. */
  const standingOn = useRef<string | null>(null)

  useEffect(() => {
    /**
     * What the greeting and every later context both do.
     *
     * The theme is applied here rather than in a component, because it is a fact
     * about the document rather than about any part of it: the host says light or
     * dark and the root element carries it — on every context, not only the
     * greeting, because a person changes the mode in a session that is already
     * running. `wearTheme` is the one place that knows what carrying it means;
     * see the essay there for `light` being written down rather than left to the
     * machine, and for the `color-scheme` that decides the scrollbar.
     */
    const arrived = (context: {
      epic: string | null
      project: string | null
      projectPath: string | null
      theme: 'light' | 'dark'
      selection: string[]
      passage: { path: string; page: number | null; from: number | null; to: number | null } | null
      kehikko: Kehikko | null
    }) => {
      wearTheme(document.documentElement, context.theme)

      setWhere('hosted')
      setSelection(context.selection)
      /*
       * Flattened on arrival, for the reason `passage` above gives, and
       * flattened HERE rather than at the one place that reads it — because the
       * whole value of doing it is that the setter is a no-op when nothing
       * moved, and a setter given a fresh object is never a no-op.
       *
       * The spelling is the four fields a target can be derived from, tab
       * separated, in a fixed order. `quoted` is deliberately not among them:
       * this module never re-anchors anything by its words — a tick is filed
       * against a section id, not against a range — so carrying a quote would be
       * carrying a document through a frame for nothing, and would make this
       * string change when only the highlight did.
       */
      const here = context.passage
      setPassage(
        here && typeof here.path === 'string' && here.path
          ? [here.path, here.page ?? '', here.from ?? '', here.to ?? ''].join('\t')
          : '',
      )
      setEpic(context.epic)
      /*
       * Normalised to null the moment it arrives, rather than at each call site.
       *
       * A host that sends `projectPath: ""` — or omits it, against an older
       * protocol — means "there is no project", and so does `null`. Two spellings
       * of one state would eventually be compared two ways in two effects, and
       * the effect that got it wrong would fetch with an empty project and paint
       * an empty container that looked like a project with no checklists.
       *
       * A plain string comparison is enough to make this a no-op when nothing
       * moved, which matters because a context arrives after every selection
       * change anywhere on the canvas and this value is a dependency of the
       * fetch.
       */
      setProjectPath(typeof context.projectPath === 'string' && context.projectPath ? context.projectPath : null)
      setProjectName(typeof context.project === 'string' && context.project ? context.project : null)
      standingOn.current = context.epic
      /*
       * Written unconditionally rather than only when it changed.
       *
       * A context arrives after every selection change anywhere on the canvas,
       * so this runs often, and the old version of this hook was careful to
       * compare before writing — because a write meant throwing away a tracker
       * reading and refetching it. Nothing is refetched now. What these setters
       * cost is a render of a page that is already drawn, and React bails out of
       * one where the value is identical anyway, so a comparison here would be a
       * guard against a cost that no longer exists.
       *
       * The kehikko IS compared, because it is an object: a fresh `{id, name}`
       * with the same id every two seconds would be a new identity in every memo
       * downstream, and the whole point of reading it is to key a stable choice
       * by it.
       */
      setKehikko((was) =>
        was?.id === context.kehikko?.id && was?.name === context.kehikko?.name ? was : context.kehikko,
      )
      /* `context.filters` is deliberately not read. This page offers no filter,
         so any choice a host still holds for this container is one an older
         version of this module asked for, and the empty offer `src/app.tsx`
         sends is what tells the host to let it go. */
    }

    /**
     * The connection is stored BEFORE it is told to listen, and the order is the
     * whole of a bug that made two sibling modules hang forever.
     *
     * `listen()` subscribes to the mailbox, and the mailbox replays what has
     * already arrived SYNCHRONOUSLY, inside that call. The greeting almost always
     * arrives before React mounts — that is the entire reason the mailbox exists
     * — so `onHello` fires on that line. If `connect` also subscribed, it would
     * fire before `host.current` had been assigned, and anything reading
     * `host.current` then finds null and quietly does nothing.
     *
     * Worse, it works often enough to look fine. When the host happens to greet
     * after this effect returns — a slow module, a reload, a busy machine — the
     * assignment has already happened and everything behaves. A race whose good
     * outcome is the common one is the kind that ships.
     *
     * What used to stand here was twenty lines that caught the too-early arrival
     * in a box and replayed it once the assignment was done. It worked, and it
     * was the wrong shape: it fixed one module's copy of a hazard every module
     * had. `connect` and `listen` are two calls now, so the ordering is three
     * plain lines that read in the order they happen, and the protocol package
     * has a test that holds a one-step connect against the same greeting and
     * watches it fail.
     */
    type Context = {
      epic: string | null
      project: string | null
      projectPath: string | null
      theme: 'light' | 'dark'
      selection: string[]
      passage: { path: string; page: number | null; from: number | null; to: number | null } | null
      kehikko: Kehikko | null
    }
    /* The greeting's kept `state` is deliberately not read. A string an older
       version of this module asked the host to keep — which checklist was
       picked on which kehikko — means nothing to this one, and reading it
       would be a page opening on a list nobody asked for today. */
    const live = connect(id, {
      onHello: (context) => arrived(context as Context),
      onContext: (context) => arrived(context as Context),
      onGoto: (message, answer) => goto.current(message, answer),
    })
    host.current = live
    live.listen()

    const grace = setTimeout(() => {
      setWhere((was) => (was === 'listening' ? 'unhosted' : was))
    }, GREETING_GRACE_MS)

    /*
     * Tell the host when an agent comes through this app's MCP door.
     *
     * Started here, with the connection, because it has nothing to say when
     * there is no connection to say it on — see the essay in `emit.ts` for why
     * the door and the wire are in two different processes and need a pump
     * between them at all.
     */
    const stopPump = pump(
      (method, params) => {
        const current = host.current
        if (!current) return Promise.reject(new Error('nothing has greeted this page'))
        return current.request(method, params)
      },
      () => standingOn.current,
      undefined,
      () => door.current?.(),
    )

    return () => {
      stopPump()
      clearTimeout(grace)
      live.stop()
      /* Cleared only if it is still ours. Under StrictMode the second mount has
         already assigned its own connection by the time some cleanups run, and
         a blind `null` here would leave the surviving mount holding nothing. */
      if (host.current === live) host.current = null
    }
  }, [id])

  const resize = useCallback((height: number) => host.current?.resize(height), [])

  /**
   * Ask the host to ask the person which project. See `pickProject` above.
   *
   * The answer is parsed with the protocol's own schema rather than read off
   * the object, for the reason the package itself gives: a module validating
   * what a host sent it is the only side that can. This one is worth the care
   * — what comes back is about to be handed to this app's server as a folder to
   * read — and the parse is what turns a host that answered something odd into
   * "nothing was picked" instead of a path-shaped surprise.
   *
   * Every refusal is `null`, including a rejected promise. A host that has
   * never heard of `projects.pick` answers `unknown-method`, which is a `throw`
   * here, and the honest thing for this page to do about a host too old to be
   * asked is exactly what it does about a person who pressed Cancel.
   */
  const pickProject = useCallback(async (): Promise<{ path: string; name: string } | null> => {
    const live = host.current
    if (!live) return null
    try {
      const answered = await live.request('projects.pick', {}, { within: PERSON_ANSWERS_WITHIN_MS })
      const read = projectPickResult.safeParse(answered)
      if (!read.success || read.data.outcome !== 'picked' || !read.data.project) return null
      return { path: read.data.project.path, name: read.data.project.name }
    } catch {
      return null
    }
  }, [])

  /* Sent unconditionally: a page with no host posts into nothing, which costs
     nothing, and a page that checked first would have to know whether the
     greeting has arrived yet — which is exactly the race the client's own replay
     exists to end. */
  const filters = useCallback((groups: FilterGroup[]) => host.current?.filters(groups), [])

  return useMemo(
    () => ({
      where,
      epic,
      projectPath,
      project: projectName,
      kehikko,
      selection,
      passage,
      resize,
      filters,
      pickProject,
    }),
    [
      where,
      epic,
      projectPath,
      projectName,
      kehikko,
      selection,
      passage,
      resize,
      filters,
      pickProject,
    ],
  )
}

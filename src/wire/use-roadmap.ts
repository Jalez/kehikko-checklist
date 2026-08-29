import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { choose, reading, unchoose, writing, type Kept } from '../../list/keep.ts'
import { connect, type Host, type HostEvents } from './host.ts'
import { pump } from './emit.ts'

/**
 * The bridge, as one React value.
 *
 * `host.ts` is the wire and knows no React; this is the only file that turns
 * messages into state, and it is deliberately the only one. Two places driving
 * "what can this page see" would eventually disagree.
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
 * kehikko this pane is standing on, what the canvas has picked out, and the
 * theme. Plus one new thing, which is the reason `state:keep` is declared.
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

/** Which canvas this pane is standing on, as the host says it. */
export interface Kehikko {
  id: number
  name: string
}

export interface Roadmap {
  where: Where
  /** The epic the canvas is on, or null. What makes a paper target offerable without typing a slug. */
  epic: string | null
  /**
   * The kehikko this pane is on, or null.
   *
   * Null is a REAL state and not a missing one: a host need not have canvases at
   * all, and this module cannot tell where it is standing without being told. It
   * gets its own screen rather than a wrong answer — see `Unplaced` in
   * `src/view/choose.tsx`.
   */
  kehikko: Kehikko | null
  /**
   * What the canvas has picked out, as the host last said it.
   *
   * Never what this page asked for — this page never asks. It declares no
   * `selection:set`, has no control that would set one, and its job is to answer
   * a question about what somebody else picked. Under the new model these are
   * candidate TARGETS: a ref selected on the canvas is a thing a checklist can
   * be held against, and offering it is cheaper and more accurate than asking
   * somebody to type it.
   */
  selection: string[]
  /** Which checklist was last picked, per kehikko, as the host kept it for us. */
  kept: Kept
  /** Remember a pick for one kehikko, or forget it. Silent when nothing is framing this page. */
  remember: (kehikko: number, checklist: string | null) => void
  /** Say how tall this page would like its frame to be. Silent when nothing is framing it. */
  resize: (height: number) => void
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
  const [epic, setEpic] = useState<string | null>(null)
  const [kehikko, setKehikko] = useState<Kehikko | null>(null)
  const [kept, setKept] = useState<Kept>([])
  const host = useRef<Host | null>(null)

  /**
   * The kept list as the sender sees it, beside the state the page renders from.
   *
   * Two holders of one fact is normally the defect this codebase argues against.
   * Here the alternative is worse: `remember` is a stable callback that must not
   * be rebuilt every time the map changes — it is passed to components and used
   * in effects — and a stale closure over `kept` would write a map missing
   * whatever was chosen in between. So the ref is what `remember` reads and the
   * state is what React draws, and they are assigned on the same line every
   * time.
   */
  const held = useRef<Kept>([])

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
     * dark and the root element carries it. `light` is set explicitly as well as
     * `dark`, so that a host asking for light over a machine set to dark actually
     * gets it — see the media query in `index.css`.
     */
    const arrived = (context: {
      epic: string | null
      theme: 'light' | 'dark'
      selection: string[]
      kehikko: Kehikko | null
    }) => {
      const root = document.documentElement
      root.classList.toggle('dark', context.theme === 'dark')
      root.classList.toggle('light', context.theme === 'light')

      setWhere('hosted')
      setSelection(context.selection)
      setEpic(context.epic)
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
    }

    /**
     * The connection is stored BEFORE the greeting is acted on, and the order is
     * the whole of a bug that made a sibling module hang forever.
     *
     * `connect` subscribes to the mailbox, and the mailbox replays what has
     * already arrived SYNCHRONOUSLY, inside that call. The greeting almost always
     * arrives before React mounts — that is the entire reason the mailbox exists
     * — so `onHello` fires on this line, before `host.current` has been assigned.
     * Anything reading `host.current` then finds null and quietly does nothing.
     *
     * Worse, it works often enough to look fine. When the host happens to greet
     * after this effect returns — a slow module, a reload, a busy machine — the
     * assignment has already happened and everything behaves. A race whose good
     * outcome is the common one is the kind that ships.
     *
     * So anything that fires too early is held and delivered the moment the
     * assignment is done. Not deferred to a microtask: that would fix the symptom
     * and leave the next reader to work out why the order mattered.
     */
    type Context = { epic: string | null; theme: 'light' | 'dark'; selection: string[]; kehikko: Kehikko | null }
    type Arrival = [context: Context, state: string | null | undefined]
    let ready = false
    /* A box rather than a bare `let`, and only because of the compiler: this is
       assigned inside a callback that `connect` invokes, which the flow analysis
       cannot see, so a plain variable is narrowed to `null` for the rest of this
       function and the replay below stops type-checking. */
    const early: { arrival: Arrival | null } = { arrival: null }
    const deliver = (context: Context, state: string | null | undefined) => {
      /* The kept string arrives ONLY in the greeting, and is read before the
         context is applied so the first render already has the remembered
         choice. A page that drew the pick screen and then replaced it with the
         remembered list would be teaching the reader that the pick screen is
         noise — the same argument as the greeting grace above. */
      if (state !== undefined) {
        const was = reading(state)
        held.current = was
        setKept(was)
      }
      arrived(context)
    }
    const heldEarly = (...arrival: Arrival) => {
      if (ready) deliver(...arrival)
      else early.arrival = arrival
    }

    host.current = connect(id, {
      onHello: (context, state) => heldEarly(context as Context, state),
      onContext: (context) => heldEarly(context as Context, undefined),
      onGoto: (message, answer) => goto.current(message, answer),
    })
    ready = true
    if (early.arrival) deliver(...early.arrival)

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
      host.current?.stop()
      host.current = null
    }
  }, [id])

  /**
   * Remember which checklist was picked on one kehikko, or forget it.
   *
   * Fire and forget, deliberately. A host may refuse `state.set` — it is a
   * declared capability and a declaration is not a request — and the correct
   * response to a refusal is that the choice holds for this session and is
   * asked for again next time. Blocking the pick on a round trip, or drawing a
   * failure beside it, would make a page's most ordinary action wait on
   * somebody else's storage.
   */
  const remember = useCallback((canvas: number, checklist: string | null) => {
    const next = checklist === null ? unchoose(held.current, canvas) : choose(held.current, canvas, checklist)
    held.current = next
    setKept(next)
    void host.current?.request('state.set', { state: writing(next) }).catch(() => {
      /* Reported nowhere on purpose. See above: a refused keep is a choice that
         lasts the session, which is a state this page is already correct in. */
    })
  }, [])

  const resize = useCallback((height: number) => host.current?.resize(height), [])

  return useMemo(
    () => ({ where, epic, kehikko, selection, kept, remember, resize }),
    [where, epic, kehikko, selection, kept, remember, resize],
  )
}

import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  LIMITS,
  dispositionSchema,
  projectPickResult,
  trackerReadingResult,
  type Disposition,
  type FilterGroup,
  type TrackerReading,
} from 'kehikot-module-protocol'
import { PERSON_ANSWERS_WITHIN_MS, type HostEvents } from 'kehikot-module-protocol/client'
import { useHost, type Host } from 'kehikot-module-protocol/client/react'

import { pump } from './emit.ts'
import { flattenParts } from '../../list/focus.ts'

/**
 * The bridge, as one React value: the protocol's `useHost`, and this module's own on top of it.
 *
 * ## What is underneath now
 *
 * The connection, the grace before deciding nobody is there, the theme on `<html>` (both classes
 * spelled, which with `index.css` is also the `color-scheme` the browser's own chrome follows),
 * and a stable `request` are `kehikot-module-protocol/client/react`. This file used to do all of
 * that by hand; see the protocol's docs/module-plumbing.md.
 *
 * ## What stays here, and why
 *
 * - **Every field of the context as a validated STRING.** A context arrives after every change
 *   anywhere on the canvas, as fresh objects each time, and this page's reads depend on what it
 *   says. A string is compared by value, so an effect that depends on one runs when the canvas
 *   moved and not when it merely spoke: the passage, the containers, the filter choice, the
 *   tracker's signal, the dispositions and the parts (`flattenParts` / `partsOf`) are each
 *   flattened here, once, from the context `useHost` hands over.
 * - **The announcements pump** (`wire/emit.ts`): what an agent did over this app's MCP door,
 *   emitted to the host as events, through the hook's `request`.
 * - **What this page asks the host**: `projects.pick` for an import, and `tracker.get` for what
 *   the trackers say about the refs the lists are held against — to be drawn beside them and kept
 *   on a tick as evidence, never to tick anything (Jalez/kehikko-checklist#1).
 *
 * Nothing is kept with the host: what is in front of a reader is decided by where they are and
 * what every list is held against (`list/holding.ts`), and a remembered pick would be a second
 * answer to the same question. So the greeting's kept `state` is deliberately not read.
 */

/** Whether anything is framing this page: `listening` for under a second, then `unhosted`, or `hosted`. */
export type Where = Host['where']


/** Which canvas this container is standing on, as the host says it. */
export interface Kehikko {
  id: number
  name: string
}

export interface Kehikot {
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
   * — a Kehikot host, a demo, a test harness. Both get a screen saying so
   * rather than a guess, because a guess here means writing somebody's checklist
   * into a repository they will never open. The page draws the shared no-project cover for it.
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
  selection: readonly string[]
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
   * Every container on the kehikko, whether it is picked out, and what it says
   * it is showing, as the host last said it — flattened to ONE STRING, for the
   * reason `passage` is: a context arrives after every change anywhere on the
   * canvas, and a fresh array of fresh rows each time would re-run the fetch
   * below several times a second while a reader does nothing. `shown` in
   * `src/store/ask.ts` inflates it once, in one memo.
   *
   * `''` is no containers: nothing is framing this page, or a host too old to
   * say. Both are answered the same way — everything the page always showed,
   * and no control offered — see `list/aim.ts`.
   *
   * Read structurally rather than through the protocol's type, so that this
   * page typechecks against a copy of the package from before the field
   * existed and simply finds nothing there. That is also what the wire does:
   * an older client strips the field before this page sees it.
   */
  containers: string
  /**
   * Which of the filters this page offered are chosen for THIS container, as
   * the host last said — as one string, for the reason everything above is.
   * `list/aim.ts` reads it leniently, because the greeting carries a remembered
   * choice before this page has said what it offers, and an option this
   * version does not know falls back to following the picks.
   */
  chosen: string
  /**
   * Say what this page can be narrowed by, so the host draws the control.
   *
   * Fire and forget, like `resize`: the host may draw the offer, may draw part
   * of it, or may never have heard of the idea. This page offers ONE group,
   * and only when the host lists containers — see `aimOffer` in `list/aim.ts`
   * — and re-offers it whenever the count in its label changes. The client
   * replays the last offer after every greeting.
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
  /**
   * When the host's shared tracker reading last changed, as the context says,
   * or `''` when it has never been read or the host does not say.
   *
   * A string, for the reason `passage` is one: it is a dependency of the read
   * below, and a context arrives after every change anywhere on the canvas.
   * This is the whole of `reacts: ['tracker']` — when it moves, the page asks
   * `tracker.get` again, and a ref that came back `pending` is found.
   */
  trackerAt: string
  /** Whether the host is reading the trackers right now. Said on the page, never waited on. */
  trackerReading: boolean
  /**
   * The marks people put on why a ref closed, `context.dispositions`, as one
   * string for the reason everything above is one. `marksOf` reads it back.
   * A person's mark beats the tracker's reason; see `dispositionOf` in the
   * protocol's facets.
   */
  marks: string
  /**
   * `context.parts`: every part of the open epic, the picked ones flagged, as
   * one string for the reason everything above is one. `partsOf` in
   * `list/focus.ts` reads it back.
   *
   * `''` is no parts: nothing is framing this page, the epic is not divided,
   * or the host has never heard of them — all three mean the whole epic is in
   * front. This is the whole of `reacts: ['parts']`: when the picked parts
   * change the string changes, and the reading page puts aside the lists held
   * against references outside them and says how many. There is no setter;
   * picking a part is the host's own control.
   */
  parts: string
  /**
   * Ask the host what the trackers last said about these refs, with the
   * detail a checklist is checked against — description, files, head commit,
   * approvals. Null for every no: no host, a host too old to know the method,
   * a person who did not grant `trackers:read`, an answer that does not parse.
   * The page draws nothing from the tracker then, which is what it drew before.
   *
   * Answered at once by the host, from what it holds. A ref it has not read
   * yet comes back in `missing` as `pending`, and `trackerAt` moves when the
   * read lands.
   */
  readTracker: (refs: readonly string[]) => Promise<TrackerReading | null>
}

/** The marks back out of `Kehikot.marks`, each parsed; a row that does not parse is left out. */
export function marksOf(marks: string): Disposition[] {
  if (!marks) return []
  try {
    const parsed: unknown = JSON.parse(marks)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((one) => {
      const read = dispositionSchema.safeParse(one)
      return read.success ? [read.data] : []
    })
  } catch {
    return []
  }
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

export function useKehikot(id: string, onGoto: GotoHandler, onDoor?: () => void): Kehikot {
  const host = useHost(id, { onGoto }, { reloadWhenStale: false })
  const { where, context, epic, projectPath, project, kehikko, selection, request, resize, filters } = host

  /* The doorbell, read through a ref so the pump below is started once and always rings the newest one. */
  const door = useRef(onDoor)
  door.current = onDoor

  /* The epic the canvas is on, for the pump: an announcement that names none of its own is filed
     under this one, and it is read at the moment of emitting rather than captured at mount. */
  const standingOn = useRef<string | null>(null)
  standingOn.current = epic

  /*
   * The pump: this app's own outbox, emitted to the host as events. Started once for the life of
   * the page and stopped with it. `request` is the hook's and is stable; with nothing greeting
   * the page it refuses, which the pump reports and does not retry.
   */
  useEffect(
    () =>
      pump(
        (method, params) => request(method, params),
        () => standingOn.current,
        undefined,
        () => door.current?.(),
      ),
    [request],
  )

  /* Each of these is a string, so what depends on it moves when the canvas moved. See the essay at the top. */
  const here = context?.passage ?? null
  const passage =
    here && typeof here.path === 'string' && here.path ? [here.path, here.page ?? '', here.from ?? '', here.to ?? ''].join('\t') : ''
  const containers = useMemo(() => flattenContainers(context?.containers), [context])
  const chosen = useMemo(() => flattenChoice(context?.filters), [context])
  const signal = (typeof context?.tracker === 'object' && context.tracker !== null ? context.tracker : {}) as {
    at?: unknown
    refreshing?: unknown
  }
  const trackerAt = typeof signal.at === 'string' ? signal.at : ''
  const trackerReading = signal.refreshing === true
  const marks = useMemo(
    () => (Array.isArray(context?.dispositions) && context.dispositions.length ? JSON.stringify(context.dispositions) : ''),
    [context],
  )
  /* The parts of the epic, on every context: moving to another epic sends that epic's parts with
     nothing picked in the same message, and a page that kept the last epic's focus would go on
     hiding lists for it. */
  const parts = useMemo(() => flattenParts(context?.parts), [context])

  const pickProject = useCallback(async (): Promise<{ path: string; name: string } | null> => {
    try {
      const answered = await request('projects.pick', {}, { within: PERSON_ANSWERS_WITHIN_MS })
      const read = projectPickResult.safeParse(answered)
      if (!read.success || read.data.outcome !== 'picked' || !read.data.project) return null
      return { path: read.data.project.path, name: read.data.project.name }
    } catch {
      return null
    }
  }, [request])

  /* See `readTracker` above. Bounded to what one ask may name; the page asks
     for the refs its lists are held against, which is rarely more than a few. */
  const readTracker = useCallback(
    async (refs: readonly string[]): Promise<TrackerReading | null> => {
      if (!refs.length) return null
      try {
        const answered = await request('tracker.get', { refs: refs.slice(0, LIMITS.TRACKER_ASK), detail: 'detail' })
        const read = trackerReadingResult.safeParse(answered)
        return read.success ? read.data : null
      } catch {
        return null
      }
    },
    [request],
  )

  return useMemo(
    () => ({
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
      readTracker,
    }),
    [
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
      readTracker,
    ],
  )
}

/**
 * The host's containers as one string, or `''`.
 *
 * Only what this page reads survives the flattening: the module, the flag,
 * the refs, and each document as the same tab-separated four fields the
 * passage travels as. The quote is dropped here as it is for the passage, and
 * for the same reason — this page never re-anchors anything by its words.
 */
function flattenContainers(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  const rows = value.flatMap((one) => {
    if (typeof one !== 'object' || one === null) return []
    const row = one as { module?: unknown; selected?: unknown; showing?: unknown }
    if (typeof row.module !== 'string' || !row.module) return []
    const showing = (typeof row.showing === 'object' && row.showing !== null ? row.showing : {}) as {
      refs?: unknown
      documents?: unknown
    }
    const refs = Array.isArray(showing.refs) ? showing.refs.filter((r): r is string => typeof r === 'string') : []
    const documents = Array.isArray(showing.documents)
      ? showing.documents.flatMap((d) => {
          const doc = d as { path?: unknown; page?: unknown; from?: unknown; to?: unknown } | null
          if (!doc || typeof doc.path !== 'string' || !doc.path) return []
          return [[doc.path, doc.page ?? '', doc.from ?? '', doc.to ?? ''].join('\t')]
        })
      : []
    return [{ module: row.module, selected: row.selected === true, refs, documents }]
  })
  return rows.length ? JSON.stringify(rows) : ''
}

/** The choice as one string with its keys in a fixed order, so equal choices compare equal. */
function flattenChoice(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : ''
}

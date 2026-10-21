import { MODULE_ID } from 'kehikot-module-protocol'

/**
 * What is in front of the reader, once the kehikko can say what each of its
 * containers is showing and which of them are picked out.
 *
 * ## The sentence this file implements
 *
 * > "Lets say we have multiple things in kehikko that can have a checklist for
 * > instance and they all have different checklists. Obviously we should be
 * > able to show both items checklists. And if user selects x number of the
 * > modules then we should only show those modules checklist no?"
 *
 * Two halves, and this file is both. The FIRST is that a container is in front
 * of the reader when anything on the canvas is showing it: the paper's chapter,
 * the journey's step, the reference somebody clicked in a list — all at once,
 * not whichever one spoke last. The SECOND is that when a person has picked
 * containers out — the box in each container's header, the ring the host draws
 * — only what THOSE containers show is in front, and the rest is put aside.
 *
 * ## Where the facts come from, and what each is worth
 *
 * `context.containers` is the host's list: every container on the kehikko,
 * whether it is picked out, and what it says it is showing. The picking-out is
 * the host's own fact. What a container shows is that container's word, which
 * the host relays and cannot check — and which, for a module that has only ever
 * called `passage.set`, the host fills in from the passage that module set.
 * `context.passage` and `context.selection` are still there and still mean
 * what they meant: the reader's finger, and the person's pick.
 *
 * The rule, which the protocol's essay on `context.containers` states once so
 * that three consumers do not state it three ways:
 *
 *   - Nobody picked out, or the narrowing turned off: everything. The passage,
 *     the selection, and the union of what every container shows.
 *   - Some picked out: the union of what those show, and nothing else.
 *
 * "Nothing picked out" is deliberately EVERYTHING and not nothing. A person who
 * has ticked no boxes has not asked for an empty pane; they have not narrowed.
 *
 * ## Picked parts say it first
 *
 * All of the above is a reading of what the canvas happens to be showing,
 * made when nobody has said. A part picked in the host's bar is somebody
 * saying: the workspace is pointed at those parts, and the lists in front are
 * the ones held against their files and references. So while a part is picked
 * and no container is picked out, the passage and what the containers show
 * are not what the paper's lists are asked by — `byParts` — and the page asks
 * for every list of the epic's paper, and narrows that by the protocol's
 * rule (`list/focus.ts` has each list's anchor).
 *
 * It used to be the other way round — the passage and the containers first,
 * the parts never — and the page inherited whatever the paper beside it last
 * said. A paper that somebody else walked to a passage says nothing new until
 * a person touches it, so a pick of another chapter left the old chapter's
 * list on screen; a collapsed paper says nothing at all; and a paper showing
 * two picked parts has its caret in one of them.
 *
 * A container somebody picked out still narrows, and the parts are then
 * applied to what it shows: the box in a container's header is as deliberate
 * as a pick in the bar. References are unchanged by any of this — the ones in
 * front are still the selection and what the containers show.
 *
 * ## Narrowing hides things, so narrowing says what it hid
 *
 * A container that goes empty because a neighbour was ticked is a container
 * whose emptiness has no visible cause, and that is the failure this workspace
 * keeps finding. So what comes back names the picked-out containers, and names
 * separately the ones that are picked out and showing nothing — "Journeys is
 * picked out and has said nothing about what it shows" is a different sentence
 * from "no checklist is held against what Journeys shows", and sends a person
 * to a different place. The control that turns the narrowing off lives in the
 * container header, offered to the host over `kehikot.filters`, so the way out
 * is one press in the place every module in this family keeps its filters.
 *
 * ## An older host
 *
 * A host that has never heard of `context.containers` sends none, and this
 * file answers as the page always did: the passage and the selection. No
 * control is offered, because there is nothing to turn off. The page is the
 * page it was.
 *
 * Pure. Strings and small records in, strings and small records out, so
 * `test/aim.test.ts` is a table of canvases.
 */

/** A place in a document, as the wire carries one and as this app spells it back onto a request. */
export interface Place {
  path: string
  from: number | null
  to: number | null
}

/** One container on the kehikko, as this page reads the host's list. */
export interface Shown {
  module: string
  selected: boolean
  refs: string[]
  documents: Place[]
}

/**
 * Which way the reader wants it: following the picks, or everything on the
 * kehikko whatever is picked.
 *
 * The filter group's id and its two options, spelled once. `follow` is the
 * resting option — it is what "nothing picked out" already means, and what a
 * person who ticks a box expects to happen — and `all` is the way out for
 * somebody who picked containers for an agent's sake and still wants every
 * list in front of them.
 */
export const AIM = 'aim'
export type Aim = 'follow' | 'all'

/** The choice out of `context.filters`, read leniently: anything that is not `all` is following. */
export function aimOf(chosen: Readonly<Record<string, string>> | null | undefined): Aim {
  return chosen && Object.hasOwn(chosen, AIM) && chosen[AIM] === 'all' ? 'all' : 'follow'
}

export interface InFront {
  /** Every reference in front of the reader, in the order the canvas gave them, once each. */
  refs: string[]
  /** Every place in a document in front of the reader, the reader's own passage first, once each. */
  documents: Place[]
  /** Whether the picks narrowed this: some container is picked out and the reader is following. */
  narrowed: boolean
  /**
   * Whether the whole paper is in front — the rung a list held against the
   * epic with no section sits on.
   *
   * True whenever nothing narrows: an epic open is the paper open, which is
   * what the page has always shown. False when the picks narrow to containers
   * none of which shows a place in a document — a journeys pane picked out
   * alone is not showing the paper, and the whole-thesis list appearing under
   * it would be the page deciding that every container is about the paper
   * because the kehikko is. Measured rather than reasoned about: it did
   * exactly that on the first live run.
   */
  paper: boolean
  /**
   * Whether the picked parts decide which of the paper's lists are in front:
   * a part is picked and no container narrows. `documents` is empty then, and
   * the page asks for the whole of the epic's paper. See "Picked parts say it
   * first" above.
   */
  byParts: boolean
  /** The picked-out containers, in the canvas's order. Empty when nothing is picked out. */
  picked: string[]
  /** Every container's module, picked out or not, once each: the modules a list can be put aside FOR. */
  modules: string[]
  /** Those of them that show nothing at all — refs or documents — and so cannot have a list in front. */
  quiet: string[]
}

/**
 * What is in front of the reader.
 *
 * `passage` and `selection` are the canvas's own two fields; `containers` is
 * the host's list; `aim` is what the person chose in the header. The reader's
 * own passage leads the documents and the canvas's selection leads the refs
 * when nothing narrows, for the reason `showing` in `list/holding.ts` puts a
 * selected reference first: the thing somebody has their finger on is the
 * loudest statement there is about what they are looking at.
 */
export function inFrontOf(input: {
  passage: Place | null
  selection: readonly string[]
  containers: readonly Shown[]
  aim: Aim
  /** Whether a part of the epic is picked in the host's bar. See "Picked parts say it first" above. */
  focused?: boolean
}): InFront {
  const { passage, selection, containers, aim } = input
  const picked = containers.filter((one) => one.selected)
  const narrowed = aim === 'follow' && picked.length > 0
  const byParts = input.focused === true && !narrowed
  const from = narrowed ? picked : containers

  const refs = dedupe([...(narrowed ? [] : selection), ...from.flatMap((one) => one.refs)])
  const documents = byParts
    ? []
    : dedupePlaces([...(narrowed || !passage ? [] : [passage]), ...from.flatMap((one) => one.documents)])

  return {
    refs,
    documents,
    narrowed,
    paper: !narrowed || documents.length > 0,
    byParts,
    picked: picked.map((one) => one.module),
    modules: dedupe(containers.map((one) => one.module)),
    quiet: picked.filter((one) => one.refs.length === 0 && one.documents.length === 0).map((one) => one.module),
  }
}

/**
 * The offer this page makes to the host, given what the host said.
 *
 * Nothing at all when the host lists no containers — an older host, or a page
 * that is not framed — because there is nothing the control could turn off,
 * and a control that changes nothing teaches a person that the control does
 * not work. Otherwise one group with two options, and the count in the label,
 * because the protocol puts counts in labels on purpose: a host cannot count
 * what it does not render, and "follow what is picked out (2 of 5)" is the
 * only place the number appears without a press.
 */
export function aimOffer(containers: readonly Shown[]): { id: string; label: string; options: { id: string; label: string }[]; fallback: string }[] {
  if (!containers.length) return []
  const picked = containers.filter((one) => one.selected).length
  const count = picked ? `${picked} of ${containers.length} picked out` : 'nothing picked out'
  return [
    {
      id: AIM,
      label: 'aim',
      options: [
        { id: 'follow', label: `follow what is picked out (${count})` },
        { id: 'all', label: 'everything on this kehikko' },
      ],
      fallback: 'follow',
    },
  ]
}

/**
 * The sentence for an empty reading page, when the picks are what emptied it.
 *
 * Null when the picks did not narrow anything — then the page's own two
 * sentences apply, unchanged. Otherwise it names the containers, and names the
 * ones that show nothing, because those two absences have two remedies: hold a
 * list against what a container shows, or pick out a container that shows
 * something. Names are module ids' last words — `journeys`, `paper` — which is
 * what the ids look like in practice, with nothing invented.
 */
export function whyEmpty(front: InFront, aside: readonly string[] = []): string | null {
  if (!front.narrowed) return null
  const names = front.picked.map(nameOf)
  const quiet = front.quiet.map(nameOf)
  const who = list(names)
  /* A third absence, with a third remedy: lists ARE held against what is shown,
     and they are about another module's work. `aside` is `forPicked`'s. */
  if (aside.length) {
    const others = list(aside.map(nameOf))
    return `${who} ${names.length === 1 ? 'is' : 'are'} picked out; the checklists held against what ${names.length === 1 ? 'it shows' : 'they show'} are for ${others}.`
  }
  if (quiet.length === front.picked.length) {
    return `${who} ${names.length === 1 ? 'is' : 'are'} picked out and ${names.length === 1 ? 'shows' : 'show'} nothing a checklist can be held against.`
  }
  const tail = quiet.length ? ` ${list(quiet)} ${quiet.length === 1 ? 'shows' : 'show'} nothing.` : ''
  return `${who} ${names.length === 1 ? 'is' : 'are'} picked out; no checklist is held against what ${names.length === 1 ? 'it shows' : 'they show'}.${tail}`
}

/**
 * The refs somebody clicked that this pane is NOT showing, because the picks
 * narrow it (Jalez/kehikko-checklist#32).
 *
 * The rule stays as it is — "some picked out: the union of what those show,
 * and nothing else" — and the selection is set aside while containers are
 * picked out. What this adds is that the setting-aside is SAID: a click that
 * leaves the pane as it was, with nothing on it saying why, looks like a pane
 * that does not work, and the cause is a tick in another container's header
 * that may have been put there long ago or for an agent's sake.
 *
 * Null when nothing narrows, or when every clicked ref is in front anyway
 * because a picked container shows it too. Otherwise those refs and the
 * picked-out containers, whether or not those containers have lists.
 */
export function setAside(front: Pick<InFront, 'narrowed' | 'refs' | 'picked'>, selection: readonly string[]): { refs: string[]; picked: string[] } | null {
  if (!front.narrowed) return null
  const refs = dedupe(selection.filter((ref) => !front.refs.includes(ref)))
  return refs.length ? { refs, picked: [...front.picked] } : null
}

/** The line for refs set aside: what was clicked, what is picked out, and what the pane shows instead. */
export function clickedLine(aside: { refs: readonly string[]; picked: readonly string[] }): string {
  const one = aside.picked.length === 1
  return (
    `You clicked ${list(aside.refs)}, but ${list(aside.picked.map(nameOf))} ${one ? 'is' : 'are'} picked out, `
    + `so this shows what ${one ? 'that container shows' : 'those containers show'}.`
  )
}

/**
 * Where to unpick the containers, in words: a container's pick is the host's
 * own control and no method moves it, so the way out is named, not pressed.
 */
export function unpickLine(picked: readonly string[]): string {
  const one = picked.length === 1
  return `To unpick ${list(picked.map(nameOf))}, untick the box in ${one ? 'its header' : 'their headers'}.`
}

/** The last word of a module id, which is what the ids look like: `kehikot.journeys` is `journeys`. */
export function nameOf(module: string): string {
  const cut = module.lastIndexOf('.')
  return cut === -1 ? module : module.slice(cut + 1)
}

/**
 * The lists left in front once the picked-out containers say whose work is
 * being looked at.
 *
 * A list may say which module's work it is for (`for` in `list/checklists.ts`).
 * Several modules show the same place in a paper, so the place cannot say which
 * of their lists a person means; the container they picked out can. While
 * containers are picked out and followed, a list for one module's work is in
 * front only if that module is among them.
 *
 * A list that names no module is every module's and is never put aside here,
 * which is every list written before a list could say. And with nothing picked
 * out nothing is put aside either, for the reason at the top of this file:
 * "nothing picked out" is everything, and the row says whose work each list is
 * for.
 *
 * ## A list is put aside FOR a module that is here, and never for a name
 *
 * What a list says and what the canvas says are read in one form
 * (`moduleNamed`): an id stored before the rename, or the short name a row
 * prints, is the module it means. And a list is put aside only when the module
 * it is for is ON this kehikko and not picked out. One that is for a module no
 * container here belongs to — a typo, a module since removed — stays in front
 * under every pick: put aside, there would be no pick that brought it back.
 *
 * `aside` is the modules whose lists were put aside, once each, for the
 * sentence the page says about them. With nothing put aside the instances come
 * back as they went in — the same array.
 *
 * Generic over the instance for that file's reason too: this needs to know a
 * list may be for a module and nothing else about one.
 */
export function forPicked<T extends { checklist: { for?: string } }>(
  instances: readonly T[],
  front: Pick<InFront, 'narrowed' | 'picked' | 'modules'>,
): { instances: readonly T[]; aside: string[] } {
  if (!front.narrowed) return { instances, aside: [] }
  const here = front.modules
  const picked = front.picked
  const whose = (one: T) => {
    const module = one.checklist.for === undefined ? null : moduleNamed(one.checklist.for, here)
    return module !== null && here.includes(module) && !picked.includes(module) ? module : null
  }
  const aside = dedupe(instances.flatMap((one) => whose(one) ?? []))
  return aside.length ? { instances: instances.filter((one) => whose(one) === null), aside } : { instances, aside }
}

/**
 * The module id somebody meant by `said`, or null when it is not one.
 *
 * The one form module ids are stored and compared in. Two spellings arrive:
 * the id as the host spells it, and the short name this app prints on a row —
 * `screenplay` — which is what a person or an agent reads and types back. The
 * short name is the module it names when exactly one of `present` ends in it.
 * Anything else has only to be shaped like a module id: a list may be for a
 * module that is not here today.
 */
export function moduleNamed(said: string, present: readonly string[]): string | null {
  const id = said.trim()
  const here = present
  if (here.includes(id)) return id
  const short = dedupe(here.filter((one) => nameOf(one) === id))
  if (short.length === 1) return short[0] as string
  return MODULE_ID.test(id) ? id : null
}

/**
 * What each module is called where one is picked from a list: its short name,
 * and its id beside it when two of them share that name.
 */
export function moduleLabels(modules: readonly string[]): { id: string; label: string }[] {
  const ids = dedupe(modules)
  const shared = (id: string) => ids.filter((one) => nameOf(one) === nameOf(id)).length > 1
  return ids.map((id) => ({ id, label: shared(id) ? `${nameOf(id)} (${id})` : nameOf(id) }))
}

/**
 * What is said about lists put aside while others ARE in front.
 *
 * `whyEmpty` speaks only when nothing is left, in the pane that would
 * otherwise be blank. With lists left there is no blank pane and so no line:
 * a row about what is not drawn takes the room from what is. This is the hint
 * on the page's "All checklists" control instead — how many, whose, and that
 * the control leads to them — which costs no space at all.
 */
export function whyAside(count: number, aside: readonly string[]): string | null {
  if (count <= 0 || !aside.length) return null
  const one = count === 1
  return (
    `${count} more checklist${one ? ' is' : 's are'} held here and put aside: ${one ? 'it is' : 'they are'} for `
    + `${list(aside.map(nameOf))}. This lists ${one ? 'it' : 'them'} with every other checklist.`
  )
}

function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  const all = [...names]
  const last = all.pop()
  return `${all.join(', ')} and ${last}`
}

function dedupe(refs: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of refs) {
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    out.push(ref)
  }
  return out
}

function dedupePlaces(places: readonly Place[]): Place[] {
  const seen = new Set<string>()
  const out: Place[] = []
  for (const one of places) {
    if (!one.path) continue
    const key = `${one.path}\t${one.from ?? ''}\t${one.to ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(one)
  }
  return out
}

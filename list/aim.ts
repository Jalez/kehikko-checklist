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
 * ## Narrowing hides things, so narrowing says what it hid
 *
 * A container that goes empty because a neighbour was ticked is a container
 * whose emptiness has no visible cause, and that is the failure this workspace
 * keeps finding. So what comes back names the picked-out containers, and names
 * separately the ones that are picked out and showing nothing — "Journeys is
 * picked out and has said nothing about what it shows" is a different sentence
 * from "no checklist is held against what Journeys shows", and sends a person
 * to a different place. The control that turns the narrowing off lives in the
 * container header, offered to the host over `roadmap.filters`, so the way out
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
  /** The picked-out containers, in the canvas's order. Empty when nothing is picked out. */
  picked: string[]
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
}): InFront {
  const { passage, selection, containers, aim } = input
  const picked = containers.filter((one) => one.selected)
  const narrowed = aim === 'follow' && picked.length > 0
  const from = narrowed ? picked : containers

  const refs = dedupe([...(narrowed ? [] : selection), ...from.flatMap((one) => one.refs)])
  const documents = dedupePlaces([...(narrowed || !passage ? [] : [passage]), ...from.flatMap((one) => one.documents)])

  return {
    refs,
    documents,
    narrowed,
    picked: picked.map((one) => one.module),
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
export function whyEmpty(front: InFront): string | null {
  if (!front.narrowed) return null
  const names = front.picked.map(nameOf)
  const quiet = front.quiet.map(nameOf)
  const who = list(names)
  if (quiet.length === front.picked.length) {
    return `${who} ${names.length === 1 ? 'is' : 'are'} picked out and ${names.length === 1 ? 'shows' : 'show'} nothing a checklist can be held against.`
  }
  const tail = quiet.length ? ` ${list(quiet)} ${quiet.length === 1 ? 'shows' : 'show'} nothing.` : ''
  return `${who} ${names.length === 1 ? 'is' : 'are'} picked out; no checklist is held against what ${names.length === 1 ? 'it shows' : 'they show'}.${tail}`
}

/** The last word of a module id, which is what the ids look like: `roadmap.journeys` is `journeys`. */
export function nameOf(module: string): string {
  const cut = module.lastIndexOf('.')
  return cut === -1 ? module : module.slice(cut + 1)
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

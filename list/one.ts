import { nameOf, type Place, type Shown } from './aim.ts'
import { NOTHING_PICKED } from './standing.ts'

/**
 * EXACTLY ONE thing the reading page shows checklists for.
 *
 * ## What the person said
 *
 * > "It should ONLY show the checklist for the module that's currently picked, or in the case of
 * > References, only the referenced item that is picked."
 *
 * The page used to show a union: the paper the Paper module was on ("traceable-failure-references ·
 * 1/3") AND the item References had picked ("No checklist applies to !4233 …"), both at once,
 * because both were "in front". Now one is, and the footer says which and why:
 *
 * 1. **A container picked as a target on the kehikko** (the box in its header): the target is that
 *    container's subject — what it says it shows. For References, its picked item; for Paper, its
 *    paper. Several picked: the one picked most recently (this page saw it become picked); before
 *    it has seen one become picked, the first in the canvas's order. A picked container that shows
 *    nothing has no target, and the page says so rather than falling back to another.
 * 2. **Nothing picked**: the most recently picked or selected thing — a ref somebody clicked (the
 *    canvas's selection), or the place in a document a reader moved to (the passage). Whichever
 *    changed last; a click wins a tie.
 * 3. **Neither**: nothing, and the page says how to pick something. Never several.
 *
 * "Most recently" is something only a page that watches can know, so it is this page's memory
 * (`Recent`), handed back in and out; the host keeps no history of picks. Pure.
 */

/** The one target, and where it came from. */
export type One =
  | { kind: 'ref'; ref: string; from: Source }
  | {
      kind: 'place'
      /** The place that names it: the reader's passage, or the first place the container shows. */
      place: Place
      /**
       * Every place the container it came from shows — a paper says it shows each of its files — with
       * the passage first: ONE target, the paper, read wherever in it a list is held.
       */
      places: Place[]
      from: Source
    }

/** Why the target is this one: picked as a container, clicked on the canvas, or where the reader is. */
export type Source =
  | { by: 'picked'; module: string }
  | { by: 'selected' }
  | { by: 'reading'; module: string | null }

/** What this page remembers between contexts to say "most recently". */
export interface Recent {
  /** The containers picked, by module, at the last context. */
  picked: string[]
  /** The container picked most recently that is still picked, or null. */
  latestPicked: string | null
  /** The selection at the last context. */
  selection: string[]
  /** The passage at the last context, as one string. */
  passage: string
  /** What last changed while nothing was picked: a ref clicked, or the reader moving. */
  latest: { by: 'selected'; ref: string } | { by: 'reading' } | null
}

export const NO_RECENT: Recent = { picked: [], latestPicked: null, selection: [], passage: '', latest: null }

export interface OneInFront {
  /** The target, or null: nothing picked, or a picked container that shows nothing. */
  one: One | null
  /** The page's memory for the next context. */
  recent: Recent
  /** The footer's one line: "For !4233 (picked in References)", or how to pick something. */
  said: string
  /** A picked container that shows nothing, when that is why there is no target. */
  quiet: string | null
}

/** How to pick something, said when nothing is. */
export const HOW_TO_PICK = NOTHING_PICKED

const placeKey = (place: Place | null): string => (place ? `${place.path}\t${place.from ?? ''}\t${place.to ?? ''}` : '')

/** "references" → "References": what a module id's last word is called in a sentence. */
export function moduleWord(module: string): string {
  const word = nameOf(module)
  return word ? `${word[0]!.toUpperCase()}${word.slice(1)}` : module
}

/** A place, as the footer names it: its file's name, without folders. */
export function placeWord(place: Place): string {
  const cut = place.path.lastIndexOf('/')
  return cut === -1 ? place.path : place.path.slice(cut + 1)
}

/** What one container is about: the ref it shows (the selected one first), else its first place. */
function subjectOf(container: Shown, selection: readonly string[]): { ref: string } | { place: Place; places: Place[] } | null {
  const ref = container.refs.find((one) => selection.includes(one)) ?? container.refs[0]
  if (ref) return { ref }
  const place = container.documents[0]
  return place ? { place, places: [...container.documents] } : null
}

/** The passage first, then what the container showing it shows, each once. */
function placesWith(passage: Place, container: Shown | undefined): Place[] {
  const out = [passage]
  for (const one of container?.documents ?? []) if (!out.some((had) => placeKey(had) === placeKey(one))) out.push(one)
  return out
}

/**
 * The one target. `follow` is false when the person turned following the picks off (the aim
 * filter): then the picks do not narrow, and the most recent pick or selection decides.
 */
export function oneInFront(
  recent: Recent,
  input: { passage: Place | null; selection: readonly string[]; containers: readonly Shown[]; follow: boolean },
): OneInFront {
  const { passage, selection, containers, follow } = input
  const picked = containers.filter((one) => one.selected).map((one) => one.module)
  const fresh = picked.filter((one) => !recent.picked.includes(one))
  const latestPicked = fresh.length ? (fresh.at(-1) as string) : recent.latestPicked && picked.includes(recent.latestPicked) ? recent.latestPicked : (picked[0] ?? null)

  /* What last changed while nothing was picked: a ref newly clicked wins over the reader moving in the same context. */
  const clicked = selection.filter((one) => !recent.selection.includes(one))
  const moved = placeKey(passage) !== recent.passage && passage !== null
  let latest = recent.latest
  if (clicked.length) latest = { by: 'selected', ref: clicked.at(-1) as string }
  else if (moved) latest = { by: 'reading' }
  /* What it named is gone: the other one, if there is one. */
  if (latest?.by === 'selected' && !selection.includes(latest.ref)) latest = selection.length ? { by: 'selected', ref: selection.at(-1) as string } : passage ? { by: 'reading' } : null
  if (latest?.by === 'reading' && !passage) latest = selection.length ? { by: 'selected', ref: selection.at(-1) as string } : null
  if (!latest) latest = selection.length ? { by: 'selected', ref: selection.at(-1) as string } : passage ? { by: 'reading' } : null

  const next: Recent = { picked, latestPicked, selection: [...selection], passage: placeKey(passage), latest }

  if (follow && latestPicked) {
    const container = containers.find((one) => one.module === latestPicked) as Shown
    const subject = subjectOf(container, selection)
    const from: Source = { by: 'picked', module: latestPicked }
    if (!subject) {
      return {
        one: null,
        recent: next,
        quiet: latestPicked,
        said: `${moduleWord(latestPicked)} is picked and shows nothing a checklist is for. Pick an item in it, or untick its box.`,
      }
    }
    const one: One = 'ref' in subject ? { kind: 'ref', ref: subject.ref, from } : { kind: 'place', place: subject.place, places: subject.places, from }
    return { one, recent: next, quiet: null, said: saidOf(one) }
  }

  if (latest?.by === 'selected') {
    const one: One = { kind: 'ref', ref: latest.ref, from: { by: 'selected' } }
    return { one, recent: next, quiet: null, said: saidOf(one) }
  }
  if (latest?.by === 'reading' && passage) {
    const showing = containers.find((one) => one.documents.some((doc) => doc.path === passage.path))
    const one: One = { kind: 'place', place: passage, places: placesWith(passage, showing), from: { by: 'reading', module: showing?.module ?? null } }
    return { one, recent: next, quiet: null, said: saidOf(one) }
  }
  return { one: null, recent: next, quiet: null, said: HOW_TO_PICK }
}

/** The footer's line for a target: what it is, and why it is the one. */
export function saidOf(one: One): string {
  const what = one.kind === 'ref' ? one.ref : placeWord(one.place)
  const why =
    one.from.by === 'picked'
      ? `picked in ${moduleWord(one.from.module)}`
      : one.from.by === 'selected'
        ? 'selected last'
        : one.from.module
          ? `in view in ${moduleWord(one.from.module)}`
          : 'where you are reading'
  return `For ${what} (${why})`
}

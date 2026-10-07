import { focusCount, isFocused, partsSchema, pickedParts, refInFocus, type EpicPart } from 'kehikot-module-protocol'

import type { Target } from './targets.ts'

/**
 * The parts focus: what the reading page puts aside when a person has picked
 * parts of the open epic out in the host's bar, and what it says about it.
 *
 * ## What a part is, and the one thing it carries
 *
 * An epic may be divided into parts — a heading and what is under it, one
 * level deep — and a person may point the whole workspace at one or several.
 * The host sends every part of the open epic in `context.parts`, picked or
 * not, each with the REFERENCES it says belong to it. Refs and nothing else.
 * None picked means the whole epic, which is the resting state and what a host
 * that has never heard of parts says by sending nothing.
 *
 * ## What narrows here, and what does not
 *
 * A checklist is held against one of two kinds of thing, and the focus can
 * speak about only one of them:
 *
 *   - **Against a reference** — an issue, a merge request, a pull request.
 *     The list IS about that ref, so the protocol's `refInFocus` is exactly the
 *     question: while parts are picked, the instance is in front only if a
 *     picked part lists its ref. A ref no part lists is outside every focus.
 *
 *   - **Against the paper** — a section, a file, or the whole of it. A part
 *     has no documents in it, so nothing the host said puts chapter 3 inside
 *     or outside "the posting seam". These are LEFT SHOWN, and the page says
 *     they were not narrowed. The other two choices were both worse. Hiding
 *     them would be this program deciding that a paper's lists belong to no
 *     part, on no evidence, and a reader scrolling the chapter they are
 *     writing would watch its checklist vanish because of a pick about
 *     issues. Guessing a part for them — from the refs a chapter cites, say —
 *     is the inference the protocol refuses for steps, for the same reason.
 *
 * ## Narrowing hides things, so narrowing says what it hid
 *
 * The rule `list/aim.ts` keeps for picked-out containers, kept again: the
 * count of instances put aside comes back with the ones that are left, and so
 * does the count of the paper's lists that were not narrowed, so the page can
 * print one line that accounts for everything it is and is not showing. The
 * two numbers are the protocol's `focusCount`, so three modules do not count
 * three ways.
 *
 * With nothing picked `focus` is null, the instances come back as they went
 * in — the same array — and the page is the page it was.
 *
 * Pure. `test/focus.test.ts` is a table.
 */

/** What the reading page says about the focus. Null on `focusOn` when nothing is picked out. */
export interface Focus {
  /** What a person calls each picked part — its heading, or its id where it has none — in the epic's order. */
  picked: string[]
  /** How many parts the epic has, picked or not. */
  of: number
  /** Instances held against a reference that no picked part lists: put aside, and counted. */
  outside: number
  /** Instances held against the paper that are still shown, because a part says nothing about a document. */
  unnarrowed: number
}

/** Whether one target is in front under these parts. A paper target always is; see the essay. */
export function targetInFocus(parts: readonly EpicPart[], target: Target | null): boolean {
  if (target?.kind !== 'ref') return true
  return refInFocus(parts, target.ref)
}

/**
 * The instances left in front, and what to say about the rest.
 *
 * Generic over the instance so that this file does not need to know what a
 * checklist is — only that each one is held against a target.
 */
export function focusOn<T extends { target: Target | null }>(
  instances: readonly T[],
  parts: readonly EpicPart[],
): { instances: readonly T[]; focus: Focus | null } {
  if (!isFocused(parts)) return { instances, focus: null }
  const inFocus = (one: T) => targetInFocus(parts, one.target)
  const kept = instances.filter(inFocus)
  return {
    instances: kept,
    focus: {
      picked: pickedParts(parts).map((part) => part.heading || part.id),
      of: parts.length,
      outside: focusCount(parts, instances, inFocus).outside,
      unnarrowed: kept.filter((one) => one.target?.kind !== 'ref').length,
    },
  }
}

/**
 * The line the reading page prints while parts are picked out.
 *
 * Always printed then, even at `0 checklists outside`: a focus that happens to
 * hide nothing today is still a focus, and the list held tomorrow against a
 * ref outside it will be put aside. The paper's half is said only when a
 * paper's list is actually on screen, because that is the only time a reader
 * could wonder why it survived.
 */
export function focusLine(focus: Focus): string {
  const one = focus.picked.length === 1
  const lists = focus.outside === 1 ? '1 checklist' : `${focus.outside} checklists`
  const where = one ? 'the picked part' : `the ${focus.picked.length} picked parts`
  const paper = focus.unnarrowed
    ? ` ${focus.unnarrowed === 1 ? '1 list held against the paper is' : `${focus.unnarrowed} lists held against the paper are`} shown as before: parts name references, not sections.`
    : ''
  return `${lists} outside ${where} (${focus.picked.join(', ')}).${paper}`
}

/** Where the control is, for the line's tooltip: it is not on this page. */
export function focusTold(focus: Focus): string {
  return `This epic has ${focus.of} ${focus.of === 1 ? 'part' : 'parts'}; ${focus.picked.length} ${focus.picked.length === 1 ? 'is' : 'are'} picked out in the host’s bar, beside the epic. Unpick ${focus.picked.length === 1 ? 'it' : 'them'} there to see every list again.`
}

/**
 * The sentence for an empty reading page, when the focus is what emptied it.
 *
 * Null when the focus put nothing aside — then the page's other sentences
 * apply, unchanged. It goes ahead of them, and ahead of `whyEmpty`, because it
 * is the cause that is true: there WERE lists in front, and the pick hid them.
 */
export function whyUnfocused(focus: Focus | null, left: number): string | null {
  if (!focus || left > 0 || focus.outside === 0) return null
  const one = focus.picked.length === 1
  return focus.outside === 1
    ? `The one checklist in front of you is held against a reference outside the picked ${one ? 'part' : 'parts'}.`
    : `All ${focus.outside} checklists in front of you are held against references outside the picked ${one ? 'part' : 'parts'}.`
}

/**
 * `context.parts` back out of the one string the wire hook keeps it as.
 *
 * Parsed with the protocol's own schema, and anything that does not parse is
 * no parts at all — which is no focus, the whole epic. A doubtful field must
 * never be the reason a list is hidden.
 */
export function partsOf(parts: string): EpicPart[] {
  if (!parts) return []
  try {
    const read = partsSchema.safeParse(JSON.parse(parts))
    return read.success ? read.data : []
  } catch {
    return []
  }
}

/**
 * And into it: the host's parts as one string, or `''`.
 *
 * A string for the reason the passage and the containers are one — a context
 * arrives after every change anywhere on the canvas, and a setter handed a
 * fresh array is never a no-op. The whole list is kept, picked or not, because
 * the page says how many parts there are; `''` only when there are none.
 */
export function flattenParts(value: unknown): string {
  return Array.isArray(value) && value.length ? JSON.stringify(value) : ''
}

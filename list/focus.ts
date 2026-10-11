import {
  KEHIKOT_DIR,
  PAPER_MODULE,
  anchorInFocus,
  focusSentence,
  isFocused,
  moduleFolder,
  partsSchema,
  pickedFiles,
  pickedParts,
  type EpicPart,
} from 'kehikot-module-protocol'

import { fileId } from './scope.ts'
import type { Target } from './targets.ts'

/**
 * The parts focus: what the reading page puts aside when a person has picked
 * parts of the open epic out in the host's bar, and what it says about it.
 *
 * ## What a part is, and the two things it carries
 *
 * An epic may be divided into parts — a heading and what is under it, one
 * level deep — and a person may point the whole workspace at one or several.
 * The host sends every part of the open epic in `context.parts`, picked or
 * not, each with the REFERENCES it says belong to it and the FILES of the
 * epic's paper it owns. None picked means the whole epic, which is the resting
 * state and what a host that has never heard of parts says by sending nothing.
 *
 * ## What narrows here
 *
 * A checklist is held against one of two kinds of thing, and a part speaks
 * about both:
 *
 *   - **Against a reference** — an issue, a merge request, a pull request.
 *     Its anchor is `{ ref }` and the protocol's `anchorInFocus` is exactly
 *     the question: in front only if a picked part lists the ref. A ref no
 *     part lists is outside every focus.
 *
 *   - **Against a file of the paper, or a section in one.** In front only if
 *     a picked part owns the file. A target is stored as the file's id
 *     (`fileId` in `list/scope.ts`: the path inside the project, without its
 *     extension) and not as a path, so the part's files are spelled the same
 *     way and the ids compared — the one spelling, rather than a path guessed
 *     back out of an id. A file no part owns (`main.tex`) is outside every
 *     focus, and counted.
 *
 *   - **Against the whole paper.** Left in front under any focus. Every part
 *     is a part OF the paper, so what the paper owes is owed in each of them;
 *     it is the same reason the list is in front of a reader anywhere in the
 *     paper (`list/holding.ts`).
 *
 * This file used to leave every list held against the paper alone, on the
 * grounds that a part had no documents in it. Parts own files now, and the
 * page was saying so wrongly: somebody who moved from Methods to Results kept
 * the Methods list, under a sentence that it was "shown as before".
 *
 * ## While parts are picked, the parts say what is in front
 *
 * See `byParts` in `list/aim.ts`. The page then asks the server for every
 * list held against the epic's paper (`everywhere` in `list/holding.ts`) and
 * this file narrows THAT, so the lists are the picked parts' own and the
 * number is the rest of the epic's — not whichever file a neighbouring
 * container last happened to name.
 *
 * ## Narrowing hides things, so narrowing says what it hid
 *
 * The rule `list/aim.ts` keeps for picked-out containers, kept again: the
 * count of instances put aside comes back with the ones that are left, so the
 * page can print one line that accounts for what it is not showing. That line
 * is the protocol's `focusSentence`, the one every module says.
 *
 * With nothing picked `focus` is null, the instances come back as they went
 * in — the same array — and the page is the page it was.
 *
 * Nothing here ticks, unticks, holds or releases: an instance put aside keeps
 * its ticks in the file, under its own target, and is back when the pick is.
 *
 * Pure. `test/focus.test.ts` is a table.
 */

/** What the reading page says about the focus. Null on `focusOn` when nothing is picked out. */
export interface Focus {
  /** What a person calls each picked part — its heading, or its id where it has none — in the epic's order. */
  picked: string[]
  /** Instances held against a reference, a file or a section that no picked part has: put aside, and counted. */
  outside: number
  /** `2 checklists outside the picked part (The seam).` — the protocol's sentence. */
  sentence: string
}

/**
 * A file of an epic's paper as a target spells it: the id of its path inside
 * the project. `chapters/3_methods.tex` of `thesis` is
 * `.kehikot:paper:thesis:chapters:3_methods`, which is what `placeOf` made of
 * the same file when a list was held against it.
 */
export function paperFileId(epic: string, file: string): string | null {
  return fileId(`${KEHIKOT_DIR}/${moduleFolder(PAPER_MODULE)}/${epic}/${file}`)
}

/**
 * The files the picked parts own, as places on this machine, for the page to
 * name to its server while the parts decide what is in front. They narrow
 * nothing — `whole` asks for every list of the paper — and are sent so the
 * server can say what each file is called, which is what a row is labelled
 * with. Empty without a project or an epic to find the paper's folder by.
 */
export function pickedPlaces(
  parts: readonly EpicPart[],
  projectPath: string | null,
  epic: string | null,
): { path: string; from: null; to: null }[] {
  if (!projectPath || !epic) return []
  const folder = `${projectPath.replace(/\/+$/, '')}/${KEHIKOT_DIR}/${moduleFolder(PAPER_MODULE)}/${epic}`
  return pickedFiles(parts).map((file) => ({ path: `${folder}/${file}`, from: null, to: null }))
}

/** Whether one target is in front under these parts. See the essay for the three cases. */
export function targetInFocus(parts: readonly EpicPart[], target: Target | null): boolean {
  if (!target || !isFocused(parts)) return true
  if (target.kind === 'ref') return anchorInFocus(parts, { ref: target.ref })
  if (!target.section) return true
  const cut = target.section.indexOf('#')
  const file = cut === -1 ? target.section : target.section.slice(0, cut)
  return pickedFiles(parts).some((one) => paperFileId(target.epic, one) === file)
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
  const kept = instances.filter((one) => targetInFocus(parts, one.target))
  const outside = instances.length - kept.length
  return {
    instances: kept,
    focus: {
      picked: pickedParts(parts).map((part) => part.heading || part.id),
      outside,
      sentence: focusSentence(parts, outside, 'checklist'),
    },
  }
}

/**
 * The sentence for an empty reading page, when the focus is what emptied it.
 *
 * Null when the focus put nothing aside — then the page's other sentences
 * apply, unchanged. It goes ahead of them, and ahead of `whyEmpty`, because it
 * is the cause that is true: there WERE lists, and the pick put them aside.
 *
 * Two wordings, because the page asked two different questions. `led` is the
 * parts having decided what is in front (`byParts` in `list/aim.ts`): every
 * list of the epic's paper was asked for, so none left means none is held
 * against the picked parts at all. Otherwise a picked-out container decided
 * it, and what is true is narrower — the lists that container shows are held
 * outside the picked parts.
 */
export function whyUnfocused(focus: Focus | null, left: number, led = false): string | null {
  if (!focus || left > 0 || focus.outside === 0) return null
  const parts = focus.picked.length === 1 ? 'part' : 'parts'
  if (led) return `No checklist is held against anything in the picked ${parts}.`
  return focus.outside === 1
    ? `The one checklist in front of you is held against something outside the picked ${parts}.`
    : `All ${focus.outside} checklists in front of you are held against things outside the picked ${parts}.`
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

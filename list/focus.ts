import { partsSchema, type Anchor, type EpicPart } from 'kehikot-module-protocol'

import { placesAmong, type Placed } from './scope.ts'
import type { Target } from './targets.ts'

/**
 * What ties a checklist to a part of the epic.
 *
 * ## One rule, and it is not this file's
 *
 * A part belongs to the epic and names no module. The host sends every part
 * of the open epic in `context.parts`, picked or not, each with the references
 * and the documents the modules hold for it. None picked is the whole epic:
 * the resting state, and what a host that has never heard of parts says by
 * sending nothing. With some picked, an item is in front exactly when one of
 * its anchors is in a picked part — the protocol's rule, applied by the
 * protocol: the page narrows with `useFocus(context).narrow(instances,
 * anchorOf, { noun, keep })` (`src/app.tsx`), and this file is the two things
 * that call needs: the anchor (`anchorOf`) and what one item is called
 * (`NOUN`).
 *
 * This file used to be the rule as well — a filter of its own, which spelled
 * a part's files into ids under another module's folder and compared them by
 * hand. Nothing here compares a file, a reference or a part with the pick any
 * more, and nothing here names a module.
 *
 * ## What a list is anchored by: what it is held against
 *
 *   - **A reference** — an issue, a merge request, a pull request: `{ ref }`.
 *     In front when a picked part lists the ref.
 *
 *   - **A file of the paper, or a section in one**: `{ file }`, the document
 *     the file is, as a path inside the project. A target stores the file's
 *     ID (`fileId` in `list/scope.ts`: the path without its extension), and a
 *     part lists documents by path, so the path comes from the server, which
 *     asked the disk which file spells the id (`positions` on the answer to
 *     `/api/here`). A list held against a file that is not there any more has
 *     no document and so no anchor: it is in no part, like anything that
 *     belongs to the epic as a whole, and is back when nothing is picked.
 *
 *   - **The whole paper**: `{ whole: true }`. Every part is a part OF the
 *     paper, so what the paper owes is owed in each of them, and the list is
 *     in front under any pick — the same reason it is in front of a reader
 *     anywhere in the paper (`list/holding.ts`).
 *
 * ## While parts are picked, the parts say what is in front
 *
 * See `byParts` in `list/aim.ts`. The page then asks the server for every
 * list held against the epic's paper (`everywhere` in `list/holding.ts`) and
 * narrows THAT, so the lists are the picked parts' own — not whichever file a
 * neighbouring container last happened to name.
 *
 * ## What is said about the pick: one sentence, and only on an empty page
 *
 * `narrow(...).empty` — the protocol's `No checklist is in the picked part.`
 * — where the lists would have been, when the pick left none of an answer that
 * had some. While a list is drawn nothing about the pick is drawn: the host's
 * bar already says what is picked.
 *
 * ## What is kept
 *
 * The list a person is editing (`keep`): a tick in another control does not
 * put a list somebody has open aside.
 *
 * Nothing here ticks, unticks, holds or releases: a list put aside keeps its
 * ticks in the file, under its own target, and is back when the pick is.
 *
 * Pure. `test/focus.test.ts` is a table.
 */

/** What one item is called in the protocol's sentence for an empty page. */
export const NOUN = 'checklist'

/**
 * THE anchor function of this module: what ties one list, held against one
 * target, to a part.
 *
 * `positions` are the places the server resolved beside the lists — each a
 * file inside the project — and are where a file target's document is read
 * from. See the essay for the three cases.
 */
export function anchorOf(instance: { target: Target | null }, positions: readonly (Placed | null)[] = []): Anchor[] {
  const target = instance.target
  if (!target) return []
  if (target.kind === 'ref') return [{ ref: target.ref }]
  /* A module's container on a kehikko belongs to the open epic as a whole, like the whole paper. */
  if (target.kind === 'kehikko') return [{ whole: true }]
  /* A rule is never an instance's target (`list/standing.ts`); were one to arrive, it belongs to no one part. */
  if (target.kind === 'rule') return [{ whole: true }]
  if (!target.section) return [{ whole: true }]
  return placesAmong(target, positions).map((place) => ({ file: place.file }))
}

/**
 * `context.parts` back out of the one string the wire hook keeps it as.
 *
 * Parsed with the protocol's own schema, and anything that does not parse is
 * no parts at all — which is no focus, the whole epic. A doubtful field must
 * never be the reason a list is hidden.
 */
export function readParts(parts: string): EpicPart[] {
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
 * fresh array is never a no-op. The whole list is kept, picked or not; `''`
 * only when there are none.
 */
export function flattenParts(value: unknown): string {
  return Array.isArray(value) && value.length ? JSON.stringify(value) : ''
}

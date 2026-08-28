import type { RefState } from '../../derive/ref-state.ts'

/**
 * Finding one reference inside a host's reading of an epic.
 *
 * ## The question this file exists to answer
 *
 * A selection carries refs and nothing else. `context.selection` is
 * `['gh#131', 'gh#105']` and the protocol is explicit about why it is only that:
 * the host can vouch that these are the refs somebody picked, and cannot vouch
 * for what they ARE, because whichever module set the selection was believed
 * rather than checked. So the kind does not travel, deliberately.
 *
 * But the kind matters here more than in most modules, because an issue and a
 * change owe DIFFERENT LISTS. Show the change list under an issue and every
 * tracker-derived row reads as a standing accusation about a pipeline that does
 * not exist; show the issue list under a pull request and the reader loses
 * fourteen of the sixteen things the change is actually held to.
 *
 * GitHub numbers issues and pull requests in one sequence, so `gh#105` is
 * unreadable on its own and `derive/refs.ts` correctly answers `unsettled` for
 * it. The way out is the one the protocol points at: ask the host for the epic's
 * reading and read the kind where References reads it — out of the BAG the
 * refresh filed it in. A refresh knew, and filing is how it told us. Parsing the
 * ref to decide would be this app guessing at a fact it was handed.
 *
 * ## Every bag, and the spellings are not ours to tidy
 *
 * GitLab's two bags are keyed by the bare number and GitHub's two by the ref as
 * written, which is how a host files them. The spellings are rebuilt here to
 * match how people say them out loud, and the asymmetry is not ours and is not
 * tidied — tidying it would mean this app and the host disagree about what a key
 * is, and the symptom would be a selected reference that this page could not
 * find and drew as `unasked` for ever.
 *
 * ## A ref that is not in the reading is an ordinary state
 *
 * Not an error, and not a blank row. Somebody may have picked a reference from a
 * pane showing another epic, or one this app has ticks for and the host has
 * never read. `null` comes back, the caller sends no state, and the standing
 * answers `unasked` with the sentence that explains what `unasked` means. The
 * one thing that must never happen is a selected ref silently not appearing: a
 * missing row looks exactly like a row that was never meant to be there.
 */

/** Whether a reference is a piece of work or a change against it, in `Shape`'s words. */
export type Shape = 'change' | 'work'

export interface Found {
  /** The `RefState` to hand this app's own store, exactly as the host wrote it. */
  state: RefState
  /** Which list it owes, learned from the bag and from nothing else. */
  shape: Shape
}

/** The four bags, and the only thing that says what a reference is. */
const BAGS = [
  { bag: 'issues', shape: 'work', spell: (k: string) => `#${k}` },
  { bag: 'mrs', shape: 'change', spell: (k: string) => `!${k}` },
  { bag: 'ghIssues', shape: 'work', spell: (k: string) => k },
  { bag: 'ghPrs', shape: 'change', spell: (k: string) => k },
] as const satisfies readonly { bag: string; shape: Shape; spell: (k: string) => string }[]

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Every reference in one reading, by the spelling people write.
 *
 * Built by enumeration rather than by lookup, and the difference is a real
 * hazard rather than a style: `bag[ref]` with a `ref` that arrived from the wire
 * answers with something inherited when the string is `constructor`, and this
 * page would then hand `Function.prototype` to its own store as a tracker state.
 * `Object.entries` returns own enumerable properties and nothing from a
 * prototype. The protocol package's essay on `MODULE_ID` is about exactly this
 * hazard one door over.
 *
 * A key whose value is not an object still becomes an entry, with no state and
 * only its shape. The reading was damaged, not absent — and knowing that
 * `gh#105` is a pull request is worth having even when nothing else about it
 * could be read. It is the difference between the right list with empty verdicts
 * and both lists with a shrug.
 */
export function index(live: unknown): Map<string, Found | { state: null; shape: Shape }> {
  const out = new Map<string, Found | { state: null; shape: Shape }>()
  if (!isObject(live)) return out
  for (const { bag, shape, spell } of BAGS) {
    const held = live[bag]
    if (!isObject(held)) continue
    for (const [key, raw] of Object.entries(held)) {
      out.set(spell(key), isObject(raw) ? { state: raw as unknown as RefState, shape } : { state: null, shape })
    }
  }
  return out
}

/** When the reading was taken, as the host wrote it, or null if it did not say. */
export function generatedAt(live: unknown): string | null {
  if (!isObject(live)) return null
  return typeof live.generated === 'string' && live.generated ? live.generated : null
}

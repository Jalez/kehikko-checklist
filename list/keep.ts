/**
 * Which checklist this reader picked, on which kehikko, kept between sessions.
 *
 * ## Why the host holds it and this app does not
 *
 * This app declares `storage: true`, so unlike Atlas it DOES have an origin and
 * `localStorage` would work. It is still the wrong place, for a reason that has
 * nothing to do with sandboxes: `localStorage` is per browser profile, and this
 * app's whole claim is that `data/` can be copied to another machine and be
 * somebody's checklist. A choice remembered in a browser is a choice that does
 * not travel and that a second browser on the same machine does not have.
 *
 * `state.set` is the protocol's answer: the host keeps one string for one module
 * and hands the same string back on the greeting, having never looked inside it.
 * That it never looks inside is the part this file has to honour — nothing on
 * the other side parses this, validates it, or would notice if its shape changed
 * tomorrow, so every guarantee about what comes back has to be made here.
 *
 * ## Why the map is inside the string
 *
 * The host's kept state is keyed by MODULE, and by nothing else. There is one
 * string for `roadmap.checklist` however many kehikkos the reader has. The
 * choice being remembered, though, is per kehikko — the user asked for exactly
 * that:
 *
 * > "when user looks at the checklist for the first time in a kehikko they are
 * > supposed to pick an existing checklist or create their own checklist"
 *
 * *in a kehikko*. Two canvases are two contexts and a person working on a paper
 * on one and a set of merge requests on the other should not have their choice
 * follow them between the two.
 *
 * So the map lives inside the one string the host keeps, keyed by kehikko id.
 * `roadmap.context` carries `kehikko: {id, name} | null`, which is the only
 * thing that says where this container is standing — a module's page is loaded once
 * and shown on whichever canvas asks for it, so it genuinely cannot tell
 * otherwise.
 *
 * ## Bounded, and the oldest go
 *
 * The protocol bounds the kept string at four kilobytes and a host may refuse a
 * longer one, so a map that grew a row per kehikko forever would eventually
 * stop being saved at all — and the failure would be that the CURRENT choice
 * stopped being remembered, which is the one row that mattered. `KEEP` rows are
 * held, most-recently-chosen first, and the rest are dropped: a kehikko the
 * reader has not opened in thirty other canvases' worth of work is one they will
 * be asked to pick on again, which is the correct thing to lose.
 */

/** The shape written today. Bumped when the fields change, never reused. */
const VERSION = 1

/**
 * How many kehikkos' choices are remembered.
 *
 * Short field names and a bounded row count because of the four-kilobyte limit
 * above, and because somebody reading the host's database should be able to see
 * at a glance that this is a breadcrumb and not a document.
 */
const KEEP = 40

/**
 * What the reader picked, per kehikko, most recent first.
 *
 * An array of pairs rather than an object, and that is not stylistic: the order
 * IS the recency, and it is what decides which rows survive the bound. An object
 * would leave the order to whatever the JSON serialiser did with integer-like
 * keys, which is a rule this file would then be relying on without saying so.
 */
export type Kept = { kehikko: number; checklist: string }[]

/**
 * The string to hand the host.
 *
 * A checklist id is clipped rather than refused, for the reason a name is
 * elsewhere in this workspace: the id is looked up against the store on the way
 * back and falls through to the pick screen when nothing matches, so a clipped
 * id simply fails to match — which is a state the page is already correct in.
 * Refusing to save at all would mean one absurd id made this app unable to
 * remember anything.
 */
export function writing(kept: Kept): string {
  return JSON.stringify({
    v: VERSION,
    by: kept.slice(0, KEEP).map((row) => [row.kehikko, row.checklist.slice(0, 64)]),
  })
}

/**
 * What the host handed back, as far as it can be believed.
 *
 * Never throws, and returns an empty list for anything it cannot use — no
 * string, not JSON, a version it no longer writes, rows that are not pairs. The
 * string was written by this app, on an older version of itself, possibly months
 * ago, possibly on another machine; it is exactly as trustworthy as anything
 * else arriving over the wire. A remembered choice that half-applies is worse
 * than one that was forgotten, because the second is a fresh start and the first
 * is a page in a state no code path meant to make.
 *
 * There is no third state here, unlike Atlas's `reading`. Atlas had to tell
 * "nothing kept" from "the reader really was at the top level", because its
 * unset position was a place. This app's unset position is the pick-or-create
 * screen, and "nothing was kept for this kehikko" and "nothing was kept at all"
 * lead to the same screen — so an empty list says both and loses nothing.
 */
export function reading(state: string | null | undefined): Kept {
  if (typeof state !== 'string' || state === '') return []
  let raw: unknown
  try {
    raw = JSON.parse(state)
  } catch {
    /* Not a surprise and not worth reporting. A host may hand back something
       written by a version of this app that predates this file, or by a
       hand-edited database. Either way the answer is the same. */
    return []
  }
  if (typeof raw !== 'object' || raw === null) return []
  const held = raw as Record<string, unknown>
  if (held.v !== VERSION) return []
  if (!Array.isArray(held.by)) return []

  const out: Kept = []
  const seen = new Set<number>()
  for (const row of held.by) {
    if (!Array.isArray(row) || row.length < 2) continue
    const [kehikko, checklist] = row as [unknown, unknown]
    if (typeof kehikko !== 'number' || !Number.isInteger(kehikko)) continue
    if (typeof checklist !== 'string' || !checklist) continue
    /* A duplicated kehikko keeps the first, which is the most recent by the
       ordering this file writes. A hand-edited file is the only way to get one,
       and picking the newest is the same rule `choose` below applies. */
    if (seen.has(kehikko)) continue
    seen.add(kehikko)
    out.push({ kehikko, checklist: checklist.slice(0, 64) })
    if (out.length >= KEEP) break
  }
  return out
}

/** What this reader last picked on one kehikko, or null. */
export function chosenOn(kept: Kept, kehikko: number | null): string | null {
  if (kehikko === null) return null
  return kept.find((row) => row.kehikko === kehikko)?.checklist ?? null
}

/**
 * Record a pick, moving that kehikko to the front.
 *
 * Returns a new list rather than mutating, because the caller is React state and
 * a mutated array is a render that does not happen. Front rather than in place
 * so that the bound in `writing` drops the least recently chosen.
 */
export function choose(kept: Kept, kehikko: number, checklist: string): Kept {
  return [{ kehikko, checklist }, ...kept.filter((row) => row.kehikko !== kehikko)].slice(0, KEEP)
}

/** Forget one kehikko's pick, which is what pressing "pick another" does. */
export function unchoose(kept: Kept, kehikko: number): Kept {
  return kept.filter((row) => row.kehikko !== kehikko)
}

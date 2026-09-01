import { rungsFrom, type Grain, type Rung } from './scope.ts'
import { targetKey, type Target } from './targets.ts'

/**
 * Which PAIRING of a checklist with a target is in front of the reader.
 *
 * ## The sentence this file exists for
 *
 * > "held against doesnt really seem to translate to 'show and expect to be
 * > filled for x' it seems, as the checklist even if its pointed at some other
 * > section does not 'disappear' from sight until you scroll to that tex file,
 * > instead it stays there and if you scroll around it changes manually to
 * > another one. Unlike in notes module for instance where it correctly knows
 * > what notes to show for each page when I scroll around."
 *
 * That is a report about a MODEL and not about a screen, and the model it
 * reports on was this: the target was `candidates[0]` — the canvas's selection,
 * else the paper the open epic is aimed at — narrowed by whatever passage the
 * host last broadcast. A property of the MOMENT. So as the reader scrolled, the
 * passage moved, the target moved with it, and one checklist silently re-pointed
 * itself at whatever prose happened to be in front of them. "Held against" read
 * like a claim and behaved like a cursor.
 *
 * ## Is a target a property of a checklist, or of the moment?
 *
 * Of the checklist, and the evidence was already in the store rather than in
 * anybody's opinion. A tick belongs to the **(checklist, target, item)** triple —
 * `targetKey(list, target)` — so the pairing of one list with one target is a
 * durable, named, countable thing that outlives every context. It is what
 * `/api/checklist` already answers with under `targets`, what the switcher
 * already lists, and what the owner already had a word for when they asked for
 * import: *"Are all the checklists (not their instances) Saved per project?"*
 * The instances are the pairings. They were real; nothing in the container was
 * treating them as real.
 *
 * So the container's job is not to AIM a list. It is to choose which of the
 * pairings somebody has already made is the one they are standing in front of,
 * exactly as `kehikko-notes` chooses which notes belong to the page being read.
 *
 * ## The three inputs, and what each of them decides
 *
 * - **The pairings** — every `(list, target)` with ticks on it. Durable. Made by
 *   a person, never by this program.
 * - **Where the reader is** — the ladder under their passage, narrowest first
 *   (`section`, `file`, `paper`), or the reference the canvas has selected. A
 *   fact about the moment, and it decides WHICH pairing is shown, never what
 *   exists.
 * - **The grain** — how narrow this reader likes it, remembered by the host per
 *   container. It trims the ladder from below, so a reader working file by file
 *   is not shown a section's ticks, and it names the rung a NEW pairing would be
 *   made at.
 *
 * A pairing is shown when a rung the reader is standing on is one this list is
 * already held against. The NARROWEST such rung wins, because a list held
 * against a section and against its paper is making two claims and the closer
 * one is the one the reader walked into. A target one rung wider than where they
 * stand contains them — "the paper owes an abstract" is true everywhere in the
 * paper — which is why the search walks outward and does not stop at equality.
 *
 * ## And when nothing here is held: `unheld`, which is the whole fix
 *
 * The old model had no such state. Every position produced a target, so the list
 * was always "held against" something and a reader four chapters away from the
 * work was looking at a list that claimed to be about their chapter. Now the
 * container says the true thing — this list is not held against what you are
 * reading — draws the items with nothing tickable, and offers one press to make
 * the pairing if that is what the reader means.
 *
 * That press matters and is not friction for its own sake. Creating a pairing is
 * a claim that a piece of work owes what this list says, which is the same claim
 * `src/view/choose.tsx` refuses to make on somebody's behalf when it picks no
 * checklist for them. Under the old model that claim was made by SCROLLING.
 *
 * ## Why this is not the guess `choose.tsx` forbids
 *
 * The essay there says there is no default and no guess about which list to
 * show, because "a container that opened on somebody else's list would have a
 * person ticking items off against a standard they never chose". Every word of
 * it still stands and nothing here weakens it.
 *
 * It is about which LIST, and this file chooses no list — the list is the one
 * remembered for this kehikko in `list/keep.ts`, picked by a person, and that is
 * untouched. What position chooses is which of that list's OWN pairings is in
 * front, and every one of those was made by the person who ticked something on
 * it. Choosing among somebody's own claims by where they are standing is not a
 * guess about what they owe; it is the container knowing which of their claims
 * they walked up to. The guess would be inventing a pairing nobody made, and
 * that is precisely the act this file moved behind a press.
 *
 * ## A ref has no passage, and does not become unreachable
 *
 * An issue, a merge request or a pull request is not in any document, so it can
 * never be a rung of the ladder. Its position is the CANVAS: a reference the
 * reader has selected is where they are standing, in exactly the sense a passage
 * is, and a selected ref this list is held against is shown ahead of any paper
 * rung. That is one of three ways to a ref pairing, and the other two are
 * unchanged: the switcher lists every pairing this list has, by name and with
 * its count, and the box under it still takes a reference typed by hand. What
 * changed for a ref is only that the container stops CLAIMING one when the
 * canvas has selected something the list was never held against.
 *
 * ## What is not here: no pairing is invented, and none is forgotten
 *
 * This function creates nothing and removes nothing. It reads the pairings the
 * store already has and answers with one of them, or with the honest `unheld`.
 * A pairing comes into being when somebody ticks an item on it, which is where
 * it always came from.
 */
export type Standing =
  /** A target the reader pointed at by hand, which outranks everything. */
  | 'picked'
  /** A pairing this list already has, at or containing where the reader is. */
  | 'held'
  /** The reader is somewhere real, and this list is not held against it. */
  | 'unheld'
  /** No passage, no selection, no epic: there is nothing here to be about. */
  | 'nothing'

export interface Holding {
  /**
   * The target to read ticks for — and, when nothing is held, the target a press
   * would make a pairing at, so the offer and the fetch cannot name two things.
   */
  target: Target | null
  /**
   * Whether that target is somebody's DECISION rather than the passage's own
   * narrowest reading.
   *
   * The distinction is the server's, not a nicety: without it `/api/checklist`
   * may re-derive the target from the path and resolve a reader straight back
   * into the section they climbed out of. See the essay on `decided` in
   * `src/app.tsx` for the bug that named it. False only for the narrowest rung
   * of the ladder, which is the one the server would have picked anyway.
   */
  decided: boolean
  standing: Standing
  /**
   * Whether what is in front is a rung of the ladder the reader is standing on.
   *
   * Which is to say: whether the host's grain control would be telling the truth
   * about it. False for a reference, which has no rungs and never will, and for
   * a target somebody pointed at in another chapter — press `This file` on one of
   * those and either the press does nothing or it throws the pick away.
   *
   * It is not `standing !== 'picked'`, and the difference is worth the field. A
   * withdrawn offer is a CLAIM, and this host answers it by pruning the grain it
   * has remembered for this container — so a rule that withdrew on every pick
   * would spend the reader's stored preference every time they pressed "hold it
   * against here", which is now an ordinary press rather than a rare one. A pick
   * that lands on a rung of the ladder leaves the control honest, so the offer
   * stands.
   */
  grounded: boolean
}

/** The target a rung means. Its own function so nothing spells one by hand. */
export function rungTarget(rung: Rung): Target {
  return { kind: 'paper', epic: rung.epic, section: rung.section }
}

/**
 * What this container is showing, and whether the list is actually held there.
 *
 * `ladder` is the reader's position as `ladderKey` spells it — narrowest rung
 * first — and is empty for a reader who is nowhere in a paper. It is the
 * position and never the target, which is the distinction the whole file turns
 * on: this function is the only thing that turns one into the other.
 */
export function holdingAt(input: {
  ladder: string
  grain: Grain | null
  /**
   * The KEY of every target this list has ticks against — the pairings.
   *
   * Keys rather than targets, and that is for the caller's sake rather than for
   * brevity. `/api/checklist` hands back a fresh `targets` array on every answer,
   * so a page memoising this call on the array would recompute on every fetch,
   * hand back a fresh target object, and re-run the fetch that produced it. A
   * list of strings compares by value; see the same argument on `ladderKey`.
   */
  pairings: string[]
  /** A target pointed at by hand, which is a decision and outranks position. */
  picked: Target | null
  /** The references the canvas has selected, in the order it offered them. */
  selection: string[]
}): Holding {
  const { ladder, grain, pairings, picked, selection } = input
  const rungs = rungsFrom(ladder)
  const onLadder = (target: Target) =>
    rungs.some((rung) => targetKey(rungTarget(rung)) === targetKey(target))

  if (picked) return { target: picked, decided: true, standing: 'picked', grounded: onLadder(picked) }

  const has = new Set(pairings)

  /* A selected reference the list is genuinely held against, ahead of the paper:
     a reference somebody just clicked is the loudest statement there is about
     what they are looking at. Only a HELD one wins here — an unheld selection
     must not re-point a list that is properly held against the chapter under the
     reader, which is the whole complaint this file answers. */
  for (const ref of selection) {
    const target: Target = { kind: 'ref', ref }
    if (has.has(targetKey(target))) return { target, decided: true, standing: 'held', grounded: false }
  }

  /* Trimmed from below by the grain, never from above. A reader who works file
     by file is not shown one section's ticks; a reader on any grain still sees a
     list held against the whole paper, because the paper contains them wherever
     they are standing. A grain that is not on this ladder trims nothing —
     `grainAt` has already fallen back for the same reason. */
  const found = grain ? rungs.findIndex((rung) => rung.grain === grain) : 0
  const from = found === -1 ? 0 : found

  for (let at = from; at < rungs.length; at++) {
    const target = rungTarget(rungs[at]!)
    if (has.has(targetKey(target))) return { target, decided: at > 0, standing: 'held', grounded: true }
  }

  /* Nothing here is held. What comes back is still a target, because the page
     has to fetch SOMETHING to learn where the reader turned out to be, and
     because the offer to hold this list here must name the same rung the fetch
     did. `standing` is what stops the screen calling it a claim. */
  const offer = rungs[from]
  if (offer) return { target: rungTarget(offer), decided: from > 0, standing: 'unheld', grounded: true }

  /* No ladder at all. A selected reference is still somewhere to stand, and is
     what a press would hold the list against. */
  const ref = selection[0]
  if (ref) return { target: { kind: 'ref', ref }, decided: true, standing: 'unheld', grounded: false }

  return { target: null, decided: false, standing: 'nothing', grounded: false }
}

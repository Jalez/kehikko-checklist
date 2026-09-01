import { rungsFrom, type Rung } from './scope.ts'
import { readKey, targetKey, type Target } from './targets.ts'

/**
 * Which checklists are in front of the reader, and against what.
 *
 * ## The sentence this file exists for
 *
 * > "I want to be able to connect one or more checklists in papers case to
 * > sections or tex files and I want that to stick. … by default when I am
 * > scrolling in a paper i want to see the checklist(s) that I have assigned
 * > for that section/file in question. I dont want to see it swapping its mind
 * > on what its connected to … Or, in the case of selecting a specific issue or
 * > an mr or a pr, I want to see the checklists specific to those issues etc.
 * > Its all about knowing what is selected or seen in the app that's important
 * > in the consumer/provider relationships."
 *
 * Said three times in three wordings, and missed twice. The first miss aimed
 * one list at whatever the reader had scrolled to. The second — the version
 * this file replaces — kept one list on screen and, on every scroll, chose
 * among the targets that list had TICKS against, calling anywhere else "not
 * held here" and offering a press to hold it there. Both had the same shape of
 * fault: the container was deciding, at the moment of reading, what a list was
 * about. The owner's word for what they wanted was *assigned*, and an
 * assignment is not made by reading.
 *
 * ## What a target is now, in one sentence
 *
 * A target is a property of the CHECKLIST — `targets` in `list/checklists.ts`,
 * a stored list of keys, changed on the edit page and through `hold_checklist`
 * and nowhere else. This file reads that field and never writes it, offers
 * nothing and remembers nothing. There is no `picked`, no `unheld`, no
 * `grounded`, no grain, and no press anywhere in the reading view that changes
 * what a list is connected to, because that is the thing the owner said must
 * not change on the fly.
 *
 * ## The two inputs, and what each decides
 *
 * - **Where the reader is.** The ladder under their passage, narrowest first —
 *   section, file, paper — and the references the canvas has selected. Both
 *   are facts about the moment; together they are "what is selected or seen".
 * - **What every checklist is held against.** Facts about the lists, made by a
 *   person, durable, and read here as keys.
 *
 * The answer is every pairing of a list with a target where the target is
 * something in front of the reader. A list held against the whole paper is in
 * front of a reader anywhere in that paper; one held against a file is in
 * front of a reader in any section of it. The search walks OUTWARD from where
 * they stand rather than stopping at equality, because a claim about the paper
 * is a claim about everywhere in it. Where a list is held against a section
 * AND the file around it, the closer one is the one the reader walked into and
 * is the one shown; the ticks against the file are one press away on the edit
 * page, not lost.
 *
 * ## Several at once, and one list twice
 *
 * "the checklist(s)" is plural in the sentence above, so the answer is a list
 * of INSTANCES and not one pairing. Seven chapter lists and one for the whole
 * thesis means a reader in chapter 3 sees two. A list held against `gh#105`
 * and against the file the reader is in, with `gh#105` selected on the canvas,
 * is in front of them twice — two pieces of work, two sets of ticks — and is
 * shown twice, each instance saying which. Collapsing that to one would be
 * this program picking, which is the thing it is not allowed to do.
 *
 * Selected references lead, in the order the canvas offered them: a reference
 * somebody just clicked is the loudest statement there is about what they are
 * looking at. The paper's instances follow in the order the lists arrive,
 * which the store sorts by name.
 *
 * ## What this refuses, said plainly
 *
 * No list is shown on a rung nothing assigned it to. A reader four chapters
 * from the one a list is about sees the other lists, or none, and one line
 * saying so with the way to every checklist beside it. That is what the owner
 * asked for instead of "not held here": not a claim about a list, just the
 * lists that ARE here.
 *
 * Pure. Strings in, targets out, so `test/holding.test.ts` can be a table of
 * positions in a paper with several chapters — because the bug this exists to
 * prevent cannot happen in a document with one section in it.
 */

/** One checklist, in front of the reader against one of its targets. */
export interface Instance {
  id: string
  target: Target
}

/** A checklist as `holdings` in `list/checklists.ts` hands it over. */
export interface Holding {
  id: string
  /** The keys of every target this list is held against. */
  targets: string[]
}

/** The target a rung means. Its own function so nothing spells one by hand. */
export function rungTarget(rung: Rung): Target {
  return { kind: 'paper', epic: rung.epic, section: rung.section }
}

/**
 * Every instance of a checklist that is in front of the reader.
 *
 * `ladder` is the reader's position as `ladderKey` spells it — narrowest rung
 * first — and is empty for a reader who is nowhere in a paper. `selection` is
 * what the canvas has picked out. Neither is a target; this is the only
 * function that turns either into one, and it does so only where a list has
 * already been assigned to it.
 */
export function showing(input: { ladder: string; selection: string[]; lists: Holding[] }): Instance[] {
  const { ladder, selection, lists } = input
  const rungs = rungsFrom(ladder)
  const out: Instance[] = []

  /* The selection first, in the canvas's order, and every list held against
     each reference. A ref has no ladder to climb, so equality is the whole
     test. */
  for (const ref of selection) {
    const key = targetKey({ kind: 'ref', ref })
    for (const list of lists) {
      if (list.targets.includes(key)) out.push({ id: list.id, target: { kind: 'ref', ref } })
    }
  }

  /* Then the paper: for each list, the narrowest rung the reader is standing
     on that the list is held against, walking outward. One instance per list
     here, because the rungs contain one another and two of them would be the
     same work twice. */
  for (const list of lists) {
    for (const rung of rungs) {
      const target = rungTarget(rung)
      if (!list.targets.includes(targetKey(target))) continue
      out.push({ id: list.id, target })
      break
    }
  }
  return out
}

/**
 * The keys of a list as targets, for the edit page — which draws them and
 * offers to release each one. A key this version cannot read is left out of
 * the drawing and left in the file, which is the rule `readKey` sets for every
 * caller.
 */
export function heldTargets(keys: string[]): Target[] {
  return keys.map(readKey).filter((one): one is Target => one !== null)
}

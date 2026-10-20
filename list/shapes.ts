import { z } from 'zod'

import { evidenceSchema, FACTS } from './evidence.ts'

/**
 * The shapes of what this app keeps: a tick, an item, a checklist, and the
 * single-file store the folder held before it was split (`list/book.ts` says
 * how it is split, and why).
 *
 * Moved out of `list/checklists.ts` unchanged, so that the layer that reads
 * and writes the folder and the layer that decides what a change means can
 * both import them without importing each other.
 */

/** The three things a tick can say. No tick at all is a fourth, `unchecked`. */
export const TICK_STATES = ['passed', 'failed', 'na'] as const
export type TickState = (typeof TICK_STATES)[number]

/**
 * One tick, and WHO made it.
 *
 * ## An agent may tick, and may never do it anonymously
 *
 * The rule this module used to carry was: an agent is refused the `agreed` item,
 * in words, because an item asking whether a PERSON has agreed to something,
 * which the party doing the asking can tick, is a formality with a box beside
 * it. That gate was pressed on this app's own origin holding a ticket this
 * process minted, and `check_mr` refused it.
 *
 * **`agreed` is gone, and so is the gate, and this is the answer to what it
 * meant.** The gate was about one item on a list this program shipped. Nothing
 * ships a list now. Every item on every checklist here is a line somebody typed,
 * and an agent is very often the one who did the work the line describes —
 * refusing the tick would leave a person hand-ticking work they watched somebody
 * else do, which is a formality in the opposite direction.
 *
 * What survives is the part of the old rule that was doing the actual work:
 * **the tick may not be anonymous about where it came from.** Every tick names
 * its author and carries `viaMcp`, and one press takes it back. An agent's claim
 * is a claim, legible as one, and reversible by the person who can judge it.
 *
 * ## The ROW no longer prints it, and the sentence that used to say so is
 * corrected here rather than quietly left standing
 *
 * This paragraph read "the row prints 'ticked by claude, over MCP' rather than a
 * bare checkmark". It does not any more:
 *
 * > "in checklist, information about what checklist items is and isn't written
 * > by Claude is not important information, get rid of it."
 *
 * That is a judgement about a 220-pixel container rather than a hole in the
 * argument, so it is worth being exact about what moved.
 *
 * **The record did not.** `by` and `viaMcp` are still written on every tick,
 * still stored, and `viaMcp` is still never inferred from the name — which is
 * why the field's own comment below no longer says "printed on the row". Taking
 * the DISPLAY out is a rewording of one line of UI; taking the FIELDS out would
 * be a migration with no undo, over somebody's record of who did what.
 *
 * **The place the claim is legible moved to where it was always doing more
 * work.** `tick` in `tools()` answers an agent with `… is ticked for <target>,
 * by <name>`, so an agent is told what it just asserted and in whose name; and
 * the store is a JSON file in the project that a person can read. Neither of
 * those depended on a badge under a checkmark, which was read only by somebody
 * already looking at the tick and, in this container, nearly always the only
 * person using it.
 *
 * **And the load-bearing half was never the badge.** "Legible as a claim and
 * REVERSIBLE by the person who can judge it" — reversibility is what makes an
 * agent's tick safe, it is a property of the row, and the row still has it at
 * every size, with nothing behind a press. See the essay on `ItemRow` in
 * `src/view/checklist.tsx`, which says the same from the other side.
 *
 * If somebody wants an item only they may tick, they write it as a question and
 * untick what they disagree with. That is a better answer than a permission
 * model, because a permission model would have to be configured, and the thing
 * it configures — "which of my own lines do I not trust an agent with" — is a
 * judgement that changes per item, per agent and per day.
 */
export const tickSchema = z.object({
  /**
   * What the person or agent found: `passed`, `failed`, or `na` (not applicable).
   *
   * A tick written before states existed has none and reads as `passed`, which
   * is what every one of them meant. An item with no tick is unchecked, which
   * is the absence of a tick and never a value here.
   */
  state: z.enum(TICK_STATES).default('passed'),
  at: z.string(),
  /** The agent's own name, or the owner as this app's page files them. */
  by: z.string(),
  /**
   * Whether it arrived through the MCP door.
   *
   * Never inferred from the name — an agent may call itself anything, and a
   * program that guessed "this looks like an agent" would be making up the one
   * fact this field exists to record. It is no longer drawn on the row (see the
   * essay above); it is still stored, still answered to an agent by the MCP
   * door, and still readable in the file.
   */
  viaMcp: z.boolean().default(false),
  /** How they know. */
  note: z.string().optional(),
  /**
   * What the tracker said about the target's fact when this was ticked — the
   * fact the item names as its evidence, as the page was showing it. Written
   * only by the page, only on a ref target, and only when the host had
   * handed over a reading; an agent's tick through the MCP door has none,
   * because this app's server never reads a tracker. See `list/evidence.ts`,
   * and why a fact informs a tick and never makes one.
   */
  evidence: evidenceSchema.optional(),
})
export type Tick = z.infer<typeof tickSchema>

/** What an item says for a target: its tick's state, or `unchecked` when there is none. */
export function stateOf(tick: { state?: TickState } | null | undefined): TickState | 'unchecked' {
  return tick ? (tick.state ?? 'passed') : 'unchecked'
}

/** How many of these rows are in each state. They add up to the number of rows. */
export function countRows(rows: { done: { state?: TickState } | null }[]): Record<TickState | 'unchecked', number> {
  const counts = { passed: 0, failed: 0, na: 0, unchecked: 0 }
  for (const row of rows) counts[stateOf(row.done)] += 1
  return counts
}

export const itemSchema = z.object({
  /**
   * This app's own handle for the item, which is what an agent addresses it by.
   *
   * Not the text and not the position. The text is the thing most likely to be
   * reworded and the position is the thing most likely to move, so either as an
   * identifier would mean every call an agent made pointed at whatever happened
   * to be there afterwards. Eight hex characters: short enough to type into a
   * tool call, and there are not going to be four billion items on one list.
   */
  id: z.string(),
  /** The line, as somebody typed it. Wrapped wherever it is drawn, never clipped. */
  text: z.string(),
  at: z.string(),
  by: z.string(),
  /**
   * Which of the tracker's facts about a ref target is this item's evidence —
   * `pipeline` for "pipeline is green", `description` for "the description
   * explains the why". Absent for an item no tracker fact speaks to, which is
   * most of them, and for every item written before this field existed.
   *
   * A property of the ITEM rather than of a tick, because it is a statement
   * about what the line means, said once on the edit page, and the same for
   * every target the list is held against.
   */
  fact: z.enum(FACTS).optional(),
})
export type Item = z.infer<typeof itemSchema>

/**
 * One checklist.
 *
 * ## Order is the array's order, and there is no `order` field
 *
 * A hand-written list has an order the person chose, it has to survive a reload,
 * and so it is stored. It is stored as the ORDER OF THE ARRAY rather than as a
 * number on each item, which is the decision worth writing down because the
 * other way is the one that looks tidier.
 *
 * A numeric `order` field is two sources for one fact: the array has an order
 * whether or not anybody meant it to, so a file whose numbers disagreed with its
 * array would hold two answers and no way to say which was meant. Every reorder
 * is then a write across every row, and the first partial write leaves two items
 * claiming position 3. The array is the single source, `move` rewrites it whole,
 * and a reader that does nothing but iterate gets the right answer without
 * knowing the rule.
 */
export const checklistSchema = z.object({
  id: z.string(),
  name: z.string(),
  at: z.string(),
  by: z.string(),
  /**
   * Where this list came from, when it was not typed here.
   *
   * The only value written today is `papers.json:<epic>`, and it exists so the
   * migration below can be run twice without making two copies of somebody's
   * list. It is deliberately a string rather than a boolean: the next thing
   * imported into this store will want to say where IT came from, and a boolean
   * named `migrated` would have to be replaced rather than extended.
   */
  origin: z.string().nullable().default(null),
  items: z.array(itemSchema).default([]),
  /**
   * What this list is HELD AGAINST: the keys of its targets, as `targetKey`
   * spells them. A stored property of the list, set by a person on the edit
   * page or by an agent through `hold_checklist`, and by nothing else.
   *
   * ## This field is the answer to the report, and its shape is the argument
   *
   * The owner, three times in three wordings, and this is the third:
   *
   * > "I want to be able to connect one or more checklists in papers case to
   * > sections or tex files and I want that to stick. … I dont want it to be
   * > able to change on the fly, only when I am in edit mode of that
   * > checklist."
   *
   * Under the model this replaces a list was "held against" whatever it had
   * TICKS on: a pairing came into being the first time somebody ticked an item
   * against a target, and never before. That is why the owner's own store, on
   * disk, held seven chapter checklists and `"ticks": {}` — every one of them
   * was about a chapter and not one of them was held against anything, because
   * nothing had been ticked yet. The connection they asked for could not be
   * written down, so the container derived one from wherever they had scrolled
   * to, and derived a different one on the next scroll.
   *
   * So the connection is a field. Plural, because "one or more"; keys rather
   * than `Target` objects because the `ticks` map below is already keyed by the
   * same spelling, and one spelling in the file is what lets a person reading
   * it join the two by eye.
   *
   * ## Optional in the schema, and the absence MEANS something
   *
   * Every other field a later version added arrived with `.default()`. This
   * one is `.optional()`, deliberately, because an absent array and an empty
   * one are two different facts about a file. Absent says "written before this
   * field existed", and `settleTargets` fills it in from the ticks — a target
   * somebody ticked against under the old model is a target they meant. Empty
   * says "somebody released every target on purpose", and has to stay empty. A
   * `.default([])` would make the second indistinguishable from the first, and
   * a release would quietly undo itself on the next read.
   *
   * ## Layout 1 only
   *
   * This field is how `checklists.json` held it, and that file is read now
   * only to migrate it. Since layout 2 a hold is an ENTRY under
   * `targets/<list>/`, beside the ticks made on the same target (`entrySchema`
   * below), and `settleTargets` runs once, inside that migration
   * (`list/book.ts`). The field stays in the schema so a layout-1 file still
   * parses.
   */
  targets: z.array(z.string()).optional(),
  /**
   * Which module's work this list is FOR, as that module's id —
   * `kehikot.screenplay` — or absent, which is every module's.
   *
   * ## Why a list needs to say it, when it already says what it is held against
   *
   * A target is a place: a reference, or a place in a paper. Several modules
   * report the SAME place as what they show — Paper the section being read,
   * Slides the section its slide is linked to, Screenplay the chapter its
   * narration is about — so "what a screenplay owes its learner" held against
   * a chapter was in front of all three, eighteen lines about narration beside
   * a page of prose. What it is held against cannot tell them apart, because
   * it is the same for all of them. Whose work it is about can.
   *
   * It is a property of the LIST and not of a target, because it is a fact
   * about what the lines say: a list about narration is about narration in
   * every chapter it is held against. Ticks are untouched by it — still the
   * list, the item and the target together.
   *
   * ## Absent is every module's, and nothing is filled in
   *
   * `.optional()` like an item's `fact`, and for its reason rather than
   * `targets`': there is nothing to derive. Every list written before this
   * field existed has none, is every module's, and is in front exactly where
   * it was. `forPicked` in `list/aim.ts` is the rule that reads it.
   */
  for: z.string().optional(),
})

/**
 * The single file this folder held up to version 1: `checklists.json`, every
 * list with the keys of everything it is held against, and every tick, nested
 * checklist → target → item. Read only to migrate it (`list/book.ts`), and by
 * nothing that writes.
 */
export const legacySchema = z.object({
  checklists: z.record(z.string(), checklistSchema).default({}),
  ticks: z.record(z.string(), z.record(z.string(), z.record(z.string(), tickSchema))).default({}),
})
export type Legacy = z.infer<typeof legacySchema>

/* ------------------------------------------------------------------ *
 * Layout 2: what `list/book.ts` writes
 * ------------------------------------------------------------------ */

/**
 * One checklist as `lists.json` holds it: what the list SAYS, and none of
 * what it is held against.
 *
 * `holds` is how many targets it is held against, kept here so that the list
 * of every checklist can say it without opening the list's folder. It is a
 * count of what the folder holds and never the other way round: whenever a
 * list's folder is read whole (the edit page, Storage, a migration) the count
 * is taken again from the entries, so a count that drifted — a write that
 * landed in the folder and not here — mends itself on the next look.
 *
 * `next` is the order the next hold is given (`n` on the entry), which is the
 * order the edit page draws the targets in: the order they were held.
 */
export const listSchema = checklistSchema.omit({ targets: true }).extend({
  holds: z.number().int().min(0).default(0),
  next: z.number().int().min(0).default(0),
})
export type List = z.infer<typeof listSchema>

/** `lists.json`, whole. `layout` is what tells this file from the one before it. */
export const listsFileSchema = z.object({
  layout: z.literal(2),
  checklists: z.record(z.string(), listSchema).default({}),
})
export type ListsFile = z.infer<typeof listsFileSchema>

/**
 * One target of one list: whether the list is held against it, and the ticks
 * made there.
 *
 * Held while `since` is present. A released target keeps its ticks and says
 * when it was let go (`released`), which is what Storage counts as kept ticks
 * and what Purge measures an age by. An entry that is neither held nor
 * carries a tick says nothing, and is never written.
 */
export const entrySchema = z.object({
  since: z.string().optional(),
  n: z.number().int().min(0).optional(),
  released: z.string().optional(),
  ticks: z.record(z.string(), tickSchema).optional(),
})
export type Entry = z.infer<typeof entrySchema>

/** One file under `targets/<list>/`: the entries whose target falls in that bucket. */
export const shardSchema = z.record(z.string(), entrySchema)
export type Shard = z.infer<typeof shardSchema>

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'

import { dataFile, makeDir, oldPapersFile } from '../store.ts'
import { showing } from './holding.ts'
import { readKey, targetKey, targetName, type Target } from './targets.ts'

/**
 * Every checklist this app holds, and every tick anybody has made on one.
 *
 * ## One kind of list, and what that replaced
 *
 * This module used to hold three kinds. Two of them were DERIVED and hardcoded:
 * a list a merge request owed and a list an issue owed, whose items were `case`
 * arms in a `derive()` function and whose wording shipped in the program. The
 * third was hand-written, one per paper, keyed by epic. There was a settings
 * store on top of the first two for rewording them, exempting them per tracker,
 * and adding items — an editing layer over a list nobody could actually delete,
 * because the shipped list was the fallback the whole thing rested on.
 *
 * All of that is gone, and the sentence that removed it is the user's:
 *
 * > "when user looks at the checklist for the first time in a kehikko they are
 * > supposed to pick an existing checklist or create their own checklist. That
 * > way we don't need to hardcode specific lists or list types, right?"
 *
 * Right. A hardcoded list is this program having an opinion about somebody
 * else's work, and every mechanism that made it bearable — the rewording, the
 * exemptions, the shipped-beside-the-edit view, the seven verdicts for items
 * read off a tracker this app never speaks to — existed only to soften that
 * opinion. Take the opinion away and none of the machinery has a subject.
 *
 * So: **a checklist is a named thing a person created.** Nothing ships one, this
 * file has no defaults in it, and an empty store is an app with no checklists,
 * which is the correct state on a first run rather than a fault.
 *
 * ## Ticks are per (checklist, target, item), and that is the useful half kept
 *
 * The derived lists were scoped to a reference, and being scoped to something
 * was the good idea in them. It is kept and generalised: a checklist is APPLIED
 * to a target, and the ticks belong to the triple. The same list held against
 * `gh#105` and `gh#106` keeps two independent sets, because those are two pieces
 * of work. See `list/targets.ts` for what a target is and, in particular, for
 * the honest account of what a paper target does when the paper changes
 * underneath it.
 *
 * ## Why this file refuses to write when it cannot read
 *
 * Carried whole from the paper store this replaces, because the argument is
 * about authored material and every list here is now authored.
 *
 * The old `checklist.json` reader answered an unparseable byte with the SHIPPED
 * list, which was defensible: it still showed a real checklist, and the edits it
 * lost were re-makeable. There is no shipped list any more and there is nothing
 * to fall back to. So "the file is empty" and "the file is broken" would be
 * indistinguishable — a single corrupt byte would silently present somebody's
 * checklists as never having existed, on a page that looked perfectly fine, and
 * the first write after that would flatten them for good.
 *
 * Therefore the trouble travels with the read, every caller has to look at it,
 * and a non-null `trouble` blocks every write below. The file is prose nobody
 * can retype from memory; it is worth a screen that says so.
 *
 * ## Migration is additive, always
 *
 * The rule this workspace applies to a database — never drop, never rename, add
 * a field with a default so an older file opens without complaint — is spelled
 * here in zod: every field a later version adds arrives with `.default()` or
 * `.optional()`, so a file written today parses under next year's schema and
 * gains the new field's default rather than failing to parse. A failed parse is
 * not a missing field; it is the whole file read as trouble.
 */

/* ------------------------------------------------------------------ *
 * The shapes
 * ------------------------------------------------------------------ */

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
const tickSchema = z.object({
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
})
export type Tick = z.infer<typeof tickSchema>

const itemSchema = z.object({
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
const checklistSchema = z.object({
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
   * `Checklist` below narrows it back to `string[]`: past `read()` the field is
   * always there, and nothing downstream should have to ask.
   */
  targets: z.array(z.string()).optional(),
})
export type Checklist = Omit<z.infer<typeof checklistSchema>, 'targets'> & { targets: string[] }

const storeSchema = z.object({
  checklists: z.record(z.string(), checklistSchema).default({}),
  /**
   * Ticks, nested checklist → target → item.
   *
   * Nested rather than a flat record keyed by a joined triple, because every
   * question this app asks is "what is ticked on THIS list against THIS target",
   * and a flat key would mean scanning every tick in the file to answer it. The
   * nesting is also what makes dropping a checklist, or dropping a target, one
   * delete instead of a filter.
   */
  ticks: z.record(z.string(), z.record(z.string(), z.record(z.string(), tickSchema))).default({}),
})
type Store = z.infer<typeof storeSchema>

/**
 * This project's file, or null when there is no project and nothing to open.
 *
 * A thin pass-through to `store.ts`, kept exported because the tests assert
 * against the bytes on disk and because `dev/migrate.ts` writes to exactly the
 * path this names — two programs agreeing about a location by calling the same
 * function rather than by joining the same strings.
 */
export function checklistsFile(projectPath: string | null | undefined): string | null {
  return dataFile(projectPath).path
}

const empty = (): Store => storeSchema.parse({})

/* ------------------------------------------------------------------ *
 * The migration, which runs on read
 * ------------------------------------------------------------------ */

/**
 * The shape `data/papers.json` had, read defensively.
 *
 * A separate schema from anything above, deliberately loose, and it lives here
 * rather than in the file it describes because that file is gone. What it has to
 * do is open a document written by a program that no longer exists, on a machine
 * where somebody typed real sentences into it. Every field is optional or
 * defaulted for the same reason the rest of this store's are: a strict parse
 * would turn one unexpected key into "there was nothing to migrate", which is
 * the exact failure mode this whole module argues against.
 */
const oldPapersSchema = z.object({
  papers: z
    .record(
      z.string(),
      z.object({
        items: z
          .array(
            z.object({
              id: z.string(),
              text: z.string(),
              at: z.string().default(() => new Date().toISOString()),
              by: z.string().default('somebody who did not say'),
              done: z
                .object({
                  at: z.string(),
                  by: z.string(),
                  viaMcp: z.boolean().default(false),
                  note: z.string().optional(),
                })
                .nullable()
                .default(null),
            }),
          )
          .default([]),
      }),
    )
    .default({}),
})

export function papersFile(projectPath: string | null | undefined): string | null {
  return oldPapersFile(projectPath)
}

/**
 * Bring the hand-written paper lists across, once, without losing anything.
 *
 * ## Why a migration at all, when the derived lists were simply deleted
 *
 * Because nobody typed the derived lists. They were `case` arms and shipped
 * wording, and the ticks against them were ticks on items this program invented;
 * deleting the items and the ticks together loses a record of a program's own
 * opinion, which is not a loss. The paper lists are the opposite: every line on
 * one is a sentence a person wrote about their own document, and under the new
 * model they are not a special kind of thing at all — a hand-written list of
 * what a paper owes IS an ordinary checklist held against a paper target. So
 * there is nothing to convert except the key it is filed under.
 *
 * ## Why it runs on read rather than as a script
 *
 * A migration script has to be RUN, and the person who has to run it is the one
 * who does not know it exists — they copied this directory to another machine,
 * as `store.ts` promises they can, and started it. A migration on read has no
 * such step: the first thing that opens the store does it, whatever that thing
 * is, and the page, the MCP door and a test all get the same answer.
 *
 * ## Why it is idempotent, and how
 *
 * Each migrated checklist carries `origin: "papers.json:<epic>"`. An epic whose
 * origin is already present is skipped, so running this on every single read —
 * which is what happens — converts each paper exactly once. It is deliberately
 * NOT a flag on the store saying "migration done": such a flag makes the file
 * and the marker two sources for one fact, and a person who restores an old
 * `papers.json` from a backup would find it silently ignored.
 *
 * `papers.json` is left on disk untouched. Deleting somebody's file as a side
 * effect of reading is not a thing a program should do, and keeping it means a
 * migration that went wrong can be looked at rather than reconstructed.
 */
function migrate(store: Store, projectPath: string | null | undefined): boolean {
  const path = papersFile(projectPath)
  if (path === null || !existsSync(path)) return false
  let old: z.infer<typeof oldPapersSchema>
  try {
    old = oldPapersSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    /* Unreadable, and this is the one place in this file that shrugs at that.
       `papers.json` is no longer a store — nothing writes it and nothing else
       reads it — so a broken one is a broken backup, not lost live material, and
       refusing to open the checklists at all because of it would make an old
       file able to disable the app. */
    return false
  }

  const already = new Set(
    Object.values(store.checklists)
      .map((list) => list.origin)
      .filter((origin): origin is string => typeof origin === 'string'),
  )

  let changed = false
  for (const [epic, paper] of Object.entries(old.papers)) {
    if (!paper.items.length) continue
    const origin = `papers.json:${epic}`
    if (already.has(origin)) continue

    /* The id is derived from the epic rather than random, so that migrating the
       same file on two machines produces the same id — which is what makes a
       `data/` directory copied between them, as this app's whole claim says it
       can be, still name one list rather than two. */
    const id = `paper-${epic}`.slice(0, 64)
    const at = paper.items[0]?.at ?? new Date().toISOString()
    store.checklists[id] = {
      id,
      name: `${epic} — what the paper owes`,
      at,
      by: paper.items[0]?.by ?? 'somebody who did not say',
      origin,
      items: paper.items.map((item) => ({ id: item.id, text: item.text, at: item.at, by: item.by })),
    }

    /* The target is the whole paper for that epic, not a section of it. That is
       the honest reading of what the old store held: it was keyed by epic and
       nothing in it ever named a place inside the document, so inventing a
       section here would be this migration claiming to know something the file
       never said. */
    const key = targetKey({ kind: 'paper', epic, section: null })
    /* And the list IS held against that paper, ticks or no ticks: being about
       one paper was the whole meaning of the old store's key. */
    store.checklists[id]!.targets = [key]
    const ticked: Record<string, Tick> = {}
    for (const item of paper.items) {
      if (!item.done) continue
      ticked[item.id] = {
        at: item.done.at,
        by: item.done.by,
        viaMcp: item.done.viaMcp,
        ...(item.done.note ? { note: item.done.note } : {}),
      }
    }
    if (Object.keys(ticked).length) store.ticks[id] = { [key]: ticked }
    changed = true
  }
  return changed
}

/* ------------------------------------------------------------------ *
 * Reading and writing the file
 * ------------------------------------------------------------------ */

/**
 * What opening this project's store can produce.
 *
 * Three states rather than two, and the middle one is what the move into the
 * project added. They are kept apart all the way to the screen, because they
 * send a reader to three different places:
 *
 * - `here` — a project was named and the file was read, or was simply not there
 *   yet, which is an empty store and not a fault.
 * - `nowhere` — no project is open. There is nothing to show and nothing to
 *   write, and neither of those is an error.
 * - `trouble` — a project was named and something is wrong with it: the path
 *   escapes the project, the folder is not on this machine, or the file will not
 *   parse. The sentence says which.
 *
 * `nowhere` deliberately does NOT come back as an empty store with no trouble,
 * even though that would draw a blank container and look perfectly fine. An empty
 * store is a thing a later write may flatten a real file with; "there is nowhere
 * to write" has to be refused rather than written, and this one field is what
 * keeps those two apart at every call site below.
 */
type Opened = { store: Store; where: 'here' | 'nowhere'; trouble: string | null }

function read(projectPath: string | null | undefined): Opened {
  const { path, trouble: refused } = dataFile(projectPath)
  if (refused) return { store: empty(), where: 'here', trouble: refused }
  if (path === null) return { store: empty(), where: 'nowhere', trouble: null }

  let store: Store
  if (!existsSync(path)) {
    store = empty()
  } else {
    try {
      store = storeSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    } catch (e) {
      return {
        store: empty(),
        where: 'here',
        trouble:
          `${path} could not be read (${e instanceof Error ? e.message.split('\n')[0] : String(e)}), so no ` +
          'checklist is being shown and nothing will be written over it. Every list and every tick in that file is ' +
          'recoverable: fix or move it.',
      }
    }
  }
  /* The migration is inside the read and after the trouble check, which is the
     only safe order: bringing somebody's paper lists across into a store this
     app has just failed to parse would write them over the file it could not
     read. */
  const moved = migrate(store, projectPath)
  const settled = settleTargets(store)
  if (moved || settled) save(store, projectPath)
  return { store, where: 'here', trouble: null }
}

/**
 * Give every list written before `targets` existed the targets it already had.
 *
 * A file from the previous version has no `targets` on any list, and it may
 * have ticks. Under that version a tick WAS the assignment — the only way a
 * list came to be about `gh#105` was somebody ticking an item against it — so
 * the keys of its tick map are exactly the targets that person meant, and they
 * are copied across. No tick is touched, and none is dropped. A list with no
 * ticks gets `[]`, which is the true answer: nothing had ever connected it to
 * anything, and that is the state the owner's seven chapter lists were in on
 * disk when this was written (`test/targets.test.ts` opens a copy of that file).
 *
 * Runs once per list: after this the field is present and `optional()` no
 * longer fires — see the essay on the field. Idempotent for the same reason
 * the papers migration is, which is that the file itself is the marker.
 */
function settleTargets(store: Store): boolean {
  let changed = false
  for (const list of Object.values(store.checklists)) {
    if (Array.isArray(list.targets)) continue
    list.targets = Object.keys(store.ticks[list.id] ?? {})
    changed = true
  }
  return changed
}

/** A list as everything past `read()` holds it: `targets` present, always. */
function settled(list: z.infer<typeof checklistSchema>): Checklist {
  return { ...list, targets: list.targets ?? [] }
}

/**
 * Write the store into this project's folder, making the folder if it is not
 * there — and answering with a sentence rather than throwing when there is
 * nowhere to make it.
 *
 * `makeDir` is called HERE and nowhere on the read path, which is what stops
 * this app leaving a `.kehikot/` in every repository somebody happens to open a
 * checklist container against. The folder appears on the first save, which is the
 * first moment this project actually has a checklist to hold — and that is also
 * the one moment the project's `.gitignore` is told about it.
 *
 * A refusal comes back as a string because every caller already has somewhere to
 * put one: `change()` answers `{ ok: false, error }`, and that sentence reaches
 * both the page and an agent. An exception here would surface at the door as a
 * 500 with nothing anybody could act on.
 */
function save(store: Store, projectPath: string | null | undefined): string | null {
  const made = makeDir(projectPath)
  if (made.trouble) return made.trouble
  if (made.dir === null) return NOWHERE
  const { path, trouble } = dataFile(projectPath)
  if (trouble) return trouble
  if (path === null) return NOWHERE
  writeFileSync(path, `${JSON.stringify(storeSchema.parse(store), null, 2)}\n`)
  return null
}

/**
 * What a write is told when nothing said which project this is.
 *
 * Written once and shared by every refusal below, because it is the same fact
 * every time and because a person who sees it in the container and an agent who reads
 * it out of a tool call should be reading the same sentence. It says where a
 * checklist lives, which is the part that makes the refusal actionable rather
 * than merely true.
 */
const NOWHERE =
  'there is no project open, so there is nowhere to keep a checklist. A checklist lives in the project it is '
  + 'about — in its .kehikot/checklist folder — and this app will not guess at which project that is: a guess '
  + 'would write somebody’s list into a repository they will never look in, under a screen saying it had been saved.'

/* ------------------------------------------------------------------ *
 * What arrives, bounded before it is looked at
 * ------------------------------------------------------------------ */

/**
 * A checklist's name.
 *
 * Long enough to say what the list is for, short enough that it is a name rather
 * than the first item. Names are drawn in a container 220 pixels wide and wrapped
 * rather than clipped, so a long one costs lines rather than hiding itself.
 */
export const MAX_NAME = 120
/**
 * One item's text.
 *
 * Long enough for a sentence with a clause in it, short enough that the file
 * cannot be filled by one call. An item is a line on a list; the reasoning
 * behind it belongs in the work.
 */
export const MAX_TEXT = 400
export const MAX_BY = 80
export const MAX_NOTE = 400
export const MAX_ID = 64
/**
 * How many items one checklist may hold, and how many checklists there may be.
 *
 * Not a guess at how long a list should be — they are bounds on a file that a
 * caller with no rate limit can append to. 200 items is already a list nobody
 * reads to the end of, and 200 checklists is more than a person will name.
 */
export const MAX_ITEMS = 200
export const MAX_LISTS = 200
/** How many targets one checklist may be held against. A thesis is seven chapters; sixty-four is a mistake. */
export const MAX_TARGETS = 64

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * What to call a project in a sentence, given its path.
 *
 * The last segment, because that is what the host calls it too and what a
 * person reading a refusal or an `origin` recognises. The whole path is the
 * fallback for the one directory that has no last segment, which is the
 * filesystem root, which nobody opens as a project.
 */
function named(path: string): string {
  return basename(path) || path || 'another project'
}

/**
 * How many times an imported name may be nudged before this gives up.
 *
 * A bound rather than a loop to exhaustion: twenty is far past the point where
 * a person is being helped, and a name that has been counted to twenty is one
 * somebody should be told about rather than one this app should keep guessing
 * at.
 */
const MAX_RENAMES = 20

/**
 * A name for an imported list that no list here already has.
 *
 * ## Why an import renames where a create refuses
 *
 * `create` refuses a duplicate name and hands back the clashing id, and that is
 * right there: somebody has just typed a name, so somebody can type a different
 * one, and the refusal tells them which list they probably meant.
 *
 * An import has no such person to send back to. The name was typed in another
 * project, possibly months ago and possibly by somebody else, and the only way
 * to satisfy a refusal would be to go and rename a list in a project that is not
 * open. So the copy takes a name it can have, and the sentence that comes back
 * says which one — nothing happens silently, and the alternative is a screen
 * that refuses a perfectly reasonable act and offers no control that would fix
 * it.
 *
 * What is NOT allowed is two lists with one name, because that is the failure
 * `create`'s refusal exists to prevent: a person picking the wrong one on the
 * screen where they cannot tell them apart. That failure is exactly as bad for
 * a copy, so the rule survives and only the remedy changes.
 *
 * The first fallback says where it came from, which is the most useful thing a
 * disambiguator can say here — `"What a change owes (from thesis)"` reads as an
 * answer rather than as a collision. After that it counts, and then it gives up,
 * at which point somebody really does have to rename something and the refusal
 * says so.
 *
 * Compared case-insensitively, like `create`'s clash check, because two names
 * differing only in capitals are two names nobody can tell apart on a row. And
 * every candidate is length-checked, because a long name plus a suffix is a
 * name past `MAX_NAME` — which would be stored clipped, and a clipped name can
 * collide with the very thing it was lengthened to avoid.
 */
function free(wanted: string, here: readonly { name: string }[], project: string): string | null {
  const taken = new Set(here.map((list) => list.name.toLowerCase()))
  const fits = (name: string): string | null =>
    name.length <= MAX_NAME && !taken.has(name.toLowerCase()) ? name : null

  const asIs = fits(wanted)
  if (asIs) return asIs
  const said = fits(`${wanted} (from ${project})`)
  if (said) return said
  for (let n = 2; n <= MAX_RENAMES; n += 1) {
    const numbered = fits(`${wanted} (from ${project}) ${n}`)
    if (numbered) return numbered
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** One line about a checklist, for the pick-or-create screen and the tool. */
export interface Summary {
  id: string
  name: string
  at: string
  by: string
  items: number
  /** How many targets this list is held against. */
  targets: number
  /** Which ones, so the screen listing every checklist can say where each is in use. */
  held: Target[]
}

export interface Held {
  checklist: Checklist
  /** The target these ticks are for, or null when the list is being read on its own. */
  target: Target | null
  rows: { item: Item; done: Tick | null }[]
  done: number
  total: number
}

export interface Store_ {
  lists: Summary[]
  trouble: string | null
  /**
   * True when nothing said which project this is, so there is nowhere to look.
   *
   * Beside `trouble` rather than folded into it, because it is not a fault and
   * must not be drawn as one. A container that printed "no project open" in the same
   * red box as "this file will not parse" would be teaching a reader that the
   * ordinary state is a breakage.
   */
  nowhere: boolean
}

/** Every checklist in this project, by name. */
export function checklists(projectPath: string | null | undefined): Store_ {
  const { store, where, trouble } = read(projectPath)
  const lists = Object.values(store.checklists)
    .map((list) => ({
      id: list.id,
      name: list.name,
      at: list.at,
      by: list.by,
      items: list.items.length,
      targets: (list.targets ?? []).length,
      held: (list.targets ?? []).map(readKey).filter((one): one is Target => one !== null),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { lists, trouble, nowhere: where === 'nowhere' }
}

/**
 * One checklist, with the ticks for one target beside each item.
 *
 * `target` may be null, which is the list read on its own — every row unticked,
 * because there is nothing for a tick to be ABOUT. That is not the same as a
 * target with no ticks yet, and the page says which it is: a list with no target
 * is not something anybody can tick.
 */
export function held(
  id: string,
  target: Target | null,
  projectPath: string | null | undefined,
): { held: Held | null; trouble: string | null; nowhere: boolean } {
  const { store, where, trouble } = read(projectPath)
  const nowhere = where === 'nowhere'
  const checklist = store.checklists[id]
  if (!checklist) return { held: null, trouble, nowhere }
  const on = target ? (store.ticks[id]?.[targetKey(target)] ?? {}) : {}
  const rows = checklist.items.map((item) => ({ item, done: on[item.id] ?? null }))
  return {
    held: { checklist: settled(checklist), target, rows, done: rows.filter((r) => r.done).length, total: rows.length },
    trouble,
    nowhere,
  }
}

/**
 * Every target one checklist is held against, with how much is ticked on each.
 *
 * Read off `targets`, not off the tick map, and that is the change. A target
 * with ticks on it that somebody has since released is NOT listed: the ticks
 * stay in the file untouched and come back the moment the target is held
 * again (see `release` below). What this answers is "where is this list in
 * use", and a released target is precisely the thing that is not.
 */
export function targetsOf(id: string, projectPath: string | null | undefined): { target: Target; done: number }[] {
  const { store } = read(projectPath)
  const list = store.checklists[id]
  if (!list) return []
  return (list.targets ?? [])
    .map((key) => {
      const target = readKey(key)
      return target ? { target, done: Object.keys(store.ticks[id]?.[key] ?? {}).length } : null
    })
    .filter((row): row is { target: Target; done: number } => row !== null)
}

/**
 * Every checklist in front of a reader, each with the ticks for the target it
 * is in front of them AS.
 *
 * One read of the file for the whole answer, which is the reason this is here
 * rather than in `doors.ts` calling `held` once per list: the reading page asks
 * this on every context, and a context arrives after every selection change
 * anywhere on the canvas. `showing` in `list/holding.ts` decides which pairings
 * qualify and is pure; this is the half that has the store.
 */
export function inFront(
  input: { ladder: string; selection: string[] },
  projectPath: string | null | undefined,
): { instances: Held[]; trouble: string | null; nowhere: boolean } {
  const { store, where, trouble } = read(projectPath)
  const lists = Object.values(store.checklists)
    .map((list) => ({ id: list.id, name: list.name, targets: list.targets ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const instances = showing({ ladder: input.ladder, selection: input.selection, lists }).flatMap((one) => {
    const list = store.checklists[one.id]
    if (!list) return []
    const on = store.ticks[one.id]?.[targetKey(one.target)] ?? {}
    const rows = list.items.map((item) => ({ item, done: on[item.id] ?? null }))
    return [{ checklist: settled(list), target: one.target, rows, done: rows.filter((r) => r.done).length, total: rows.length }]
  })
  return { instances, trouble, nowhere: where === 'nowhere' }
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type Op =
  | { op: 'create'; name: string; by: string; viaMcp?: boolean }
  | { op: 'rename'; id: string; name: string; by: string; viaMcp?: boolean }
  | { op: 'forget'; id: string; by: string; viaMcp?: boolean }
  /**
   * Copy a checklist out of ANOTHER project into this one.
   *
   * The one operation here that reads two stores, and the only one whose `id`
   * names something that is not in the project being written to: `from` is the
   * source project's path and `id` is the checklist's id THERE.
   *
   * ## Where `from` comes from, and why this store does not care
   *
   * A person picked it. The page asks the host `projects.pick`, the host draws
   * the dialog out of its own projects, and the answer is one absolute path.
   * This module has no way to enumerate projects and must never grow one — see
   * the protocol's `projects:pick`. From this file's side that is invisible and
   * deliberately so: `from` is a project path exactly like `projectPath`, goes
   * through the same `store.ts` fence, and is refused by the same sentences if
   * it is not a folder on this machine. A store that treated a picked path as
   * more trustworthy than the open one would be a fence with a gate in it.
   */
  | { op: 'import'; from: string; id: string; by: string; viaMcp?: boolean }
  | { op: 'add'; id: string; text: string; by: string; viaMcp?: boolean }
  | { op: 'reword'; id: string; item: string; text: string; by: string; viaMcp?: boolean }
  | { op: 'move'; id: string; item: string; to: number; by: string; viaMcp?: boolean }
  | { op: 'drop'; id: string; item: string; by: string; viaMcp?: boolean }
  /**
   * Hold this list against one more target, or stop holding it against one.
   *
   * The two writes the report asked for, and the only two that change what a
   * list is ABOUT; everything else here changes what a list says or what has
   * been done on it. `release` never deletes a tick. The ticks against a
   * released target stay in the file and are shown again the moment the target
   * is held again, because "I no longer want this list in front of me in
   * chapter 3" and "forget what was done in chapter 3" are two sentences, and
   * only the first was said.
   */
  | { op: 'hold'; id: string; target: Target; by: string; viaMcp?: boolean }
  | { op: 'release'; id: string; target: Target; by: string; viaMcp?: boolean }
  | { op: 'tick'; id: string; item: string; target: Target; done: boolean; by: string; viaMcp?: boolean; note?: string }

export type Result =
  | { ok: true; said: string; lists: Summary[]; held: Held | null; id: string }
  | { ok: false; error: string }

/**
 * Change something, and say what happened in a sentence somebody can read back.
 *
 * One function for every operation, so the page and the MCP door cannot end up
 * applying two different rules to the same list — and so every refusal below is
 * written once and read by both. Each names what was wrong and what to do
 * instead; a bare "no" is the kind of refusal an agent routes around.
 */
export function change(input: Op, projectPath: string | null | undefined): Result {
  const opened = read(projectPath)
  const store = opened.store
  if (opened.trouble) return { ok: false, error: `nothing was changed. ${opened.trouble}` }
  /* Refused BEFORE anything is decided, and refused rather than being allowed to
     succeed against an empty store nobody will ever see again. This is the
     failure the whole move has to not have: a checklist written into a store
     with no file behind it is a list somebody typed, watched appear, and cannot
     find tomorrow. */
  if (opened.where === 'nowhere') return { ok: false, error: `nothing was changed. ${NOWHERE}` }

  const by = input.by.trim().slice(0, MAX_BY) || 'somebody who did not say'
  const at = new Date().toISOString()

  /**
   * Write, and answer with what is now true — or hand back the refusal the
   * write produced.
   *
   * The saved-then-read shape matters here. `save` can fail for reasons that
   * only appear at the moment of writing — a `.kehikot` that became a symlink
   * between the read and the write, a folder that went away — and a function
   * that reported success on a write it had not checked would tell the page a
   * tick had landed when nothing had been written at all.
   */
  const answer = (id: string, said: string, target: Target | null): Result => {
    const refused = save(store, projectPath)
    if (refused) return { ok: false, error: `nothing was changed. ${refused}` }
    const list = store.checklists[id]
    const on = target && list ? (store.ticks[id]?.[targetKey(target)] ?? {}) : {}
    const rows = (list?.items ?? []).map((item) => ({ item, done: on[item.id] ?? null }))
    return {
      ok: true,
      said,
      id,
      lists: checklists(projectPath).lists,
      held: list
        ? { checklist: settled(list), target, rows, done: rows.filter((r) => r.done).length, total: rows.length }
        : null,
    }
  }

  if (input.op === 'create') {
    const name = input.name.trim().slice(0, MAX_NAME)
    if (!name) {
      return {
        ok: false,
        error:
          'a checklist needs a name. Nothing here ships a list, so the name is the only thing that says what this '
          + 'one is for — "what a merge request owes before review", "what a chapter owes before it is submitted".',
      }
    }
    const lists = Object.values(store.checklists)
    if (lists.length >= MAX_LISTS) {
      return {
        ok: false,
        error: `there are already ${lists.length} checklists, which is the most this app holds. Remove one first.`,
      }
    }
    const clash = lists.find((list) => list.name.toLowerCase() === name.toLowerCase())
    if (clash) {
      /* Refused rather than allowed, and refused with the id, because two lists
         with one name is a person picking the wrong one on the screen where they
         cannot tell them apart. The id in the refusal is what makes this
         actionable — an agent that meant to add to the existing one now has what
         it needs. */
      return {
        ok: false,
        error: `there is already a checklist called "${clash.name}" (${clash.id}). Add to that one, or pick a name that says how this list differs from it.`,
      }
    }
    const id = newId()
    store.checklists[id] = { id, name, at, by, origin: null, items: [], targets: [] }
    return answer(id, `created "${name}" as ${id}`, null)
  }

  /*
   * An import, which is the second operation that does not start from a list in
   * this project — so it is answered above the lookup that would refuse
   * `input.id` for not being here. It is not here: it is in the project the
   * person picked.
   */
  if (input.op === 'import') {
    const there = read(input.from)
    if (there.trouble) {
      return { ok: false, error: `nothing was imported. ${there.trouble}` }
    }
    if (there.where === 'nowhere') {
      return {
        ok: false,
        error:
          'nothing was imported: that did not say which project to copy from. A checklist is copied out of one '
          + 'project into another, and the project it comes from has to be named as a folder on this machine.',
      }
    }
    const source = there.store.checklists[input.id]
    if (!source) {
      return {
        ok: false,
        error:
          `there is no checklist "${input.id}" in ${named(input.from)}. Somebody may have removed it since that `
          + 'project was read: ask for its checklists again and pick from what is there now.',
      }
    }
    const lists = Object.values(store.checklists)
    if (lists.length >= MAX_LISTS) {
      return {
        ok: false,
        error: `there are already ${lists.length} checklists here, which is the most this app holds. Remove one first.`,
      }
    }
    if (source.items.length > MAX_ITEMS) {
      /* Refused rather than clipped. A list arriving with more items than this
         app holds can only have come from a hand-edited file, and importing the
         first two hundred lines of somebody's standard would produce a list
         that LOOKS complete and is not — which is the failure this whole module
         argues against. */
      return {
        ok: false,
        error:
          `"${source.name}" has ${source.items.length} items, which is more than the ${MAX_ITEMS} one list holds `
          + 'here. Shorten it in the project it came from, then import it.',
      }
    }

    const name = free(source.name, lists, named(input.from))
    if (name === null) {
      return {
        ok: false,
        error:
          `there are already checklists here called "${source.name}" and every name this app would have given the `
          + 'copy. Rename one of them, or rename the list in the project it is coming from.',
      }
    }

    /*
     * A new id for the list and a new id for every item, always — never the
     * ones they had over there.
     *
     * Two reasons, and the second is the one that would have bitten.
     *
     * The obvious one is collision: an id here is eight hex characters, so two
     * projects can independently mint the same one, and an import that kept the
     * source's id would silently replace a list somebody already had.
     *
     * The one that matters more is that TICKS ARE KEYED BY ID. `store.ticks` is
     * checklist, then target, then item. Forgetting a list deletes its ticks
     * here, but a file somebody hand-edited need not have, and neither need a
     * file that arrived from somewhere. A copy carrying the source's ids could
     * therefore land on top of ticks left behind by a list that used to have
     * that id in THIS project — inheriting somebody else's answers about work it
     * has never been held against. The essay on `drop` writes down exactly this
     * hazard for items; this is the same hazard one level up, and fresh ids
     * close it by construction rather than by a check somebody has to remember.
     */
    const id = newId()
    const copied: Checklist = {
      id,
      name,
      /*
       * The LIST is new here and says so: made now, by whoever imported it. The
       * ITEMS keep the time and the name they had, because those say who wrote
       * the line, and putting the importer's name on somebody else's sentence is
       * a claim this app has no business making. That is what `at` and `by`
       * already mean in the two places — one records an act in this project, the
       * other records authorship of a sentence.
       */
      at,
      by,
      /*
       * Where it came from, in the field that was left here for it: the essay on
       * `origin` says the next thing imported into this store will want to say
       * where IT came from, and that a boolean named `migrated` would have had
       * to be replaced rather than extended.
       *
       * The project's NAME and not its path. A path is absolute, means nothing
       * on anybody else's machine, and this file is one somebody may commit and
       * share — so a path here is somebody's home directory written into a
       * repository, in a field nothing resolves anyway. `origin` is provenance
       * for a person to read, and not a pointer.
       */
      origin: `import:${named(input.from)}#${source.id}`,
      items: source.items.map((item) => ({ id: newId(), text: item.text, at: item.at, by: item.by })),
      /* And held against nothing, for the reason it carries no ticks: what a
         list is about is a fact about the project it is in, and the chapters of
         somebody else's paper are not in this one. */
      targets: [],
    }
    /*
     * And no ticks — which needs no code, and that is worth saying out loud.
     *
     * A checklist's items are the thing being reused; whether they are done is a
     * fact about the project they came from. Copying the ticks would hand
     * somebody a list of work claiming to be finished in a repository where none
     * of it has been started. Nothing above reads `there.store.ticks`, and it
     * cannot land by accident either, because ticks live in a map of their own
     * keyed by checklist id and the id being written here is one nothing has
     * ever ticked. The SHAPE of the store is what makes the right answer the one
     * you get by writing nothing.
     */
    store.checklists[id] = copied
    return answer(
      id,
      `imported "${source.name}" from ${named(input.from)} as "${name}" (${id}), with `
      + `${copied.items.length} ${copied.items.length === 1 ? 'item' : 'items'} and no ticks`,
      null,
    )
  }

  const list = store.checklists[input.id]
  if (!list) {
    return {
      ok: false,
      error:
        `there is no checklist "${input.id}" here. Checklists are addressed by the id the checklists tool prints `
        + 'beside each name, not by the name itself — a name can be changed and an id cannot. Read the list of them '
        + 'again: somebody may have removed this one since you last looked.',
    }
  }

  if (input.op === 'rename') {
    const name = input.name.trim().slice(0, MAX_NAME)
    if (!name) return { ok: false, error: 'a checklist needs a name; to remove it, forget it.' }
    list.name = name
    return answer(list.id, `${list.id} is now called "${name}"`, null)
  }

  if (input.op === 'forget') {
    delete store.checklists[input.id]
    /* And every tick on it, against every target. A checklist without its ticks
       is a list of items nobody can explain; ticks without their checklist are
       rows keyed by an id nothing resolves. Neither half is worth keeping alone,
       and leaving the ticks would mean recreating a list with the same id
       silently inherited somebody else's answers. */
    delete store.ticks[input.id]
    return answer(input.id, `"${list.name}" is gone, along with every tick made on it`, null)
  }

  if (input.op === 'hold' || input.op === 'release') {
    const key = targetKey(input.target)
    const targets = list.targets ?? []
    const has = targets.includes(key)
    if (input.op === 'hold') {
      if (has) return answer(list.id, `"${list.name}" is already held against ${targetName(input.target)}`, null)
      if (targets.length >= MAX_TARGETS) {
        return {
          ok: false,
          error:
            `"${list.name}" is already held against ${targets.length} targets, which is the most one list is held `
            + 'against here. Release one first.',
        }
      }
      list.targets = [...targets, key]
      return answer(list.id, `"${list.name}" is now held against ${targetName(input.target)}`, null)
    }
    if (!has) return answer(list.id, `"${list.name}" was not held against ${targetName(input.target)}`, null)
    list.targets = targets.filter((one) => one !== key)
    const kept = Object.keys(store.ticks[list.id]?.[key] ?? {}).length
    /* The ticks stay, and the sentence says so: a person releasing a chapter
       should know that holding it again brings the work back rather than
       starting it over. */
    return answer(
      list.id,
      `"${list.name}" is no longer held against ${targetName(input.target)}`
      + (kept
        ? `; the ${kept === 1 ? 'tick' : `${kept} ticks`} made there ${kept === 1 ? 'is' : 'are'} kept and come back if it is held again`
        : ''),
      null,
    )
  }

  if (input.op === 'add') {
    const text = input.text.trim().slice(0, MAX_TEXT)
    if (!text) {
      return {
        ok: false,
        error:
          'an item needs to say something. Write what is owed in a line somebody else could act on — every list here '
          + 'is hand-written precisely because no program can work out what a piece of work owes.',
      }
    }
    if (list.items.length >= MAX_ITEMS) {
      return {
        ok: false,
        error: `"${list.name}" already has ${list.items.length} items, which is the most one list holds. Tick or drop something first.`,
      }
    }
    const item: Item = { id: newId(), text, at, by }
    list.items = [...list.items, item]
    return answer(list.id, `added "${item.text}" to "${list.name}" as ${item.id}`, null)
  }

  const where = list.items.findIndex((i) => i.id === input.item)
  if (where === -1) {
    return {
      ok: false,
      error:
        `there is no item "${input.item}" on "${list.name}". Items are addressed by the id the checklist tool prints `
        + 'beside each one, not by their words or their position — both of those move. Read the list again: somebody '
        + 'may have taken it off since you last looked.',
    }
  }

  if (input.op === 'reword') {
    const text = input.text.trim().slice(0, MAX_TEXT)
    if (!text) return { ok: false, error: 'an item needs to say something; to take one off the list, drop it.' }
    const next = [...list.items]
    next[where] = { ...list.items[where]!, text }
    list.items = next
    /* The id and every tick on it are untouched, on purpose: sharpening the
       words of an item is not the same as replacing it, and a rewording that
       cleared the ticks would mean nobody could ever fix a typo on a list people
       had started working through. */
    return answer(list.id, `${input.item} on "${list.name}" now reads "${text}"`, null)
  }

  if (input.op === 'move') {
    /* Clamped rather than refused. "Move it to the top" said as `to: 0` and
       "move it to the end" said as a number past the end are both perfectly
       clear intentions, and refusing the second would mean a caller had to know
       the length before it could ask for the obvious thing. What cannot be
       clamped is a number that is not one, and that is refused at the door. */
    const to = Math.max(0, Math.min(list.items.length - 1, Math.trunc(input.to)))
    if (to === where) {
      return answer(
        list.id,
        `${input.item} is already ${to === 0 ? 'first' : `at position ${to + 1}`} on "${list.name}"`,
        null,
      )
    }
    const next = [...list.items]
    const [moved] = next.splice(where, 1)
    next.splice(to, 0, moved!)
    list.items = next
    return answer(list.id, `${input.item} on "${list.name}" moved to position ${to + 1} of ${next.length}`, null)
  }

  if (input.op === 'drop') {
    const gone = list.items[where]!
    list.items = list.items.filter((i) => i.id !== input.item)
    /* And its ticks, on every target. Same argument as forgetting a list: a tick
       keyed to an item that is not there is a row nothing can draw, and leaving
       them would mean a new item that happened to be given this id — which
       cannot happen today and could after a hand edit — inherited them. */
    let ticked = 0
    for (const on of Object.values(store.ticks[list.id] ?? {})) {
      if (on[input.item]) ticked += 1
      delete on[input.item]
    }
    return answer(
      list.id,
      `"${gone.text}" is off "${list.name}"${ticked ? `, along with ${ticked === 1 ? 'the tick' : `${ticked} ticks`} on it` : ''}`,
      null,
    )
  }

  /* A tick, the one operation left that names a target AND a line. */
  const key = targetKey(input.target)
  /*
   * A tick against a target this list is not held against HOLDS it, and says so.
   *
   * The page cannot produce this — it only ever draws a tick control on a
   * target the list is already held against — so this is about the MCP door.
   * An agent that ticks item 3 for gh#105 has named the target in so many
   * words, and a refusal here would send it round a second call to say the
   * same thing again. What the owner asked not to happen is a list re-pointing
   * itself because somebody SCROLLED; an agent naming a reference is the
   * opposite of that, and the sentence it gets back says what it just did.
   * An untick holds nothing: taking a tick back is not a claim about the work.
   */
  const targets = list.targets ?? []
  const newlyHeld = input.done && !targets.includes(key)
  if (newlyHeld) list.targets = [...targets, key]
  const forList = (store.ticks[list.id] ??= {})
  const forTarget = (forList[key] ??= {})
  if (input.done) {
    forTarget[input.item] = {
      at,
      by,
      viaMcp: input.viaMcp === true,
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, MAX_NOTE) } : {}),
    }
  } else {
    delete forTarget[input.item]
  }
  /* An empty map is deleted rather than kept. A target somebody ticked and
     unticked is a target nothing is recorded against, and a file full of empty
     objects reads as if it holds something — which matters here because
     `targetsOf` is what the page offers as "targets this list is held against". */
  if (!Object.keys(forTarget).length) delete forList[key]
  if (!Object.keys(forList).length) delete store.ticks[list.id]

  const item = list.items[where]!
  return answer(
    list.id,
    input.done
      ? `${item.id} on "${list.name}" is ticked for ${key}, by ${by}`
        + (newlyHeld ? `, and "${list.name}" is now held against ${targetName(input.target)}` : '')
      : `${item.id} on "${list.name}" is no longer ticked for ${key}`,
    input.target,
  )
}

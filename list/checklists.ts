import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'

import { dataDir, dataFile, makeDir, NAMES, oldPapersFile } from '../store.ts'
import { Book, migrateLegacy, Unreadable } from './book.ts'
import { countRows, type Item, type List, type StoredRule, type Tick, type TickState } from './shapes.ts'
import { FACT_NAMES, type Evidence, type Fact } from './evidence.ts'
import { everywhere, following, rungTarget, showing } from './holding.ts'
import { rungsFrom } from './scope.ts'
import { moduleNamed } from './aim.ts'
import { heldAs, part, readKey, targetKey, targetName, type Target } from './targets.ts'
import {
  angleRoles,
  covers,
  coversPaper,
  elsewhere,
  inEpic,
  mayCover,
  NO_TASKS,
  normalRoles,
  NOTHING_READ,
  ruleName,
  ruleOf,
  rulesOf,
  ruleTarget,
  sameRule,
  tickedUnheld,
  typeOf,
  USABLE_TYPES,
  type Angle,
  type ItemType,
  type PersonRole,
  type RefsRead,
  type Role,
  type Rule,
  type UndecidedRef,
} from './standing.ts'

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
 * The shapes, which live in `list/shapes.ts`, and the folder, which is
 * `list/book.ts`
 * ------------------------------------------------------------------ */

export type { Item, Tick, TickState } from './shapes.ts'
export { stateOf, TICK_STATES } from './shapes.ts'

/**
 * One checklist, as everything past `read()` hands it around: what it says,
 * and how many targets it is held against (`holds`). WHICH targets is not on
 * it any more — a list may be held against any number of them, and they are
 * read where they are needed (`targetsOf`, the buckets a context opens), never
 * carried with every row.
 */
export type Checklist = List

/**
 * This project's LAYOUT-1 file, or null when there is no project.
 *
 * Kept because `dev/migrate.ts` still writes a layout-1 file into a project
 * (it moves the store this app kept beside itself before stores lived in
 * projects), and the next read migrates it into layout 2 — see
 * `migrateLegacy` in `list/book.ts`.
 */
export function checklistsFile(projectPath: string | null | undefined): string | null {
  return dataFile(projectPath).path
}


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
function migrate(book: Book, projectPath: string | null | undefined): boolean {
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
    Object.values(book.lists)
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
    book.lists[id] = {
      id,
      name: `${epic} — what the paper owes`,
      at,
      by: paper.items[0]?.by ?? 'somebody who did not say',
      origin,
      items: paper.items.map((item) => ({ id: item.id, text: item.text, at: item.at, by: item.by })),
      holds: 1,
      next: 1,
    }
    book.touch()

    /* The target is the whole paper for that epic, not a section of it. That is
       the honest reading of what the old store held: it was keyed by epic and
       nothing in it ever named a place inside the document, so inventing a
       section here would be this migration claiming to know something the file
       never said. */
    const key = targetKey({ kind: 'paper', epic, section: null })
    /* And the list IS held against that paper, ticks or no ticks: being about
       one paper was the whole meaning of the old store's key. */
    const ticked: Record<string, Tick> = {}
    for (const item of paper.items) {
      if (!item.done) continue
      ticked[item.id] = {
        state: 'passed',
        at: item.done.at,
        by: item.done.by,
        viaMcp: item.done.viaMcp,
        ...(item.done.note ? { note: item.done.note } : {}),
      }
    }
    book.set(id, key, { since: at, n: 0, ...(Object.keys(ticked).length ? { ticks: ticked } : {}) })
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
type Opened = { book: Book; where: 'here' | 'nowhere'; trouble: string | null }

/**
 * Open this project's checklists: `lists.json`, with every list's targets left
 * on disk until something asks for them (`list/book.ts`).
 *
 * A layout-1 `checklists.json` is migrated here, the first time anything
 * opens the folder, and proved before its backup goes (`migrateLegacy`).
 * Exported as `openBook` for `list/storage.ts`, which is the other reader.
 */
function read(projectPath: string | null | undefined): Opened {
  const { dir, root, trouble: refused } = dataDir(projectPath)
  if (refused) return { book: new Book(null, null), where: 'here', trouble: refused }
  if (dir === null || root === null) return { book: new Book(null, null), where: 'nowhere', trouble: null }

  let book: Book
  try {
    if (!existsSync(join(dir, NAMES.lists))) migrateLegacy(dir, root)
    book = Book.open(dir, root)
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e
    return { book: new Book(null, null), where: 'here', trouble: e.message }
  }
  /* The migration is inside the read and after the trouble check, which is the
     only safe order: bringing somebody's paper lists across into a store this
     app has just failed to parse would write them over the file it could not
     read. */
  if (migrate(book, projectPath)) save(book, projectPath)
  return { book, where: 'here', trouble: null }
}
export { read as openBook }

/**
 * Write what changed into this project's folder, making the folder if it is
 * not there — and answering with a sentence rather than throwing when there
 * is nowhere to make it.
 *
 * `makeDir` is called HERE and nowhere on the read path, which is what stops
 * this app leaving a `.kehikot/` in every repository somebody happens to open a
 * checklist container against. The folder appears on the first save, which is the
 * first moment this project actually has a checklist to hold.
 *
 * A refusal comes back as a string because every caller already has somewhere to
 * put one: `change()` answers `{ ok: false, error }`, and that sentence reaches
 * both the page and an agent. An exception here would surface at the door as a
 * 500 with nothing anybody could act on.
 */
function save(book: Book, projectPath: string | null | undefined): string | null {
  const made = makeDir(projectPath)
  if (made.trouble) return made.trouble
  if (made.dir === null) return NOWHERE
  const { dir, trouble } = dataDir(projectPath)
  if (trouble) return trouble
  if (dir === null) return NOWHERE
  try {
    book.save()
  } catch (e) {
    return e instanceof Error ? e.message.split('\n')[0]! : String(e)
  }
  return null
}
export { save as saveBook }

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
/*
 * There is no bound on how many targets one checklist is held against.
 *
 * There was — 64, then ten thousand (Jalez/kehikko-checklist#23) — and what
 * it guarded was that the whole store was one file, read on every context
 * and written on every tick. The owner asked why there had to be a limit at
 * all, and there does not: since layout 2 (`list/book.ts`) a context opens
 * only the buckets of what is in front, and a tick writes only the bucket it
 * lands in, so a list held against fifty thousand references costs a reader
 * what one held against five does (`test/storage.test.ts` measures it). What
 * grows is the folder, and the folder is a thing a person can see and choose
 * to trim: View → Storage, and Purge (`list/storage.ts`).
 */

/** How many held targets the list of every checklist names per list; past it, the count says the rest. */
export const SAMPLE = 12

/** The ids among what a caller said is here, each in the form `moduleNamed` stores one. */
function modulesSaid(present: readonly string[]): string[] {
  return present.flatMap((one) => moduleNamed(one, []) ?? [])
}

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
  /**
   * The types × roles it applies to (`list/standing.ts`), which `targets` does
   * not count: a rule is on the list, not in its folder. Empty for a list that
   * applies by no rule.
   */
  applies?: Target[]
  /** The module whose work it is for. Absent for every module's. */
  for?: string
  /**
   * The one item this list's lines are for, as a target key, when it is the
   * lines somebody added for that item alone rather than a list a person named.
   */
  only?: string
}

/** How many items are in each state for one target. They add up to `total`. */
export interface Counts {
  passed: number
  failed: number
  na: number
  unchecked: number
}

export interface Held {
  checklist: Checklist
  /** The target these ticks are for, or null when the list is being read on its own. */
  target: Target | null
  /**
   * The rules this instance is in front through — types × roles — when the
   * list is not held against its item by itself. Absent otherwise. The ticks
   * are the item's either way.
   */
  through?: Target[]
  /** The roles of the angle it applies through: `['any']` for a list for any role. Absent with `through`. */
  as?: Role[]
  rows: { item: Item; done: Tick | null }[]
  /** How many items are ticked `passed`. Failed and not applicable are in `counts`. */
  done: number
  counts: Counts
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
  const { book, where, trouble } = read(projectPath)
  return { lists: summaries(book), trouble, nowhere: where === 'nowhere' }
}

/**
 * One line per list, from a book already open.
 *
 * `held` names the targets only for a list held against a handful
 * (`SAMPLE`), which costs the few bucket files those few are in. A list held
 * against more says how many in `targets`, and its edit page or the
 * `checklists` tool with its id lists them: the list of every checklist is
 * read after every write, and must not open every list's whole folder to say
 * "held against 40,000".
 */
function summaries(book: Book): Summary[] {
  return Object.values(book.lists)
    .map((list) => ({
      id: list.id,
      name: list.name,
      at: list.at,
      by: list.by,
      items: list.items.length,
      targets: list.holds,
      held: list.holds && list.holds <= SAMPLE ? sample(book, list.id) : [],
      applies: rulesOf(list).map(ruleTarget),
      ...(list.for ? { for: list.for } : {}),
      ...(list.only ? { only: list.only } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The few targets a list is held against, or none when one of its bucket files will not parse — that is said where the list is opened. */
function sample(book: Book, id: string): Target[] {
  try {
    return book.heldKeys(id).map(readKey).filter((one): one is Target => one !== null)
  } catch (e) {
    if (e instanceof Unreadable) return []
    throw e
  }
}

/** One list against one target (or none), with the ticks made there beside each item. */
function heldOf(book: Book, list: List, target: Target | null): Held {
  const on = target ? (book.entry(list.id, targetKey(target))?.ticks ?? {}) : {}
  const rows = list.items.map((item) => ({ item, done: on[item.id] ?? null }))
  const counts: Counts = countRows(rows)
  return { checklist: list, target, rows, done: counts.passed, counts, total: rows.length }
}

/** Open, run, and turn a file that will not parse into the trouble every reader already carries. */
function reading<T>(projectPath: string | null | undefined, empty: T, run: (book: Book) => T): { value: T; trouble: string | null; nowhere: boolean } {
  const { book, where, trouble } = read(projectPath)
  if (trouble) return { value: empty, trouble, nowhere: false }
  try {
    return { value: run(book), trouble: null, nowhere: where === 'nowhere' }
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e
    return { value: empty, trouble: e.message, nowhere: false }
  }
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
  const got = reading<Held | null>(projectPath, null, (book) => {
    const checklist = book.lists[id]
    return checklist ? heldOf(book, checklist, target) : null
  })
  return { held: got.value, trouble: got.trouble, nowhere: got.nowhere }
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
  return reading(projectPath, [] as { target: Target; done: number }[], (book) => {
    const list = book.lists[id]
    if (!list) return []
    /* Rules first: they are on the list and have no ticks of their own — each item's are its own. */
    const standing = rulesOf(list).map((rule) => ({ target: ruleTarget(rule) as Target, done: 0 }))
    return [
      ...standing,
      ...book
      .heldKeys(id)
      .map((key) => {
        const target = readKey(key)
        return target ? { target, done: Object.keys(book.entry(id, key)?.ticks ?? {}).length } : null
      })
      .filter((row): row is { target: Target; done: number } => row !== null),
    ]
  }).value
}

/**
 * Whether one list is held against one target — one bucket file, where
 * `targetsOf` reads the list's whole folder. What the doors ask before a tick
 * or a hold, which is every press.
 */
export function holds(id: string, target: Target, projectPath: string | null | undefined): boolean {
  return reading(projectPath, false, (book) => {
    const list = book.lists[id]
    if (!list) return false
    if (target.kind === 'rule') return rulesOf(list).some((rule) => sameRule(rule, target))
    return book.holds(id, targetKey(target))
  }).value
}

/**
 * One item picked on the canvas — a ref, or the paper an epic is aimed at — as
 * the reading page draws a section for it: its type where it is known, the
 * roles it is read as, and the other roles from which some list would apply.
 */
export interface ItemInFront {
  /** The item: a ref, or the whole paper. */
  target: Target
  /** Its type, or null when the tracker has not said (`gh#41` with no row). */
  type: ItemType | null
  /** The roles of the angle it is read from: `['any']` for any role. */
  as: Role[]
  /** Roles outside the angle from which some list's rules would apply to it. */
  elsewhere: PersonRole[]
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
  /**
   * Several ladders rather than one, because several containers on a kehikko
   * can each be showing a place in the paper — two chapters open side by side,
   * or one chapter under the reader and another a container says it holds —
   * and every one of them is in front. The selection first and then each
   * ladder in turn, which keeps the order `showing` gives; a pairing found
   * twice — the whole-paper list, in front of both chapters — is one instance,
   * because it is one set of ticks.
   */
  /**
   * `whole` is an epic, and asks a different question: every pairing held
   * against that epic's paper, wherever in it, with no ladder climbed. It is
   * what the page asks while parts of the epic are picked out — see
   * `everywhere` in `list/holding.ts`.
   */
  /**
   * `following` is the kehikko the reader is on, the modules whose containers
   * are in front there, and the open epic: what a list held against one
   * module's container on one kehikko is asked by (`following` in
   * `list/holding.ts`, Jalez/kehikko-checklist#27).
   */
  input: {
    ladders: readonly string[]
    selection: string[]
    whole?: string | null
    following?: { kehikko: string; modules: readonly string[]; epic: string | null } | null
    /**
     * What the host's tracker reading said about the refs in front: each
     * one's type, the person's roles on it, and which of them the epics a
     * rule names name. What a list that applies by type × role is asked by
     * (`list/standing.ts`).
     */
    read?: RefsRead
    /** The angle the items are read from. `auto`, the person's own roles, when not said. */
    angle?: Angle
    /**
     * The epic whose paper is a picked item: what a list for papers is asked
     * by, and what an item just for the paper is kept under. Null when no
     * paper is picked.
     */
    paper?: string | null
  },
  projectPath: string | null | undefined,
): { instances: Held[]; items: ItemInFront[]; undecided: UndecidedRef[]; trouble: string | null; nowhere: boolean } {
  const read = input.read ?? NOTHING_READ
  const angle = input.angle ?? 'auto'
  const asOf = (ref: string): Role[] => angleRoles(angle, Object.hasOwn(read.roles, ref) ? read.roles[ref] : null)
  const paperAs = angleRoles(angle, null)
  const items: ItemInFront[] = [
    ...input.selection.map((ref) => ({ target: { kind: 'ref', ref } as Target, type: typeOf(ref, read), as: asOf(ref), elsewhere: [] as PersonRole[] })),
    ...(input.paper
      ? [{ target: { kind: 'paper', epic: input.paper, section: null } as Target, type: 'paper' as ItemType, as: paperAs, elsewhere: [] as PersonRole[] }]
      : []),
  ]
  const undecided = new Map<string, UndecidedRef>()
  const got = reading(projectPath, [] as Held[], (book) => {
    undecided.clear()
    const other = new Map<string, Set<PersonRole>>()
    /* Which rules put a list in front of an item, by `<list>|<key>`, for the row's label. */
    const through = new Map<string, { rules: Target[]; roles: Role[] }>()
    const ladders = input.ladders.length ? input.ladders : ['']
    /*
     * The keys anything in front could be held under: each reference, each
     * rung of each ladder, each container. A list is asked about these and
     * nothing else, so a context opens one bucket per group in front — and
     * `showing` and its siblings, which are pure and ask `includes`, are
     * handed only the keys among these that the list does hold. The answer is
     * the one they would have given the list's whole set of keys.
     */
    const asked = new Set<string>([
      ...input.selection.map((ref) => targetKey({ kind: 'ref', ref })),
      ...ladders.flatMap((ladder) => rungsFrom(ladder).map((rung) => targetKey(rungTarget(rung)))),
      ...(input.following
        ? input.following.modules.map((module) => targetKey({ kind: 'kehikko', kehikko: input.following!.kehikko, module, epic: null }))
        : []),
    ])
    const lists = Object.values(book.lists)
      .filter((list) => list.holds > 0 || list.applies?.length)
      .map((list) => {
        const rules = rulesOf(list)
        const targets = list.holds > 0 ? [...asked].filter((key) => book.holds(list.id, key)) : []
        if (input.whole && list.holds > 0) {
          for (const [key, entry] of book.group(list.id, `paper:${input.whole}`)) {
            if (entry.since !== undefined && !targets.includes(key)) targets.push(key)
          }
        }
        /*
         * Each ref in front that this list is not held against by itself, and
         * that one of its rules covers from the angle it is read at, is in
         * front as that ref: the same key and so the same ticks a hold by hand
         * would have. One the tracker has not decided is said, never guessed.
         */
        for (const ref of rules.length ? input.selection : []) {
          const key = targetKey({ kind: 'ref', ref })
          const as = asOf(ref)
          const type = typeOf(ref, read)
          const away = elsewhere(rules, type, as, (rule) => inEpic(rule, ref, read) === 'yes')
          if (away.length) {
            const seen = other.get(key) ?? new Set<PersonRole>()
            for (const role of away) seen.add(role)
            other.set(key, seen)
          }
          if (targets.includes(key)) continue
          const covered = covers(rules, ref, read, as)
          if (covered.answer === 'yes') {
            targets.push(key)
            through.set(`${list.id}|${key}`, { rules: covered.rules.map(ruleTarget), roles: covered.roles })
          } else if (covered.answer === 'unknown') {
            const row = undecided.get(ref) ?? { ref, why: covered.why, lists: [] }
            if (covered.why === 'kind') row.why = 'kind'
            if (!row.lists.includes(list.name)) row.lists.push(list.name)
            undecided.set(ref, row)
          }
        }
        /* And the paper, when one is picked: a list for papers, from the angle. */
        if (input.paper && rules.length) {
          const key = targetKey({ kind: 'paper', epic: input.paper, section: null })
          const away = elsewhere(rules, 'paper', paperAs, (rule) => !rule.epic || rule.epic === input.paper)
          if (away.length) {
            const seen = other.get(key) ?? new Set<PersonRole>()
            for (const role of away) seen.add(role)
            other.set(key, seen)
          }
          const covered = coversPaper(rules, input.paper, paperAs)
          if (covered && !targets.includes(key)) {
            targets.push(key)
            through.set(`${list.id}|${key}`, { rules: covered.rules.map(ruleTarget), roles: covered.roles })
          }
        }
        return { id: list.id, name: list.name, targets }
      })
      .filter((list) => list.targets.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const item of items) {
      const roles = other.get(targetKey(item.target))
      if (roles) item.elsewhere = (['assignee', 'reviewer', 'author'] as PersonRole[]).filter((role) => roles.has(role))
    }
    const seen = new Set<string>()
    const found = [
      ...(input.whole
        ? everywhere({ epic: input.whole, selection: input.selection, lists })
        : ladders.flatMap((ladder, index) => showing({ ladder, selection: index === 0 ? input.selection : [], lists }))),
      ...(input.following ? following({ ...input.following, lists }) : []),
    ]
    return found
      .filter((one) => {
        const key = `${one.id}|${targetKey(one.target)}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .flatMap((one) => {
        const list = book.lists[one.id]
        if (!list) return []
        const by = through.get(`${one.id}|${targetKey(one.target)}`)
        return [by ? { ...heldOf(book, list, one.target), through: by.rules, as: by.roles } : heldOf(book, list, one.target)]
      })
  })
  return { instances: got.value, items, undecided: [...undecided.values()], trouble: got.trouble, nowhere: got.nowhere }
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** A rule as a door hands it to the store: words, read and refused here (`rulesFrom`). */
export interface RuleInput {
  types: readonly string[]
  roles?: readonly string[]
  epic?: string | null
}

export type Op =
  /** Start a list — and, with `rule`, say at once which types × roles it applies to. */
  | { op: 'create'; name: string; rule?: RuleInput; by: string; viaMcp?: boolean }
  /**
   * Say what a list applies to, whole: every rule it has, replaced by these.
   * The edit page's types × roles; an empty array is a list that applies by
   * no rule. Every tick is kept.
   */
  | { op: 'applies'; id: string; rules: readonly RuleInput[]; by: string; viaMcp?: boolean }
  /**
   * Add a line for ONE item only — a ref, or a paper — on top of the lists
   * that apply to it. Kept on a list of that item's own (`only`), made with
   * its first line and gone with its last; ticked with the item's ticks.
   */
  | { op: 'add-for'; target: Target; text: string; by: string; viaMcp?: boolean }
  | { op: 'rename'; id: string; name: string; by: string; viaMcp?: boolean }
  /**
   * Say which module's work this list is for, or (with null) that it is every
   * module's. `present` is the module ids the caller knows to be here, which
   * this store cannot know: they turn a short name into the id it means, and
   * are what a refusal offers.
   */
  | { op: 'for'; id: string; module: string | null; present?: readonly string[]; by: string; viaMcp?: boolean }
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
  /** Say which tracker fact is this item's evidence, or (with null) that none is. */
  | { op: 'cite'; id: string; item: string; fact: Fact | null; by: string; viaMcp?: boolean }
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
  | {
      op: 'tick'
      id: string
      item: string
      target: Target
      done: boolean
      /** What the tick says. Defaults to `passed`; ignored when `done` is false. */
      state?: TickState
      by: string
      viaMcp?: boolean
      note?: string
      evidence?: Evidence
    }

export type Result =
  | { ok: true; said: string; lists: Summary[]; held: Held | null; id: string }
  | { ok: false; error: string }

/** How a state reads in the sentence that says what a write did. */
const STATE_PHRASE: Record<TickState, string> = {
  passed: 'ticked',
  failed: 'marked failed',
  na: 'marked not applicable',
}

/** The refusal an agent gets for touching what a person ticked. */
function PERSONS_TICK(theirs: Tick, text: string, list: string, what: 'tick' | 'drop'): string {
  return (
    `"${text}" on "${list}" was set by ${theirs.by} on the page, and only a person can change or take back what a `
    + `person ticked${what === 'drop' ? ', which dropping the item would do' : ''}. Nothing was changed. Leave it as it `
    + 'is, and say what you found in your own words instead.'
  )
}

/**
 * Change something, and say what happened in a sentence somebody can read back.
 *
 * One function for every operation, so the page and the MCP door cannot end up
 * applying two different rules to the same list — and so every refusal below is
 * written once and read by both. Each names what was wrong and what to do
 * instead; a bare "no" is the kind of refusal an agent routes around.
 */
export function change(input: Op, projectPath: string | null | undefined): Result {
  try {
    return apply(input, projectPath)
  } catch (e) {
    /* A bucket file that will not parse, found half-way through a change:
       nothing has been written, because `save` is the last thing a change
       does. */
    if (e instanceof Unreadable) return { ok: false, error: `nothing was changed. ${e.message}` }
    throw e
  }
}

/** Hold a list against one more key: an entry with when and in what order, and the list's count. */
function hold(book: Book, list: List, key: string, at: string): void {
  const { released: _was, ...entry } = book.entry(list.id, key) ?? {}
  book.set(list.id, key, { ...entry, since: at, n: list.next })
  list.next += 1
  list.holds += 1
  book.touch()
}

/** A rule as `lists.json` keeps it. */
function stored(rule: Rule, since: string): StoredRule {
  return { types: [...rule.types], roles: [...rule.roles], ...(rule.epic ? { epic: rule.epic } : {}), since }
}

/**
 * Rules from what a door handed over, or the sentence refusing them. Every
 * type has to be one this app can use and every role one it knows: a typo is
 * refused rather than read as fewer types, because a rule that silently
 * covered less would leave items without the list somebody meant them to have.
 */
function rulesFrom(input: readonly (RuleInput | Extract<Target, { kind: 'rule' }>)[]): { rules: Rule[] } | { error: string } {
  const rules: Rule[] = []
  for (const one of input) {
    const types = [...new Set(one.types)]
    if (!types.length) return { error: `a rule needs at least one type of item: ${USABLE_TYPES.join(', ')}. Nothing was changed.` }
    if (types.includes('task') && !USABLE_TYPES.includes('task')) return { error: `${NO_TASKS} Nothing was changed.` }
    const unknown = types.filter((type) => !USABLE_TYPES.includes(type as ItemType))
    if (unknown.length) {
      return {
        error:
          `${unknown.map((type) => `"${String(type).slice(0, 40)}"`).join(', ')} ${unknown.length === 1 ? 'is not a type' : 'are not types'} `
          + `a checklist applies to. The types are ${USABLE_TYPES.join(', ')} — mr is a merge request, pr a pull request. Nothing was changed.`,
      }
    }
    const roles = one.roles ?? ['any']
    const badRole = roles.filter((role) => !['any', 'assignee', 'reviewer', 'author'].includes(role))
    if (badRole.length) {
      return {
        error: `${badRole.map((role) => `"${String(role).slice(0, 40)}"`).join(', ')} is not a role. The roles are any, assignee, reviewer and author. Nothing was changed.`,
      }
    }
    const epic = one.epic ? part(one.epic) : null
    if (one.epic && !epic) return { error: 'that epic is not a name: no spaces or slashes, at most 80 characters. Nothing was changed.' }
    const rule = ruleOf({ types, roles: normalRoles(roles), epic })
    if (rule && !rules.some((had) => sameRule(had, rule))) rules.push(rule)
  }
  return { rules }
}

/**
 * The ticks made on items through a list's rules, marked released once the
 * list applies by no rule: they are ticks on items it is no longer in front
 * of, which is what Storage counts as kept and Purge measures an age by.
 */
function releaseThrough(book: Book, list: List, at: string): number {
  let kept = 0
  for (const [key, entry] of book.all(list.id)) {
    if (!tickedUnheld(key, entry)) continue
    kept += 1
    book.set(list.id, key, { ...entry, released: at })
  }
  return kept
}

function apply(input: Op, projectPath: string | null | undefined): Result {
  const opened = read(projectPath)
  const book = opened.book
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
    const refused = save(book, projectPath)
    if (refused) return { ok: false, error: `nothing was changed. ${refused}` }
    const list = book.lists[id]
    return { ok: true, said, id, lists: summaries(book), held: list ? heldOf(book, list, target) : null }
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
    const lists = Object.values(book.lists).filter((list) => !list.only)
    if (lists.length >= MAX_LISTS) {
      return {
        ok: false,
        error: `there are already ${lists.length} checklists, which is the most this app holds. Remove one first.`,
      }
    }
    const rule = input.rule ? rulesFrom([input.rule]) : null
    if (rule && 'error' in rule) return { ok: false, error: rule.error }
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
    book.lists[id] = {
      id,
      name,
      at,
      by,
      origin: null,
      items: [],
      holds: 0,
      next: 0,
      ...(rule?.rules.length ? { applies: rule.rules.map((one) => stored(one, at)) } : {}),
    }
    book.touch()
    return answer(
      id,
      `created "${name}" as ${id}${rule?.rules.length ? `, applying to ${rule.rules.map(ruleName).join('; ')}` : ''}`,
      null,
    )
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
    const source = there.book.lists[input.id]
    if (!source) {
      return {
        ok: false,
        error:
          `there is no checklist "${input.id}" in ${named(input.from)}. Somebody may have removed it since that `
          + 'project was read: ask for its checklists again and pick from what is there now.',
      }
    }
    const lists = Object.values(book.lists).filter((list) => !list.only)
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
     * The one that matters more is that TICKS ARE KEYED BY ID. A list's ticks are
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
      /* Whose work it is for comes with it: that is a fact about what the
         lines say, which is the thing being copied. */
      ...(source.for ? { for: source.for } : {}),
      items: source.items.map((item) => ({
        id: newId(),
        text: item.text,
        at: item.at,
        by: item.by,
        ...(item.fact ? { fact: item.fact } : {}),
      })),
      /* And held against nothing, for the reason it carries no ticks: what a
         list is about is a fact about the project it is in, and the chapters of
         somebody else's paper are not in this one. */
      holds: 0,
      next: 0,
    }
    /*
     * And no ticks — which needs no code, and that is worth saying out loud.
     *
     * A checklist's items are the thing being reused; whether they are done is a
     * fact about the project they came from. Copying the ticks would hand
     * somebody a list of work claiming to be finished in a repository where none
     * of it has been started. Nothing above opens the other project's `targets/`, and it
     * cannot land by accident either, because ticks live in a map of their own
     * keyed by checklist id and the id being written here is one nothing has
     * ever ticked. The SHAPE of the store is what makes the right answer the one
     * you get by writing nothing.
     */
    book.lists[id] = copied
    book.touch()
    return answer(
      id,
      `imported "${source.name}" from ${named(input.from)} as "${name}" (${id}), with `
      + `${copied.items.length} ${copied.items.length === 1 ? 'item' : 'items'} and no ticks`,
      null,
    )
  }

  if (input.op === 'add-for') {
    const target = input.target
    if (target.kind !== 'ref' && target.kind !== 'paper') {
      return {
        ok: false,
        error:
          'a line just for one item is for an issue, a merge request, a pull request or a paper — name the ref, or '
          + 'the epic whose paper it is. Nothing was added.',
      }
    }
    const text = input.text.trim().slice(0, MAX_TEXT)
    if (!text) return { ok: false, error: 'an item needs to say something: what is still owed on this one piece of work.' }
    const key = targetKey(target)
    let own = Object.values(book.lists).find((one) => one.only === key)
    const made = !own
    if (!own) {
      const id = newId()
      own = { id, name: `Only for ${targetName(target)}`, at, by, origin: null, items: [], holds: 0, next: 0, only: key }
      book.lists[id] = own
      /* Held against its item, so it is in front exactly where the item is and its ticks are the item's. */
      hold(book, own, key, at)
    }
    if (own.items.length >= MAX_ITEMS) {
      return { ok: false, error: `${targetName(target)} already has ${own.items.length} lines of its own, which is the most one list holds.` }
    }
    const item: Item = { id: newId(), text, at, by }
    own.items = [...own.items, item]
    book.touch()
    return answer(
      own.id,
      `added "${item.text}" just for ${targetName(target)} as ${item.id}, on its own list ${own.id}`
      + (made ? ' (made now: it holds the lines for that item alone, and goes with its last line)' : ''),
      target,
    )
  }

  const list = book.lists[input.id]
  if (!list) {
    return {
      ok: false,
      error:
        `there is no checklist "${input.id}" here. Checklists are addressed by the id the checklists tool prints `
        + 'beside each name, not by the name itself — a name can be changed and an id cannot. Read the list of them '
        + 'again: somebody may have removed this one since you last looked.',
    }
  }

  if (list.only && (input.op === 'rename' || input.op === 'for' || input.op === 'hold' || input.op === 'release' || input.op === 'applies')) {
    return {
      ok: false,
      error:
        `"${list.name}" holds the lines added for one item alone, so it is not named, held or given types and roles: `
        + 'add, reword, drop or tick its lines. To make a list that applies to every item of a type, create one. '
        + 'Nothing was changed.',
    }
  }

  if (input.op === 'applies') {
    const got = rulesFrom(input.rules)
    if ('error' in got) return { ok: false, error: got.error }
    const before = list.applies ?? []
    /* A rule that was there already keeps when it was made. */
    const next = got.rules.map((rule) => before.find((one) => { const read = ruleOf(one); return read !== null && sameRule(read, rule) }) ?? stored(rule, at))
    if (next.length) list.applies = next
    else delete list.applies
    book.touch()
    const kept = next.length ? 0 : releaseThrough(book, list, at)
    return answer(
      list.id,
      next.length
        ? `"${list.name}" applies to ${got.rules.map(ruleName).join('; ')}`
        : `"${list.name}" applies to no type of item now${kept ? `; the ticks made on ${kept === 1 ? 'one item are' : `${kept} items are`} kept` : ''}`,
      null,
    )
  }

  if (input.op === 'rename') {
    const name = input.name.trim().slice(0, MAX_NAME)
    if (!name) return { ok: false, error: 'a checklist needs a name; to remove it, forget it.' }
    list.name = name
    book.touch()
    return answer(list.id, `${list.id} is now called "${name}"`, null)
  }

  if (input.op === 'for') {
    /* Stored in the one form ids are compared in (`moduleNamed` in
       `list/aim.ts`), and not REQUIRED to be among the modules the caller says
       are here: this store has never heard of a canvas, and a list for a
       module that is not on this kehikko today is an ordinary thing to have.
       The answer says so when it is not, because such a list is put aside for
       nobody. */
    const present = [...new Set(modulesSaid(input.present ?? []))]
    const module = input.module === null ? null : moduleNamed(input.module, present)
    if (input.module !== null && !module) {
      return {
        ok: false,
        error:
          'that is not a module. A list is for one module’s work by that module’s id, as the host spells it — '
          + 'lowercase letters, digits, dots and dashes, like "kehikot.paper" — or for every module’s, which is '
          + `said with null. ${present.length ? `The modules here are: ${present.join(', ')}.` : 'No other module is known here to offer.'}`,
      }
    }
    if (module) list.for = module
    else delete list.for
    book.touch()
    const unknown =
      module && !present.includes(module)
        ? `. No module by that id is ${present.length ? `among the ones here (${present.join(', ')})` : 'known here'}, `
          + 'so until one is the list stays in front whatever is picked out'
        : ''
    /* What it is held against and what is ticked on it are untouched: this
       changes which containers the list is in front of, and nothing else. */
    return answer(
      list.id,
      module
        ? `"${list.name}" is for ${module}’s work: while containers are picked out it is in front only when ${module} is one of them${unknown}`
        : `"${list.name}" is for every module’s work again`,
      null,
    )
  }

  if (input.op === 'forget') {
    book.forget(input.id)
    /* And every tick on it, against every target. A checklist without its ticks
       is a list of items nobody can explain; ticks without their checklist are
       rows keyed by an id nothing resolves. Neither half is worth keeping alone,
       and leaving the ticks would mean recreating a list with the same id
       silently inherited somebody else's answers. */
    return answer(input.id, `"${list.name}" is gone, along with every tick made on it`, null)
  }

  if ((input.op === 'hold' || input.op === 'release') && input.target.kind === 'rule') {
    /*
     * Types × roles: one rule on the list in `lists.json`, and nothing in its
     * folder (`list/standing.ts`). Holding writes no item; releasing deletes no
     * tick.
     */
    const got = rulesFrom([input.target])
    if ('error' in got) return { ok: false, error: got.error }
    const rule = got.rules[0] as Rule
    const rules = list.applies ?? []
    const was = rules.findIndex((one) => {
      const read = ruleOf(one)
      return read !== null && sameRule(read, rule)
    })
    const name = ruleName(rule)
    if (input.op === 'hold') {
      if (was !== -1) return answer(list.id, `"${list.name}" already applies to ${name}`, null)
      list.applies = [...rules, stored(rule, at)]
      book.touch()
      return answer(
        list.id,
        `"${list.name}" now applies to ${name}: it is in front of every such item${rule.epic ? ` ${rule.epic} names` : ''} `
        + 'read from that angle, as the host\'s tracker says what each is, and each keeps its own ticks',
        null,
      )
    }
    if (was === -1) return answer(list.id, `"${list.name}" did not apply to ${name}`, null)
    const left = rules.filter((_, at_) => at_ !== was)
    if (left.length) list.applies = left
    else delete list.applies
    book.touch()
    const kept = left.length ? 0 : releaseThrough(book, list, at)
    return answer(
      list.id,
      `"${list.name}" no longer applies to ${name}`
      + (kept
        ? `; the ticks made on ${kept === 1 ? 'one item are' : `${kept} items are`} kept and come back if it applies again`
        : '; the ticks made on each item are kept'),
      null,
    )
  }

  if (input.op === 'hold' || input.op === 'release') {
    /* One epic's run of a container is held as the container: see `heldAs`. */
    const target = heldAs(input.target)
    const key = targetKey(target)
    const entry = book.entry(list.id, key)
    const has = entry?.since !== undefined
    if (input.op === 'hold') {
      if (has) return answer(list.id, `"${list.name}" is already held against ${targetName(target)}`, null)
      hold(book, list, key, at)
      return answer(list.id, `"${list.name}" is now held against ${targetName(target)}`, null)
    }
    if (!has) return answer(list.id, `"${list.name}" was not held against ${targetName(target)}`, null)
    const kept = Object.keys(entry?.ticks ?? {}).length
    /* Released, and when — which is what Storage counts as ticks kept, and
       what Purge measures their age from. An entry with no ticks says nothing
       once it is released, and goes. */
    book.set(list.id, key, { ...(entry?.ticks ? { ticks: entry.ticks } : {}), released: at })
    list.holds = Math.max(0, list.holds - 1)
    book.touch()
    /* The ticks stay, and the sentence says so: a person releasing a chapter
       should know that holding it again brings the work back rather than
       starting it over. */
    return answer(
      list.id,
      `"${list.name}" is no longer held against ${targetName(target)}`
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
    book.touch()
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
    book.touch()
    /* The id and every tick on it are untouched, on purpose: sharpening the
       words of an item is not the same as replacing it, and a rewording that
       cleared the ticks would mean nobody could ever fix a typo on a list people
       had started working through. */
    return answer(list.id, `${input.item} on "${list.name}" now reads "${text}"`, null)
  }

  if (input.op === 'cite') {
    const next = [...list.items]
    const { fact: _was, ...rest } = list.items[where]!
    next[where] = input.fact ? { ...rest, fact: input.fact } : rest
    list.items = next
    book.touch()
    /* The ticks are untouched, and so is the evidence they carry: a tick made
       on the pipeline is still a tick made on the pipeline after somebody
       decides the line is really about the review. The page compares a tick's
       evidence with the fact IT names, never with the item's new one. */
    return answer(
      list.id,
      input.fact
        ? `${input.item} on "${list.name}" is checked against the tracker's ${FACT_NAMES[input.fact]}`
        : `${input.item} on "${list.name}" names no tracker fact`,
      null,
    )
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
    book.touch()
    return answer(list.id, `${input.item} on "${list.name}" moved to position ${to + 1} of ${next.length}`, null)
  }

  if (input.op === 'drop') {
    const gone = list.items[where]!
    if (input.viaMcp === true) {
      /* Dropping an item takes its ticks with it, so it would be a way round
         the guard on `tick` below. */
      for (const [, entry] of book.all(list.id)) {
        const theirs = entry.ticks?.[input.item]
        if (theirs && theirs.viaMcp === false) return { ok: false, error: PERSONS_TICK(theirs, gone.text, list.name, 'drop') }
      }
    }
    list.items = list.items.filter((i) => i.id !== input.item)
    /* And its ticks, on every target. Same argument as forgetting a list: a tick
       keyed to an item that is not there is a row nothing can draw, and leaving
       them would mean a new item that happened to be given this id — which
       cannot happen today and could after a hand edit — inherited them. */
    book.touch()
    let ticked = 0
    for (const [key, entry] of book.all(list.id)) {
      if (!entry.ticks?.[input.item]) continue
      ticked += 1
      const { [input.item]: _gone, ...rest } = entry.ticks
      book.set(list.id, key, { ...entry, ticks: rest })
    }
    /* A list of one item's own lines goes with its last line: it was made by the first. */
    const emptied = Boolean(list.only) && list.items.length === 0
    if (emptied) book.forget(list.id)
    return answer(
      list.id,
      `"${gone.text}" is off "${list.name}"${ticked ? `, along with ${ticked === 1 ? 'the tick' : `${ticked} ticks`} on it` : ''}`
      + (emptied ? '; it was the last line just for that item' : ''),
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
  /* A rule is never what a tick is filed under: each item keeps its own. */
  if (input.target.kind === 'rule') {
    return {
      ok: false,
      error:
        `"${list.name}" applying to ${targetName(input.target)} is ticked one item at a time: the ticks on one issue `
        + 'say nothing about another. Name the ref the tick is for, e.g. "gh#105". Nothing was changed.',
    }
  }
  /*
   * A tick on a module's container on a kehikko is a tick on one epic's run of
   * it, and has to say which: the ticks for one epic's run say nothing about
   * another's, and a tick filed under no epic would be in front of every epic
   * at once — the opposite of a list that follows the open one.
   */
  if (input.target.kind === 'kehikko' && !input.target.epic) {
    return {
      ok: false,
      error:
        `"${list.name}" is held against ${targetName(input.target)}, and a tick there is for one epic's run of it. `
        + 'Name the epic the tick is for — the one open on that kehikko.',
    }
  }
  /*
   * A tick the PERSON made — on the page, so `viaMcp` is false — is theirs: the
   * MCP door may not change its state, its note, or take it back. A disagreement
   * is something to say in words, not to overwrite. Checked before anything is
   * held or written, so a refusal leaves the file as it was.
   */
  const theirs = book.entry(list.id, key)?.ticks?.[input.item]
  if (input.viaMcp === true && theirs && theirs.viaMcp === false) {
    return { ok: false, error: PERSONS_TICK(theirs, list.items[where]!.text, list.name, 'tick') }
  }
  /* What a tick holds is what a hold would: the container, for a run of one. */
  const holdsNow = heldAs(input.target)
  const holdKey = targetKey(holdsNow)
  /*
   * An item a rule may cover — a ref of one of its types, the paper for a
   * list for papers — is NOT held by its tick: the list is in front of it
   * already, or will be once the tracker says what it is, and a hold by hand
   * would keep it in front after the rule is gone. "May": this store has no
   * tracker reading and no angle, so a ref whose spelling does not say its
   * type is given the benefit of the doubt (`mayCover` in `list/standing.ts`).
   */
  const standing = !book.holds(list.id, holdKey) && mayCover(rulesOf(list), input.target)
  const newlyHeld = input.done && !standing && !book.holds(list.id, holdKey)
  if (newlyHeld) hold(book, list, holdKey, at)
  const was = book.entry(list.id, key)
  const forTarget: Record<string, Tick> = { ...(was?.ticks ?? {}) }
  if (input.done) {
    forTarget[input.item] = {
      state: input.state ?? 'passed',
      at,
      by,
      viaMcp: input.viaMcp === true,
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, MAX_NOTE) } : {}),
      /* Kept only on a ref, which is the only target a tracker has anything
         to say about, and only when it is about the fact the item names now —
         evidence for a different fact than the line is checked against would
         be a record of something nobody was looking at. */
      ...(input.evidence && input.target.kind === 'ref' && input.evidence.fact === list.items[where]!.fact
        ? { evidence: input.evidence }
        : {}),
    }
  } else {
    delete forTarget[input.item]
  }
  /* An empty map is not kept. A target somebody ticked and unticked, and that
     is not held, is a target nothing is recorded against, and the entry goes
     (`Book.set` drops an entry that says nothing). */
  const { ticks: _old, ...rest } = was ?? {}
  /* A ref ticked through a standing hold is in use again, not released (`throughStanding`). */
  if (standing) delete rest.released
  book.set(list.id, key, { ...rest, ...(Object.keys(forTarget).length ? { ticks: forTarget } : {}) })

  const item = list.items[where]!
  return answer(
    list.id,
    input.done
      ? `${item.id} on "${list.name}" is ${STATE_PHRASE[input.state ?? 'passed']} for ${key}, by ${by}`
        + (newlyHeld ? `, and "${list.name}" is now held against ${targetName(holdsNow)}` : '')
        + (standing
          ? `; "${list.name}" applies to ${rulesOf(list).map(ruleName).join(' and ')}, `
            + `so ${targetName(input.target)} was not held on its own: the list is in front of it while it is one of those, from that angle`
          : '')
      : `${item.id} on "${list.name}" is no longer ticked for ${key}`,
    input.target,
  )
}

/**
 * The whole store in the shape layout 1 wrote it — every list with the keys
 * it is held against, in order, and every tick, nested list → target → item.
 *
 * For reading by a person or a test, never for writing: it opens every
 * list's whole folder. `null` when the folder will not open.
 */
export function snapshot(projectPath: string | null | undefined): {
  checklists: Record<string, Omit<List, 'holds' | 'next'> & { targets: string[] }>
  ticks: Record<string, Record<string, Record<string, Tick>>>
} | null {
  const got = reading(projectPath, null, (book) => {
    const out = { checklists: {} as Record<string, Omit<List, 'holds' | 'next'> & { targets: string[] }>, ticks: {} as Record<string, Record<string, Record<string, Tick>>> }
    for (const list of Object.values(book.lists)) {
      const { holds: _holds, next: _next, ...says } = list
      out.checklists[list.id] = { ...says, targets: book.heldKeys(list.id) }
      for (const [key, entry] of book.all(list.id)) {
        if (entry.ticks && Object.keys(entry.ticks).length) (out.ticks[list.id] ??= {})[key] = entry.ticks
      }
    }
    return out
  })
  return got.trouble ? null : got.value
}

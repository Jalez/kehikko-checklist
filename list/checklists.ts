import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

import { dataFile, makeDir, oldPapersFile } from '../store.ts'
import { readKey, targetKey, type Target } from './targets.ts'

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
 * its author and carries `viaMcp`; the row prints "ticked by claude, over MCP"
 * rather than a bare checkmark; and one press takes it back. An agent's claim is
 * a claim, legible as one, and reversible by the person who can judge it.
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
  /** Whether it arrived through the MCP door. Printed on the row; never inferred from the name. */
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
})
export type Checklist = z.infer<typeof checklistSchema>

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
  if (migrate(store, projectPath)) save(store, projectPath)
  return { store, where: 'here', trouble: null }
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

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
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
  /** How many targets this list has ever been ticked against. */
  targets: number
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
      targets: Object.keys(store.ticks[list.id] ?? {}).length,
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
    held: { checklist, target, rows, done: rows.filter((r) => r.done).length, total: rows.length },
    trouble,
    nowhere,
  }
}

/** Every target one checklist has ticks against, so nothing recorded becomes unreachable. */
export function targetsOf(id: string, projectPath: string | null | undefined): { target: Target; done: number }[] {
  const { store } = read(projectPath)
  return Object.entries(store.ticks[id] ?? {})
    .map(([key, ticks]) => {
      const target = readKey(key)
      return target ? { target, done: Object.keys(ticks).length } : null
    })
    .filter((row): row is { target: Target; done: number } => row !== null)
    .sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)))
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type Op =
  | { op: 'create'; name: string; by: string; viaMcp?: boolean }
  | { op: 'rename'; id: string; name: string; by: string; viaMcp?: boolean }
  | { op: 'forget'; id: string; by: string; viaMcp?: boolean }
  | { op: 'add'; id: string; text: string; by: string; viaMcp?: boolean }
  | { op: 'reword'; id: string; item: string; text: string; by: string; viaMcp?: boolean }
  | { op: 'move'; id: string; item: string; to: number; by: string; viaMcp?: boolean }
  | { op: 'drop'; id: string; item: string; by: string; viaMcp?: boolean }
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
      held: list ? { checklist: list, target, rows, done: rows.filter((r) => r.done).length, total: rows.length } : null,
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
    store.checklists[id] = { id, name, at, by, origin: null, items: [] }
    return answer(id, `created "${name}" as ${id}`, null)
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

  /* A tick, which is the only operation that involves a target at all. */
  const key = targetKey(input.target)
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
      : `${item.id} on "${list.name}" is no longer ticked for ${key}`,
    input.target,
  )
}

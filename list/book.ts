import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fenced, NAMES } from '../store.ts'
import {
  type Entry,
  type Legacy,
  legacySchema,
  type List,
  listsFileSchema,
  type Shard,
  shardSchema,
} from './shapes.ts'

/**
 * How a project's checklists lie on disk, and the one class that reads and
 * writes them.
 *
 * ## Why the one file was split
 *
 * Up to layout 1 everything was `checklists.json`: every list, the keys of
 * everything each list was held against, and every tick. The whole file was
 * read on every context a canvas sent and written whole on every tick, so a
 * list held against every issue a busy project ever had made every move of
 * the reader slower — and the answer at the time was a cap, ten thousand
 * targets a list. The owner's sentence that removed it:
 *
 * > "I don't understand why there needs to be a limit at all. Sure, if data
 * > grows way too much then it's time to purge older checklists, and being
 * > able to decide how old checklists we purge would be nice, as well as
 * > knowing how much space all checklists take to begin with."
 *
 * So the size of a list is no longer something a read pays for:
 *
 *     .kehikot/checklist/
 *       lists.json                 what every list SAYS (name, items, whose work)
 *       targets/<list>/<00..ff>.json
 *                                  what one list is held against, and its ticks,
 *                                  in 256 buckets
 *       purged/<when>.json         what Purge took out, kept for a while
 *
 * ## The bucket is chosen by what a reader asks about together
 *
 * A context asks "is this list held against `gh#105`", "against which rung of
 * the paper `thesis` the reader is on", "against Flows on this kehikko". So a
 * target's bucket is a hash of its GROUP rather than of its whole key: a ref
 * on its own, a paper by its epic (every file and section of one paper in one
 * bucket), a kehikko's container by the pair (the hold and every epic's run of
 * it in one bucket). One context then opens, per list, one file per reference
 * in front plus one for the paper and one per container — never the list's
 * whole history — and a tick rewrites the one bucket it lands in.
 *
 * Measured, not hoped: `test/storage.test.ts` holds a list against fifty
 * thousand references and bounds what a context and a tick cost.
 *
 * ## Everything is under one folder
 *
 * Nothing here is anywhere but `.kehikot/checklist/`, so what this module
 * takes up is the size of that folder, which a host can measure without
 * knowing any of this.
 *
 * ## Every write is atomic, and only what changed is written
 *
 * A file is written beside itself under a temporary name and renamed over the
 * old one, so a reader sees the old file or the new one and never half of
 * either. `lists.json` is written only when what a list says changed (or a
 * hold moved its count); a tick touches only its bucket.
 */

/** How many bucket files one list's folder can have. A constant: changing it would move every target. */
export const BUCKETS = 256

/** Raised when a file of the store will not parse. The message is for a person. */
export class Unreadable extends Error {}

/** FNV-1a, 32 bits: small, stable on every machine, and nothing here needs it to be secret. */
function fnv(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * What a target is asked about together with: see "The bucket is chosen by
 * what a reader asks about together" above. A key this version does not know
 * the shape of is its own group.
 */
export function groupOf(key: string): string {
  if (key.startsWith('paper:')) {
    const cut = key.indexOf('/')
    return cut === -1 ? key : key.slice(0, cut)
  }
  if (key.startsWith('kehikko:')) {
    const parts = key.split('/')
    return parts.length > 2 ? parts.slice(0, 2).join('/') : key
  }
  return key
}

/** The bucket a group lands in, as its file is named: two hex digits. */
export function bucketOf(group: string): string {
  return (fnv(group) % BUCKETS).toString(16).padStart(2, '0')
}

/**
 * The folder name for a list id.
 *
 * The id itself when it is a plain name — which every id this app mints is —
 * so a person looking in `targets/` sees the ids `lists.json` uses. An id
 * that came from a hand-edited file and is not one (a slash, a dot-dot) is
 * spelled as a hash instead, so no id can name a path.
 */
export function folderOf(id: string): string {
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(id) && !id.includes('..') ? id : `id-${fnv(id).toString(16)}`
}

const BUCKET_FILE = /^[0-9a-f]{2}\.json$/

/** Write a file so a reader sees the old one or the new one, never half of either. */
export function writeAtomic(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`
  writeFileSync(temporary, text)
  try {
    renameSync(temporary, path)
  } catch (e) {
    rmSync(temporary, { force: true })
    throw e
  }
}

/** The bytes a value is written as — one serialiser, so what Storage and Purge count is what is on disk. */
export function serialise(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

/** Whether an entry still says anything: held, or a tick kept. */
export function speaks(entry: Entry | undefined): entry is Entry {
  return Boolean(entry && (entry.since !== undefined || (entry.ticks && Object.keys(entry.ticks).length)))
}

/**
 * One project's checklists, opened.
 *
 * `lists` is read whole when the book is opened; a list's targets are read a
 * bucket at a time when something asks, and remembered for the life of the
 * book — which is one request. `save()` writes what was changed and nothing
 * else.
 */
export class Book {
  lists: Record<string, List>
  private readonly shards = new Map<string, Shard>()
  private readonly dirty = new Set<string>()
  private listsDirty = false
  private readonly gone = new Set<string>()
  private readonly checked = new Set<string>()

  constructor(
    /** This module's folder, or null for a book with nowhere behind it. */
    readonly dir: string | null,
    /** The project, resolved, which every list's own folder is fenced against. */
    private readonly root: string | null,
    lists: Record<string, List> = {},
  ) {
    this.lists = lists
  }

  /** Open what is at `dir`: `lists.json` if it is there, or nothing yet. Throws `Unreadable`. */
  static open(dir: string, root: string): Book {
    const path = join(dir, NAMES.lists)
    if (!existsSync(path)) return new Book(dir, root)
    try {
      return new Book(dir, root, listsFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).checklists)
    } catch (e) {
      throw new Unreadable(
        `${path} could not be read (${firstLine(e)}), so no checklist is being shown and nothing will be written `
        + 'over it. Every list in that file is recoverable: fix or move it.',
      )
    }
  }

  /** The folder one list's targets are in. */
  folder(id: string): string | null {
    return this.dir === null ? null : join(this.dir, NAMES.targets, folderOf(id))
  }

  private shardKey(id: string, bucket: string): string {
    return `${id}\u0000${bucket}`
  }

  /** One bucket of one list, read once per book. */
  private load(id: string, bucket: string): Shard {
    const at = this.shardKey(id, bucket)
    const had = this.shards.get(at)
    if (had) return had
    let shard: Shard = {}
    const folder = this.folder(id)
    if (folder !== null && !this.gone.has(id)) {
      const path = join(folder, `${bucket}.json`)
      if (existsSync(path)) {
        this.fence(id, folder)
        try {
          shard = shardSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
        } catch (e) {
          throw new Unreadable(
            `${path} could not be read (${firstLine(e)}), so nothing is being shown from it and nothing will be `
            + 'written over it. The ticks in it are recoverable: fix or move that one file — every other list and '
            + 'every other target is untouched.',
          )
        }
      }
    }
    this.shards.set(at, shard)
    return shard
  }

  /** A list's own folder is checked once per book: a symlink there is how one project's ticks end up in another's. */
  private fence(id: string, folder: string): void {
    if (this.checked.has(id) || this.root === null) return
    const escaped = fenced(this.root, folder)
    if (escaped) throw new Unreadable(escaped)
    this.checked.add(id)
  }

  /** The entry for one target of one list, or undefined. */
  entry(id: string, key: string): Entry | undefined {
    return this.load(id, bucketOf(groupOf(key)))[key]
  }

  /** Whether a list is held against a key. */
  holds(id: string, key: string): boolean {
    return this.entry(id, key)?.since !== undefined
  }

  /** Put an entry back, or take it out when it says nothing. Marks its bucket for `save()`. */
  set(id: string, key: string, entry: Entry | null): void {
    const bucket = bucketOf(groupOf(key))
    const shard = this.load(id, bucket)
    if (speaks(entry ?? undefined)) shard[key] = entry as Entry
    else delete shard[key]
    this.dirty.add(this.shardKey(id, bucket))
  }

  /** Every entry of one group (a paper, a container) of one list, from its one bucket. */
  group(id: string, group: string): [string, Entry][] {
    return Object.entries(this.load(id, bucketOf(group))).filter(([key]) => groupOf(key) === group)
  }

  /** The bucket files one list has on disk. */
  buckets(id: string): string[] {
    const folder = this.folder(id)
    if (folder === null || this.gone.has(id) || !existsSync(folder)) return []
    this.fence(id, folder)
    return readdirSync(folder).filter((name) => BUCKET_FILE.test(name)).map((name) => name.slice(0, 2))
  }

  /** Every entry of one list: its whole folder. For the edit page, Storage and Purge — never for a context. */
  all(id: string): [string, Entry][] {
    const seen = new Set(this.buckets(id))
    const prefix = `${id}\u0000`
    for (const at of this.shards.keys()) if (at.startsWith(prefix)) seen.add(at.slice(prefix.length))
    return [...seen].sort().flatMap((bucket) => Object.entries(this.load(id, bucket)))
  }

  /** A list's targets in the order they were held, read whole — and its count mended if it had drifted. */
  heldKeys(id: string): string[] {
    const held = this.all(id)
      .filter(([, entry]) => entry.since !== undefined)
      .sort(([a, x], [b, y]) => (x.n ?? 0) - (y.n ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
      .map(([key]) => key)
    const list = this.lists[id]
    if (list && list.holds !== held.length) {
      list.holds = held.length
      this.listsDirty = true
    }
    return held
  }

  /** Say that `lists.json` has to be written. */
  touch(): void {
    this.listsDirty = true
  }

  /** Whether anything is waiting to be written. */
  get changed(): boolean {
    return this.listsDirty || this.dirty.size > 0 || this.gone.size > 0
  }

  /** Take a list out, and its folder with it on `save()`. */
  forget(id: string): void {
    delete this.lists[id]
    this.listsDirty = true
    this.gone.add(id)
    const prefix = `${id}\u0000`
    for (const at of [...this.shards.keys()]) {
      if (!at.startsWith(prefix)) continue
      this.shards.delete(at)
      this.dirty.delete(at)
    }
  }

  /**
   * Write what changed. The buckets first and `lists.json` after them, so
   * that a list never names targets that are not on disk yet; a list's
   * folder goes last, after `lists.json` has stopped naming it.
   *
   * `dir` must exist (`makeDir`) — this makes only the folders below it.
   */
  save(): void {
    if (this.dir === null) throw new Error('a book with nowhere behind it cannot be saved')
    for (const at of this.dirty) {
      const [id, bucket] = at.split('\u0000') as [string, string]
      const folder = this.folder(id) as string
      const path = join(folder, `${bucket}.json`)
      const shard = this.shards.get(at) ?? {}
      if (Object.keys(shard).length) {
        mkdirSync(folder, { recursive: true })
        this.checked.delete(id)
        this.fence(id, folder)
        writeAtomic(path, serialise(shard))
      } else if (existsSync(path)) {
        unlinkSync(path)
      }
    }
    this.dirty.clear()
    if (this.listsDirty) {
      writeAtomic(join(this.dir, NAMES.lists), serialise({ layout: 2, checklists: this.lists }))
      this.listsDirty = false
    }
    for (const id of this.gone) {
      const folder = this.folder(id) as string
      if (existsSync(folder)) {
        this.fence(id, folder)
        rmSync(folder, { recursive: true, force: true })
      }
    }
    this.gone.clear()
  }
}

function firstLine(e: unknown): string {
  return e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)
}

/* ------------------------------------------------------------------ *
 * Layout 1 → layout 2
 * ------------------------------------------------------------------ */

/** What one migration moved, counted, so it can be proved on the way back in. */
interface Tally {
  lists: number
  holds: Record<string, string[]>
  ticks: Record<string, number>
}

/**
 * Bring a layout-1 `checklists.json` across into layout 2, once.
 *
 * ## The order, which is the whole of the safety
 *
 * 1. The old file is RENAMED to `checklists.v1.json`. From here on it is the
 *    backup, and nothing writes it.
 * 2. Anything under `targets/` is cleared — it can only be what a migration
 *    that was interrupted left there, because layout 2 writes `lists.json`
 *    with its first write and there is no `lists.json` yet.
 * 3. Every bucket is written, then `lists.json`, last. `lists.json` being
 *    there is what says layout 2 is in force, so a crash before it leaves a
 *    folder the next read migrates again, from the backup.
 * 4. The new layout is read back off disk and compared with the old file:
 *    the same lists, each held against the same targets in the same order,
 *    with the same number of ticks.
 * 5. Only then is the backup removed. If the comparison fails, what was
 *    written is taken out and the old file is put back where it was.
 *
 * Idempotent: with `lists.json` there this never runs, and without it, it
 * starts again from whichever of the two old names is on disk.
 *
 * `settleTargets` from layout 1 happens here: a list with no `targets` at all
 * was written before holds existed, and is held against what it had ticks on.
 *
 * A hold's `since` is the list's own `at`, which is the earliest the hold can
 * have been made: layout 1 did not record when. A tick keeps its own time.
 */
export function migrateLegacy(dir: string, root: string): void {
  const legacy = join(dir, NAMES.legacy)
  const backup = join(dir, NAMES.legacyBackup)
  const from = existsSync(legacy) ? legacy : existsSync(backup) ? backup : null
  if (from === null) return
  let old: Legacy
  try {
    old = legacySchema.parse(JSON.parse(readFileSync(from, 'utf8')))
  } catch (e) {
    throw new Unreadable(
      `${from} could not be read (${firstLine(e)}), so no checklist is being shown and nothing will be written over `
      + 'it. Every list and every tick in that file is recoverable: fix or move it.',
    )
  }

  if (from === legacy) {
    /* A backup already there is an older interrupted migration of the same
       data; the file still in place is the one that was live after it. */
    renameSync(legacy, backup)
  }
  const targets = join(dir, NAMES.targets)
  rmSync(targets, { recursive: true, force: true })

  const book = new Book(dir, root)
  const tally: Tally = { lists: 0, holds: {}, ticks: {} }
  for (const list of Object.values(old.checklists)) {
    const { targets: keys, ...says } = list
    const held = [...new Set(keys ?? Object.keys(old.ticks[list.id] ?? {}))]
    book.lists[list.id] = { ...says, holds: held.length, next: held.length }
    tally.lists += 1
    tally.holds[list.id] = held
    held.forEach((key, n) => book.set(list.id, key, { since: list.at, n }))
    let ticks = 0
    for (const [key, ticked] of Object.entries(old.ticks[list.id] ?? {})) {
      if (!Object.keys(ticked).length) continue
      ticks += Object.keys(ticked).length
      book.set(list.id, key, { ...(book.entry(list.id, key) ?? {}), ticks: ticked })
    }
    tally.ticks[list.id] = ticks
  }
  book.touch()

  try {
    book.save()
    const back = Book.open(dir, root)
    const wrong = disagrees(back, tally)
    if (wrong) throw new Error(wrong)
  } catch (e) {
    rmSync(targets, { recursive: true, force: true })
    rmSync(join(dir, NAMES.lists), { force: true })
    renameSync(backup, legacy)
    throw new Unreadable(
      `the checklists in ${legacy} could not be moved into the new layout (${firstLine(e)}). The file has been put `
      + 'back exactly as it was and nothing else was changed; this app will try again on the next read.',
    )
  }
  unlinkSync(backup)
}

/** A sentence for the first thing the book on disk says differently from the tally, or null. */
function disagrees(book: Book, tally: Tally): string | null {
  if (Object.keys(book.lists).length !== tally.lists) return 'a different number of lists came back'
  for (const [id, held] of Object.entries(tally.holds)) {
    if (!book.lists[id]) return `list ${id} did not come back`
    if (book.heldKeys(id).join('\n') !== held.join('\n')) return `list ${id} came back held against different targets`
    const ticks = book.all(id).reduce((sum, [, entry]) => sum + Object.keys(entry.ticks ?? {}).length, 0)
    if (ticks !== tally.ticks[id]) return `list ${id} came back with ${ticks} ticks rather than ${tally.ticks[id]}`
  }
  return null
}

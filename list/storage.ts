import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { NAMES } from '../store.ts'
import { Book, bucketOf, groupOf, serialise, speaks, Unreadable, writeAtomic } from './book.ts'
import { openBook, saveBook } from './checklists.ts'
import { entrySchema, type Entry, type List, listSchema } from './shapes.ts'
import { throughStanding } from './standing.ts'

/**
 * What this module's folder takes up, and taking out what a person decides is
 * old enough to go.
 *
 * ## Why Storage exists instead of a limit
 *
 * > "if data grows way too much then it's time to purge older checklists, and
 * > being able to decide how old checklists we purge would be nice, as well as
 * > knowing how much space all checklists take to begin with"
 *
 * So the size is shown — per list, and for the project — and trimming it is a
 * decision a person makes with the numbers in front of them, never a rule
 * this program applies by itself. Nothing here runs on a timer or on a read.
 *
 * ## Purge is the person's, and only the person's
 *
 * An agent may read usage (the `storage` tool). It may not purge: no tool
 * does it, the door is a POST that only this app's own page holds the ticket
 * for, and no header item that leads to it is marked for agents. Removing a
 * record of work somebody did is the one act here whose mistake cannot be
 * seen on the page afterwards, so it is not delegated.
 *
 * ## Preview, then confirm, then remove — and a backup by default
 *
 * A purge is planned first and shown: which lists, how many targets and
 * ticks, and how many bytes it frees. The plan carries a digest of exactly
 * what it would remove, and the purge is refused if the folder no longer
 * gives the same plan — so what is removed is what was previewed, never what
 * happened to match the rule a minute later.
 *
 * What is removed is written to `purged/<when>.json` first and kept for
 * `KEEP_DAYS` days, from which Storage can put it back. That is the default
 * because ticks are records of work done and "how old is old" is easy to get
 * wrong once; thirty days is long enough to notice. It is a choice, not a
 * hidden cost: the backup is counted in Storage, says when it expires, and can
 * be deleted at once — and a purge can be made permanent from the start, in
 * which case the page says so before it is confirmed.
 */

/** How long a purge's backup is kept before the next purge removes it. */
export const KEEP_DAYS = 30
const DAY = 86_400_000

/** An issue or change the tracker says is closed or merged, and when, from the host's shared reading. */
export interface Finished {
  ref: string
  /** When it was merged or closed, or null when the reading did not say. */
  at: string | null
}

/** One checklist's share of the folder. */
export interface Usage {
  id: string
  name: string
  /** Its bucket files, plus its own entry in `lists.json`. */
  bytes: number
  /** Targets it is held against. */
  held: number
  /** Released targets whose ticks are kept. */
  released: number
  ticks: number
  /** The last tick, hold, release or edit, or null for a list with none on record. */
  last: string | null
  /** Targets (held, or released with ticks) whose ref the tracker says is closed or merged; null without a reading. */
  finished: number | null
}

export interface Backup {
  name: string
  at: string
  expires: string
  bytes: number
  lists: number
  targets: number
  ticks: number
}

export interface Report {
  lists: Usage[]
  /** Every byte under `.kehikot/checklist/`. */
  total: number
  /** `lists.json`, whole. */
  listsFile: number
  backups: Backup[]
  /** Everything else in the folder: a layout-1 file, `papers.json`, a folder no list names any more. */
  other: number
  trouble: string | null
  nowhere: boolean
}

export const SCOPES = ['released', 'finished', 'lists'] as const
export type Scope = (typeof SCOPES)[number]

export interface Rule {
  /**
   * `released`: the kept ticks of released targets with no activity since the cutoff.
   * `finished`: targets whose issue or change was finished before the cutoff — released, and their ticks removed.
   * `lists`: whole checklists with no activity since the cutoff.
   */
  scope: Scope
  days: number
}

export interface PlanRow {
  id: string
  name: string
  /** The whole list goes. */
  whole: boolean
  targets: number
  ticks: number
  bytes: number
}

export interface Plan {
  rule: Rule
  cutoff: string
  rows: PlanRow[]
  lists: number
  targets: number
  ticks: number
  /** Bytes the folder shrinks by, before any backup is written. */
  frees: number
  /** What exactly would be removed, as a digest: a purge is refused when the folder no longer plans the same. */
  digest: string
}

/** A refusal with its sentence, or the value. */
type Said<T> = { ok: true; value: T } | { ok: false; error: string }

const NO_PROJECT =
  'there is no project open, so there is no folder to measure. A checklist lives in the project it is about — in '
  + 'its .kehikot/checklist folder.'

/* ------------------------------------------------------------------ *
 * Measuring
 * ------------------------------------------------------------------ */

function sizeOf(path: string): number {
  if (!existsSync(path)) return 0
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.size
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0)
}

function latest(...times: (string | undefined | null)[]): string | null {
  let best: string | null = null
  for (const one of times) if (one && (best === null || one > best)) best = one
  return best
}

/** The last thing that happened to one target of a list. */
function lastOf(entry: Entry): string | null {
  return latest(entry.since, entry.released, ...Object.values(entry.ticks ?? {}).map((tick) => tick.at))
}

/** A list's own entry in `lists.json`, in bytes — its share of that file. */
function defBytes(list: List): number {
  return Buffer.byteLength(JSON.stringify(list))
}

function finishedRefs(finished: readonly Finished[] | null): Map<string, string | null> | null {
  return finished ? new Map(finished.map((one) => [one.ref, one.at])) : null
}

function refOf(key: string): string | null {
  return key.startsWith('ref:') ? key.slice(4) : null
}

/** Open, or the sentence for why not. */
function opened(projectPath: string | null | undefined): Said<Book> & { nowhere?: boolean } {
  const { book, where, trouble } = openBook(projectPath)
  if (trouble) return { ok: false, error: trouble }
  if (where === 'nowhere' || book.dir === null) return { ok: false, error: NO_PROJECT, nowhere: true }
  return { ok: true, value: book }
}

/**
 * What the folder takes up, per list and in all.
 *
 * Reads every list's whole folder — this is the one view that has to — and
 * writes nothing. `finished` is the host's tracker reading as the page has
 * it; without one (an agent, a host with no tracker) `finished` is null on
 * every row rather than a guessed zero.
 */
export function usage(projectPath: string | null | undefined, finished: readonly Finished[] | null = null): Report {
  const empty: Report = { lists: [], total: 0, listsFile: 0, backups: [], other: 0, trouble: null, nowhere: false }
  const open = opened(projectPath)
  if (!open.ok) return { ...empty, trouble: open.nowhere ? null : open.error, nowhere: open.nowhere === true }
  const book = open.value
  const dir = book.dir as string
  const done = finishedRefs(finished)
  try {
    const lists = Object.values(book.lists)
      .map((list): Usage => {
        const entries = book.all(list.id)
        let held = 0
        let released = 0
        let ticks = 0
        let last = latest(list.at, ...list.items.map((item) => item.at))
        let over = 0
        for (const [key, entry] of entries) {
          if (entry.since !== undefined || throughStanding(list, key, entry)) held += 1
          else if (entry.ticks && Object.keys(entry.ticks).length) released += 1
          ticks += Object.keys(entry.ticks ?? {}).length
          last = latest(last, lastOf(entry))
          const ref = refOf(key)
          if (done && ref && done.has(ref)) over += 1
        }
        return {
          id: list.id,
          name: list.name,
          bytes: sizeOf(book.folder(list.id) as string) + defBytes(list),
          held,
          released,
          ticks,
          last,
          finished: done ? over : null,
        }
      })
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    const total = sizeOf(dir)
    const listsFile = sizeOf(join(dir, NAMES.lists))
    const backups = backupsIn(dir)
    const counted =
      listsFile
      + lists.reduce((sum, row) => sum + row.bytes, 0)
      - lists.reduce((sum, row) => sum + defBytes(book.lists[row.id]!), 0)
      + backups.reduce((sum, one) => sum + one.bytes, 0)
    return { lists, total, listsFile, backups, other: Math.max(0, total - counted), trouble: null, nowhere: false }
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e
    return { ...empty, trouble: e.message }
  }
}

/* ------------------------------------------------------------------ *
 * Planning a purge
 * ------------------------------------------------------------------ */

/** What one purge would take out, before anything is taken. */
interface Taking {
  plan: Plan
  /** Whole lists. */
  whole: string[]
  /** Entries, per list. */
  entries: Map<string, string[]>
}

function readRule(rule: Rule): Said<Rule> {
  if (!SCOPES.includes(rule.scope)) {
    return { ok: false, error: `there is no "${String(rule.scope)}" to purge — it is ${SCOPES.join(', ')}.` }
  }
  if (!Number.isFinite(rule.days) || rule.days < 1 || rule.days > 36_500) {
    return { ok: false, error: 'an age is a whole number of days, at least one: nothing is purged that was touched today.' }
  }
  return { ok: true, value: { scope: rule.scope, days: Math.trunc(rule.days) } }
}

function take(book: Book, rule: Rule, finished: readonly Finished[] | null, now: number): Said<Taking> {
  const cutoff = new Date(now - rule.days * DAY).toISOString()
  const done = finishedRefs(finished)
  if (rule.scope === 'finished' && !done) {
    return {
      ok: false,
      error:
        'which issues and changes are finished is the tracker’s to say, and no reading was handed over. Open '
        + 'Storage in a host that reads the project’s tracker, or purge by age instead.',
    }
  }
  const rows: PlanRow[] = []
  const whole: string[] = []
  const entries = new Map<string, string[]>()
  const lines: string[] = []
  let frees = 0

  for (const list of Object.values(book.lists).sort((a, b) => a.name.localeCompare(b.name))) {
    const all = book.all(list.id)
    if (rule.scope === 'lists') {
      const last = all.reduce<string | null>((was, [, entry]) => latest(was, lastOf(entry)), latest(list.at, ...list.items.map((item) => item.at)))
      if (last !== null && last >= cutoff) continue
      const bytes = sizeOf(book.folder(list.id) as string) + defBytes(list) + Buffer.byteLength(JSON.stringify(list.id)) + 1
      whole.push(list.id)
      lines.push(`list ${list.id}`)
      rows.push({
        id: list.id,
        name: list.name,
        whole: true,
        targets: all.length,
        ticks: all.reduce((sum, [, entry]) => sum + Object.keys(entry.ticks ?? {}).length, 0),
        bytes,
      })
      frees += bytes
      continue
    }
    const going = all.filter(([key, entry]) => {
      if (rule.scope === 'released') {
        const last = lastOf(entry)
        /* Ticks a standing hold is still in front of are in use, not released. */
        return entry.since === undefined && speaks(entry) && !throughStanding(list, key, entry) && last !== null && last < cutoff
      }
      const ref = refOf(key)
      const at = ref ? done!.get(ref) : undefined
      return typeof at === 'string' && at < cutoff
    })
    if (!going.length) continue
    entries.set(list.id, going.map(([key]) => key))
    for (const [key] of going) lines.push(`${list.id}|${key}`)
    const bytes = shrinks(book, list.id, new Set(going.map(([key]) => key)))
    rows.push({
      id: list.id,
      name: list.name,
      whole: false,
      targets: going.length,
      ticks: going.reduce((sum, [, entry]) => sum + Object.keys(entry.ticks ?? {}).length, 0),
      bytes,
    })
    frees += bytes
  }
  const digest = createHash('sha256').update(`${rule.scope}\n${lines.sort().join('\n')}`).digest('hex').slice(0, 16)
  return {
    ok: true,
    value: {
      whole,
      entries,
      plan: {
        rule,
        cutoff,
        rows,
        lists: whole.length,
        targets: rows.reduce((sum, row) => sum + row.targets, 0),
        ticks: rows.reduce((sum, row) => sum + row.ticks, 0),
        frees,
        digest,
      },
    },
  }
}

/** How many bytes one list's buckets shrink by when these keys go: each bucket serialised before and after. */
function shrinks(book: Book, id: string, keys: Set<string>): number {
  const byBucket = new Map<string, [string, Entry][]>()
  for (const [key, entry] of book.all(id)) {
    const bucket = bucketFor(key)
    const had = byBucket.get(bucket) ?? []
    had.push([key, entry])
    byBucket.set(bucket, had)
  }
  let saved = 0
  for (const rows of byBucket.values()) {
    if (!rows.some(([key]) => keys.has(key))) continue
    const before = Buffer.byteLength(serialise(Object.fromEntries(rows)))
    const left = rows.filter(([key]) => !keys.has(key))
    saved += before - (left.length ? Buffer.byteLength(serialise(Object.fromEntries(left))) : 0)
  }
  return saved
}

function bucketFor(key: string): string {
  return bucketOf(groupOf(key))
}

/** What a purge would remove, and what it frees. Writes nothing. */
export function preview(
  projectPath: string | null | undefined,
  rule: Rule,
  finished: readonly Finished[] | null = null,
  now = Date.now(),
): Said<Plan> {
  const read = readRule(rule)
  if (!read.ok) return read
  const open = opened(projectPath)
  if (!open.ok) return { ok: false, error: open.error }
  try {
    const took = take(open.value, read.value, finished, now)
    return took.ok ? { ok: true, value: took.value.plan } : took
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e
    return { ok: false, error: e.message }
  }
}

/* ------------------------------------------------------------------ *
 * Purging, and putting back
 * ------------------------------------------------------------------ */

const backupSchema = z.object({
  at: z.string(),
  expires: z.string(),
  rule: z.object({ scope: z.enum(SCOPES), days: z.number() }),
  /** Whole lists, as `lists.json` held them. */
  lists: z.record(z.string(), listSchema).default({}),
  /** Entries, per list id, as the buckets held them — every entry of a whole list, and the purged ones of the rest. */
  entries: z.record(z.string(), z.record(z.string(), entrySchema)).default({}),
})
type BackupFile = z.infer<typeof backupSchema>

const BACKUP_FILE = /^\d{8}T\d{6}Z-[0-9a-f]{6}\.json$/

function backupsIn(dir: string): Backup[] {
  const folder = join(dir, NAMES.purged)
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((name) => BACKUP_FILE.test(name))
    .sort()
    .flatMap((name) => {
      try {
        const file = backupSchema.parse(JSON.parse(readFileSync(join(folder, name), 'utf8')))
        const entries = Object.values(file.entries)
        return [{
          name,
          at: file.at,
          expires: file.expires,
          bytes: sizeOf(join(folder, name)),
          lists: Object.keys(file.lists).length,
          targets: entries.reduce((sum, one) => sum + Object.keys(one).length, 0),
          ticks: entries.reduce((sum, one) => sum + Object.values(one).reduce((n, entry) => n + Object.keys(entry.ticks ?? {}).length, 0), 0),
        }]
      } catch {
        return []
      }
    })
}

/** Backups past their date go, whenever Storage changes anything. Nothing else ever removes one by itself. */
function expire(dir: string, now: number): number {
  let gone = 0
  for (const one of backupsIn(dir)) {
    if (one.expires < new Date(now).toISOString()) {
      unlinkSync(join(dir, NAMES.purged, one.name))
      gone += 1
    }
  }
  return gone
}

function sizes(n: number): string {
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Remove what `preview` showed — and only if the folder still plans exactly
 * that (`digest`). `keep` writes the backup first; without it the purge is
 * permanent, and the answer says so.
 */
export function purge(
  projectPath: string | null | undefined,
  input: { rule: Rule; digest: string; keep: boolean },
  finished: readonly Finished[] | null = null,
  now = Date.now(),
): Said<{ said: string; plan: Plan; backup: string | null }> {
  const read = readRule(input.rule)
  if (!read.ok) return read
  const open = opened(projectPath)
  if (!open.ok) return { ok: false, error: open.error }
  const book = open.value
  const dir = book.dir as string
  try {
    const took = take(book, read.value, finished, now)
    if (!took.ok) return took
    const { plan, whole, entries } = took.value
    if (plan.digest !== input.digest) {
      return {
        ok: false,
        error:
          'nothing was purged: the checklists changed since that preview, so it no longer says what would go. '
          + 'Preview again, and purge what that shows.',
      }
    }
    if (!plan.lists && !plan.targets) return { ok: true, value: { said: 'nothing matched, so nothing was purged', plan, backup: null } }

    const backup: BackupFile = {
      at: new Date(now).toISOString(),
      expires: new Date(now + KEEP_DAYS * DAY).toISOString(),
      rule: read.value,
      lists: {},
      entries: {},
    }
    for (const id of whole) {
      backup.lists[id] = book.lists[id]!
      backup.entries[id] = Object.fromEntries(book.all(id))
    }
    for (const [id, keys] of entries) {
      backup.entries[id] = Object.fromEntries(keys.map((key) => [key, book.entry(id, key)!]))
    }

    let name: string | null = null
    if (input.keep) {
      const folder = join(dir, NAMES.purged)
      mkdirSync(folder, { recursive: true })
      name = `${backup.at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${plan.digest.slice(0, 6)}.json`
      writeAtomic(join(folder, name), serialise(backup))
    }

    for (const id of whole) book.forget(id)
    for (const [id, keys] of entries) {
      const list = book.lists[id]!
      for (const key of keys) {
        if (book.entry(id, key)?.since !== undefined) list.holds = Math.max(0, list.holds - 1)
        book.set(id, key, null)
      }
      book.touch()
    }
    const refused = saveBook(book, projectPath)
    if (refused) {
      if (name) unlinkSync(join(dir, NAMES.purged, name))
      return { ok: false, error: `nothing was purged. ${refused}` }
    }
    expire(dir, now)
    const what = plan.lists
      ? `${plan.lists} ${plan.lists === 1 ? 'checklist' : 'checklists'}`
      : `${plan.targets} ${plan.targets === 1 ? 'target' : 'targets'}`
    return {
      ok: true,
      value: {
        plan,
        backup: name,
        said:
          `purged ${what}, with ${plan.ticks} ${plan.ticks === 1 ? 'tick' : 'ticks'} (${sizes(plan.frees)})`
          + (name
            ? `. A backup is kept in .kehikot/checklist/purged/${name} until ${backup.expires.slice(0, 10)}: Storage can put it back, or delete it now`
            : '. No backup was kept: this cannot be undone'),
      },
    }
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e
    return { ok: false, error: `nothing was purged. ${e.message}` }
  }
}

/** A backup by the name Storage listed it under, or a refusal. Never a path from a request. */
function named(dir: string, name: string): Said<string> {
  const known = backupsIn(dir).find((one) => one.name === name)
  if (!known) return { ok: false, error: `there is no backup "${name}" here. It may have expired or been put back already.` }
  return { ok: true, value: join(dir, NAMES.purged, known.name) }
}

/**
 * Put a purge back: every list that is not here again, and every entry whose
 * target has nothing on it now. What is already here wins — a list made since
 * with the same id, a tick made since on the same item — and the answer says
 * what was left out. The backup goes once it is back.
 */
export function restore(projectPath: string | null | undefined, name: string): Said<string> {
  const open = opened(projectPath)
  if (!open.ok) return { ok: false, error: open.error }
  const book = open.value
  const dir = book.dir as string
  const found = named(dir, name)
  if (!found.ok) return found
  try {
    const file = backupSchema.parse(JSON.parse(readFileSync(found.value, 'utf8')))
    let lists = 0
    let targets = 0
    let skipped = 0
    for (const [id, list] of Object.entries(file.lists)) {
      if (book.lists[id]) {
        skipped += 1
        delete file.entries[id]
        continue
      }
      book.lists[id] = { ...list, holds: 0 }
      lists += 1
    }
    for (const [id, kept] of Object.entries(file.entries)) {
      const list = book.lists[id]
      if (!list) {
        skipped += Object.keys(kept).length
        continue
      }
      for (const [key, entry] of Object.entries(kept)) {
        const now = book.entry(id, key)
        if (!now) {
          book.set(id, key, entry)
          if (entry.since !== undefined) list.holds += 1
          if (entry.n !== undefined && entry.n >= list.next) list.next = entry.n + 1
          targets += 1
          continue
        }
        const ticks = { ...(entry.ticks ?? {}), ...(now.ticks ?? {}) }
        book.set(id, key, { ...now, ...(Object.keys(ticks).length ? { ticks } : {}) })
        targets += 1
      }
      book.touch()
    }
    const refused = saveBook(book, projectPath)
    if (refused) return { ok: false, error: `nothing was put back. ${refused}` }
    unlinkSync(found.value)
    return {
      ok: true,
      value:
        `put back ${lists} ${lists === 1 ? 'checklist' : 'checklists'} and ${targets} ${targets === 1 ? 'target' : 'targets'}`
        + (skipped ? `; ${skipped} left out, because what is here now has the same id and wins` : ''),
    }
  } catch (e) {
    if (e instanceof Unreadable) return { ok: false, error: `nothing was put back. ${e.message}` }
    return { ok: false, error: `that backup could not be read, so nothing was put back (${e instanceof Error ? e.message.split('\n')[0] : String(e)}).` }
  }
}

/** Delete one backup now, rather than at its date. Permanent, and said so. */
export function discard(projectPath: string | null | undefined, name: string): Said<string> {
  const open = opened(projectPath)
  if (!open.ok) return { ok: false, error: open.error }
  const found = named(open.value.dir as string, name)
  if (!found.ok) return found
  const bytes = sizeOf(found.value)
  unlinkSync(found.value)
  return { ok: true, value: `deleted the backup ${name} (${sizes(bytes)}); what was in it cannot be put back now` }
}

/** Usage, as text, for an agent. Reads; never purges. */
export function usageText(projectPath: string): string {
  const report = usage(projectPath)
  if (report.trouble) return report.trouble
  if (report.nowhere) return NO_PROJECT
  const lines = report.lists.map(
    (row) =>
      `  ${row.id} — "${row.name}": ${sizes(row.bytes)}, held against ${row.held}, ${row.released} released with ticks kept, `
      + `${row.ticks} ticks, last activity ${row.last ? row.last.slice(0, 10) : 'none on record'}`,
  )
  return [
    `Checklist storage in ${projectPath}/.kehikot/checklist: ${sizes(report.total)} in all.`,
    ...(lines.length ? lines : ['  No checklists.']),
    ...(report.backups.length
      ? [`  Purge backups: ${report.backups.length} (${sizes(report.backups.reduce((sum, one) => sum + one.bytes, 0))}), the last expiring ${report.backups.at(-1)!.expires.slice(0, 10)}.`]
      : []),
    '',
    'Which targets are finished is the tracker’s to say and is shown on the page, where the host hands its reading '
    + 'over. Purging is a person’s decision, made on the page under View → Storage; there is no tool for it.',
  ].join('\n')
}

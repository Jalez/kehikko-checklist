import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { dataDir } from '../store.ts'

/**
 * A checklist somebody wrote by hand, against a PAPER rather than against a
 * change.
 *
 * ## Why this exists beside the two derived lists rather than instead of them
 *
 * Every other list in this app is DERIVED: `derive()` decides what a change is
 * held to, the items are `case` arms, and the whole argument of the module is
 * that there is one answer to "what is this held to" and nobody gets to invent a
 * second one on the day they are tired. That argument is correct about a change
 * and says nothing at all about a paper. A paper is a document an epic is aimed
 * at — `kehikko-paper` reads the `.tex` and is keyed by epic — and what a paper
 * owes is not a property of a merge request, a pipeline or a review thread. It
 * is a person's own list of what is still missing from a document, and no
 * program on this machine is in a position to compute it.
 *
 * So this is the second kind, and it is deliberately unlike the first in every
 * way that matters:
 *
 * - **Authored, not computed.** There is no shipped list behind it and no way
 *   back to one, because there was never a default to drift from. `list/store.ts`
 *   holds EDITS to a shipped list and every one of its refusals exists to keep
 *   the shipped list visible beside the edit; none of that reasoning applies
 *   here, which is exactly why this is not a field in that file.
 * - **Keyed by epic, not by ref.** `roadmap.context` carries the epic and
 *   nothing else says which paper is open. A ref would be the wrong key twice
 *   over: a paper outlives every change made to it, and a change is held to the
 *   derived list already.
 * - **Ordered by the person.** See `paperSchema` below.
 *
 * ## Why a third file and not a third key in `checklist.json`
 *
 * Same directory, same `dataDir()`, same zod-over-JSON shape — this is an
 * extension of the store this app already has, not a second kind of storage.
 * What it is not is a section of `checklist.json`, and the reason is that file's
 * own failure rule: an unreadable `checklist.json` reads as "nothing edited" and
 * falls back to the shipped list, which is right for edits and catastrophic for
 * authored material. There is no shipped paper list to fall back to. A single
 * corrupt byte in a file holding both would silently turn somebody's hand-written
 * list into an empty one, on a page that looked fine — which is precisely the
 * failure `store.ts` records having nearly shipped once already. Two files means
 * one of them can be broken without taking the other with it, and the read below
 * refuses to be quiet about it.
 *
 * ## Migration is additive, always
 *
 * The rule this workspace applies to a database — never drop, never rename, add
 * a column with a default so an older file opens without complaint, the
 * `add(db, table, column, definition)` helper — is the same rule here, spelled in
 * zod: every field a later version adds arrives with `.default()` or
 * `.optional()`, so a `papers.json` written today parses under a schema written
 * next year and gains the new field's default rather than failing to parse. The
 * precedent is already in this repository: `exemptSchema` in `list/store.ts`
 * accepts the bare string that shape used to be, and the essay there says what a
 * failed parse costs — the whole file read as "nothing", every entry in it
 * silently discarded. A reshaped field is migrated in the reader with a
 * `z.union` transform, never by a rewrite pass that has to be run.
 */

/**
 * One tick on a hand-written item, and WHO made it.
 *
 * ## An agent may tick these, and the derived list's rule still stands
 *
 * The manifest's `guidance` says "never tick on the owner's behalf", and that
 * rule is about the `agreed` item: an item asking whether a PERSON HAS AGREED to
 * something, which the party doing the asking can tick, is a formality with a box
 * beside it. `humanRefusal` refuses it over MCP and it is pressed on this app's
 * own origin holding a ticket this process minted. None of that changes.
 *
 * A hand-written paper item is not that. It is a task the person wrote down —
 * "the bridge chapter still claims the wire is synchronous" — and the whole point
 * of putting it where an agent can reach it is that an agent is often the one who
 * does it. Refusing the tick would leave the person hand-ticking work they
 * watched somebody else do, which is a formality in the opposite direction.
 *
 * What is NOT allowed is the tick being anonymous about its origin. So every tick
 * names its author and carries `viaMcp`, the page prints "ticked by <name>, over
 * MCP" rather than a bare checkmark, and the person can take it back with one
 * press. An agent's claim on this list is a claim, legible as one, and reversible
 * by the only person who can judge it. If somebody wants a paper item that only
 * they may tick, they write it as a question and untick what they disagree with;
 * the module does not need a second permission model to say that.
 */
const tickSchema = z.object({
  at: z.string(),
  /** The agent's own name, or the owner as this app's page files them. */
  by: z.string(),
  /** Whether it arrived through the MCP door. Printed on the row; never inferred from the name. */
  viaMcp: z.boolean().default(false),
  /** How they know, where they said. */
  note: z.string().optional(),
})
export type PaperTick = z.infer<typeof tickSchema>

const itemSchema = z.object({
  /**
   * This app's own handle for the item, which is what an agent addresses it by.
   *
   * Not the text and not the position. The text is the thing most likely to be
   * reworded — that is half of what this list is for — and the position is the
   * thing most likely to move, so either as an identifier would mean every call
   * an agent made pointed at whatever happened to be there afterwards. Eight hex
   * characters: short enough to type into a tool call, and there are not going to
   * be four billion items on one paper.
   */
  id: z.string(),
  /** The line, as the person typed it. Wrapped wherever it is drawn, never clipped. */
  text: z.string(),
  at: z.string(),
  by: z.string(),
  /** Null rather than absent: "nobody has ticked this" is a state with a row of its own. */
  done: tickSchema.nullable().default(null),
})
export type PaperItem = z.infer<typeof itemSchema>

/**
 * One paper's list.
 *
 * ## Order is the array's order, and there is no `order` field
 *
 * A hand-written list has an order the person chose, it has to survive a reload,
 * and so it is stored. It is stored as the ORDER OF THE ARRAY rather than as a
 * number on each item, which is the decision worth writing down because the other
 * way is the one that looks tidier.
 *
 * A numeric `order` field is two sources for one fact: the array has an order
 * whether or not anybody meant it to, so a file whose numbers disagreed with its
 * array would hold two answers and no way to say which was meant. Every reorder
 * is then a write across every row, and the first partial write leaves two items
 * claiming position 3. The array is the single source, `move` rewrites it whole,
 * and a reader that does nothing but iterate gets the right answer without
 * knowing the rule.
 */
const paperSchema = z.object({
  items: z.array(itemSchema).default([]),
})

const storeSchema = z.object({
  /** Keyed by epic slug — the one thing `roadmap.context` carries that names a paper. */
  papers: z.record(z.string(), paperSchema).default({}),
})
type Store = z.infer<typeof storeSchema>

export function papersFile(): string {
  return join(dataDir(), 'papers.json')
}

const empty = (): Store => storeSchema.parse({})

/**
 * The store, freshly read — and unlike the other two readers in this app, an
 * unreadable file here is NOT quietly read as an empty one.
 *
 * `readChecklistEdits` falls back to the shipped list and `ticks.ts` falls back
 * to no ticks, and both are defensible: the first still shows a real checklist,
 * the second loses claims that can be made again. This file has neither escape.
 * There is no shipped paper list, so "empty" is indistinguishable from "the
 * person never wrote anything", and the material is prose nobody can retype from
 * memory. So the trouble travels with the read, every caller has to look at it,
 * and a non-null `trouble` blocks every write below.
 */
function read(): { store: Store; trouble: string | null } {
  const path = papersFile()
  if (!existsSync(path)) return { store: empty(), trouble: null }
  try {
    return { store: storeSchema.parse(JSON.parse(readFileSync(path, 'utf8'))), trouble: null }
  } catch (e) {
    return {
      store: empty(),
      trouble:
        `${path} could not be read (${e instanceof Error ? e.message.split('\n')[0] : String(e)}), so no ` +
        'hand-written checklist is being shown and nothing will be written over it. Every item in that file is ' +
        'recoverable: fix or move it.',
    }
  }
}

function save(store: Store): void {
  writeFileSync(papersFile(), `${JSON.stringify(storeSchema.parse(store), null, 2)}\n`)
}

/* ------------------------------------------------------------------ *
 * What arrives, bounded before it is looked at
 * ------------------------------------------------------------------ */

/** As long as a protocol epic slug, which is what this is keyed by. */
export const MAX_EPIC = 80
/**
 * One item's text.
 *
 * Long enough for a sentence with a clause in it, short enough that the file
 * cannot be filled by one call. An item is a line on a list; the reasoning behind
 * it belongs in the paper.
 */
export const MAX_TEXT = 400
export const MAX_BY = 80
export const MAX_NOTE = 400
export const MAX_ID = 40
/**
 * How many items one paper may hold.
 *
 * Not a guess at how long a list should be — it is a bound on a file that a
 * caller with no rate limit can append to, and 200 items is already a list nobody
 * reads to the end of.
 */
export const MAX_ITEMS = 200

/**
 * An epic slug, bounded rather than pattern-matched against a grammar this app
 * does not own.
 *
 * A host says which epic is open, and this app has no business having an opinion
 * about how that name is spelled — a regex here would refuse a perfectly good
 * epic the day the host's slug rules widened, and the refusal would look like a
 * bug in this pane. What it does refuse is the shapes that are not names at all:
 * empty, over the protocol's own limit, or carrying whitespace, a path separator
 * or a control character. That last is not fussiness. The key is written into a
 * JSON object and read back; a caller who could put a newline or a slash in it is
 * a caller shaping this app's file rather than naming something in it.
 */
export function epicKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim()
  if (!slug || slug.length > MAX_EPIC) return null
  /* Whitespace and path separators, spelled as a deny list rather than as a
     positive grammar. A hyphen is emphatically allowed — every epic slug in this
     workspace has one — which is why this is not `[a-z0-9]+`. */
  if (/[\s/\\]/.test(slug)) return null
  /* Control characters, tested by code point rather than written into a regex,
     so that no literal control byte ends up in this file for somebody's editor
     to lose. */
  for (let i = 0; i < slug.length; i += 1) {
    const code = slug.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  return slug
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface Paper {
  epic: string
  items: PaperItem[]
  done: number
  total: number
  /** Set when the store file exists and cannot be read. Everything else is then empty. */
  trouble: string | null
}

/** One paper's list, in the order the person put it in. */
export function paper(epic: string): Paper {
  const { store, trouble } = read()
  const items = store.papers[epic]?.items ?? []
  return { epic, items, done: items.filter((i) => i.done).length, total: items.length, trouble }
}

/** Every epic anything has been written down against, so a reader with no canvas can find one. */
export function papersWritten(): { epic: string; done: number; total: number }[] {
  const { store } = read()
  return Object.entries(store.papers)
    .filter(([, p]) => p.items.length)
    .map(([epic, p]) => ({ epic, done: p.items.filter((i) => i.done).length, total: p.items.length }))
    .sort((a, b) => a.epic.localeCompare(b.epic))
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type PaperOp =
  | { op: 'add'; epic: string; text: string; by: string; viaMcp?: boolean }
  | { op: 'reword'; epic: string; id: string; text: string; by: string; viaMcp?: boolean }
  | { op: 'tick'; epic: string; id: string; done: boolean; by: string; viaMcp?: boolean; note?: string }
  | { op: 'move'; epic: string; id: string; to: number; by: string; viaMcp?: boolean }
  | { op: 'drop'; epic: string; id: string; by: string; viaMcp?: boolean }

export type PaperResult = { ok: true; said: string; paper: Paper } | { ok: false; error: string }

/**
 * Change one paper's list, and say what happened in a sentence somebody can read
 * back.
 *
 * One function for all five operations, in the shape `setChecklist` already uses,
 * so the page and the MCP door cannot end up applying two different rules — and
 * so every refusal below is written once and read by both. Each names what was
 * wrong and what to do instead; a bare "no" is the kind of refusal an agent
 * routes around.
 */
export function setPaper(input: PaperOp): PaperResult {
  const { store, trouble } = read()
  if (trouble) return { ok: false, error: `nothing was changed. ${trouble}` }

  const epic = epicKey(input.epic)
  if (!epic) {
    return {
      ok: false,
      error:
        'that is not an epic. A hand-written checklist is kept against the paper an epic is aimed at, so it needs '
        + "the epic's slug — the one the canvas is on, as list_epics spells it. It cannot be empty, longer than "
        + `${MAX_EPIC} characters, or contain a space or a slash.`,
    }
  }
  const by = input.by.trim().slice(0, MAX_BY) || 'somebody who did not say'
  const items = [...(store.papers[epic]?.items ?? [])]
  const at = new Date().toISOString()

  const put = (next: PaperItem[], said: string): PaperResult => {
    store.papers[epic] = { items: next }
    /* An epic with nothing left on it is deleted rather than kept as an empty
       list. A paper somebody wrote three items against and then cleared is a
       paper with no list, and a file full of empty arrays reads as if it holds
       something — the same judgement `ticks.ts` makes about a ref. */
    if (!next.length) delete store.papers[epic]
    save(store)
    return { ok: true, said, paper: paper(epic) }
  }

  const find = (id: string): number => items.findIndex((i) => i.id === id)
  const missing = (id: string): PaperResult => ({
    ok: false,
    error:
      `there is no item "${id}" on ${epic}'s checklist. Items are addressed by the id paper_checklist prints beside `
      + 'each one, not by their words or their position — both of those move. Read the list again: somebody may have '
      + 'taken it off since you last looked.',
  })

  if (input.op === 'add') {
    const text = input.text.trim().slice(0, MAX_TEXT)
    if (!text) {
      return {
        ok: false,
        error:
          'an item needs to say something. Write what is still owed in a line somebody else could act on — this list '
          + 'is hand-written precisely because no program can work out what a paper is missing.',
      }
    }
    if (items.length >= MAX_ITEMS) {
      return {
        ok: false,
        error: `${epic} already has ${items.length} items, which is the most one paper holds. Tick or drop something first.`,
      }
    }
    const item: PaperItem = { id: newId(), text, at, by, done: null }
    return put([...items, item], `added "${item.text}" to ${epic} as ${item.id}`)
  }

  if (input.op === 'reword') {
    const found = find(input.id)
    if (found === -1) return missing(input.id)
    const text = input.text.trim().slice(0, MAX_TEXT)
    if (!text) return { ok: false, error: 'an item needs to say something; to take one off the list, drop it.' }
    const next = [...items]
    next[found] = { ...items[found]!, text }
    return put(next, `${input.id} on ${epic} now reads "${text}"`)
  }

  if (input.op === 'tick') {
    const found = find(input.id)
    if (found === -1) return missing(input.id)
    const was = items[found]!
    const next = [...items]
    next[found] = {
      ...was,
      done: input.done
        ? { at, by, viaMcp: input.viaMcp === true, note: input.note?.trim().slice(0, MAX_NOTE) || undefined }
        : null,
    }
    return put(
      next,
      input.done ? `${input.id} on ${epic} is ticked, by ${by}` : `${input.id} on ${epic} is no longer ticked`,
    )
  }

  if (input.op === 'move') {
    const found = find(input.id)
    if (found === -1) return missing(input.id)
    /* Clamped rather than refused. "Move it to the top" said as `to: 0` and
       "move it to the end" said as a number past the end are both perfectly clear
       intentions, and refusing the second would mean an agent had to know the
       length before it could ask for the obvious thing. What cannot be clamped is
       a number that is not one, and that is refused at the door. */
    const to = Math.max(0, Math.min(items.length - 1, Math.trunc(input.to)))
    if (to === found) {
      return {
        ok: true,
        said: `${input.id} is already ${to === 0 ? 'first' : `at position ${to + 1}`} on ${epic}`,
        paper: paper(epic),
      }
    }
    const next = [...items]
    const [moved] = next.splice(found, 1)
    next.splice(to, 0, moved!)
    return put(next, `${input.id} on ${epic} moved to position ${to + 1} of ${next.length}`)
  }

  const found = find(input.id)
  if (found === -1) return missing(input.id)
  const gone = items[found]!
  return put(
    items.filter((i) => i.id !== input.id),
    `"${gone.text}" is off ${epic}'s checklist${gone.done ? ', along with the tick that was on it' : ''}`,
  )
}

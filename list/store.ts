import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import {
  CHECKLIST,
  EXEMPT,
  GITHUB_WORDING,
  ISSUE_CHECKLIST,
  SIZE_BIG,
  SIZE_FINE,
  type ChecklistHost,
  type ChecklistItem,
} from './shipped.ts'
import { dataDir } from '../store.ts'

/**
 * The checklist as somebody has since decided it, and the app's own store for it.
 *
 * This is `checklist.ts`'s edits store taken wholesale — the schema, the
 * migrations, every refusal and every sentence a refusal gives back. Two things
 * are different and both follow from this being an app rather than a panel:
 *
 * - **The file lives beside this program**, not in the roadmap's `data/`. An
 *   app whose store was inside somebody else's repository would be an app that
 *   cannot be moved, and moving it is the whole point of the extraction.
 * - **`ROADMAP_DATA` is not read here.** That variable moves the roadmap's data
 *   directory, and honouring it would mean this app's store followed a roadmap
 *   that may not even be running. `CHECKLIST_DATA` is this app's own, and
 *   `store.ts` beside this file is where it is resolved.
 *
 * Everything else is unchanged on purpose. The words are the material: every
 * refusal below was written about a real press somebody made, and rewording
 * them during a move is how a reason quietly becomes a shrug.
 */

function retell(s: string, host: ChecklistHost): string {
  if (host !== 'github') return s
  return s.replace(/merge request/g, 'pull request').replace(/Merge request/g, 'Pull request')
}

/**
 * One item as the given host should read it.
 *
 * The host retelling is a SEPARATE editable text, not a fallback: an item that
 * ships different words on GitHub keeps them when its main wording is reworded,
 * because the two say deliberately different things — "Sonar included" is true
 * on one side and a promise nothing keeps on the other. So an owner who rewords
 * `pipeline` and expects GitHub to follow would be wrong, and the settings
 * dialog renders the retelling as its own row rather than leaving that
 * discovery to somebody reading a pull request.
 */
export function itemFor(item: ChecklistItem, host: ChecklistHost): ChecklistItem {
  const over = host === 'github' ? hostWording(item.id) : undefined
  return {
    ...item,
    label: over ? over.label : retell(item.label, host),
    why: over ? over.why : retell(item.why, host),
  }
}

/**
 * The checklist as it stands on one host: exempt items dropped, the rest in
 * that host's words. What was dropped is in `exemptFor`, and a caller is
 * expected to say so rather than let an item disappear without explanation.
 *
 * Read through the store, so an item reworded, added, removed or exempted from
 * the settings dialog is in the answer immediately — no restart, and no cached
 * copy of the list left standing.
 */
export function checklistFor(host: ChecklistHost): ChecklistItem[] {
  const exempt = exemptFor(host)
  return effectiveList('mr')
    .filter((c) => !(c.id in exempt))
    .map((c) => itemFor(c, host))
}

/**
/**
 * The two numbers actually applied, which are the owner's where they have set
 * them and the calibrated ones above otherwise.
 *
 * Deliberately global rather than per repository, which is a change from what
 * was asked for and the reason is worth writing down. `derive` is handed a
 * `RefState` and a host, and neither carries a repository — `gh#1888` does not
 * say which repo it is in, and `changeRef` cannot work it out. A per-repo
 * threshold would therefore have to be keyed on something the reader does not
 * have, and would silently fall through to the global number without saying
 * which one it used: a guess printing as a fact. The honest version of that
 * feature needs a repo on `RefState` first.
 */
export function sizeFine(): number {
  return readChecklistEdits().size.fine ?? SIZE_FINE
}

export function sizeBig(): number {
  return readChecklistEdits().size.big ?? SIZE_BIG
}

/** GitLab caps the count and says "1000+", so read the number off the front. */
export function filesChanged(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * What the tracker says about the derived items. `unknown` is deliberate: a
 * merge request read before its pipeline started has no answer yet, and
 * guessing "pending" would read as a failure that is not there. The same rule
 * decides the GitHub answers below — a checklist that green-ticks what it did
 * not check is worse than one that admits it did not check.
 *
 * `host` defaults to GitLab so every existing caller keeps the answers it had.
 */
/**
 * The sentence a derived item adds when the mark alone is not the answer.
 *
 * A `[!]` beside "Closes exactly one issue" says something is wrong and not
 * which thing, and the two ways to fail it have opposite remedies: name an
 * issue, or split the change. The remedy is the useful half, so it is said
 * here rather than left for the reader to infer from a bracket.
 * Why an agent cannot tick an owner's item.
 *
 * Here rather than beside the MCP door because it is part of what `human`
 * MEANS, and because a rule that costs a running MCP server to test is a rule
 * that quietly stops being true. The page it names is this app's own: the press
 * goes to this app's server, over loopback, holding a ticket this process handed
 * out — which is how a program with no roadmap behind it can still prove that a
 * person at this machine, and not the party asking, was the one who agreed. It names who ticks it, where, and what to do meanwhile: a
 * bare "you may not" is the kind of refusal an agent routes around, and one
 * that hands back the next action is one it follows.
 */
export function humanRefusal(ref: string, item: string): string {
  return (
    `${ref}: ${item} is the owner's to tick, on this app's own page, and nothing you can do makes it green — ` +
    'that is the point of it. Show them the finished work and ask, then carry on with anything that does not ' +
    'depend on the answer; asking does not block. Where a roadmap is running, ask_human puts the question and ' +
    'check_answers reads the reply.'
  )
}

/**
 * Whether the person at the page may tick this, and why not when they may not.
 *
 * The mirror of `humanRefusal`, and narrow in the same way. The agent half is
 * asserted over MCP so the agent's name goes on it, and the derived half is
 * read from the tracker every time; a page that could tick either would be a
 * way to hand-wave both. So this admits exactly one kind, and the refusal says
 * which of the other two it met — those have opposite remedies.
 *
 * Both lists are searched. An owner's item lives on the issue list today, but
 * nothing about the kind is issue-shaped, and a lookup that knew about only one
 * list would silently refuse the first one added to the other.
 */
export function ownerMayTick(id: string): { ok: true } | { ok: false; error: string } {
  const found = [...effectiveList('issue'), ...effectiveList('mr')].find((x) => x.id === id)
  if (!found) return { ok: false, error: `there is no "${id}" on either checklist.` }
  if (found.kind === 'human') return { ok: true }
  return {
    ok: false,
    error: `"${id}" is not yours to tick: ${
      found.kind === 'derived'
        ? 'it is read from the tracker, so fixing the change is what changes it'
        : 'an agent asserts it over MCP, under its own name'
    }.`,
  }
}
/* ================================================================== *
 * The checklist as somebody has since decided it
 * ================================================================== */

/**
 * The editable half of the two lists above.
 *
 * ## Where it is kept, and read
 *
 * One JSON file in this app's own data directory, resolved at call time and
 * read on every call — so an edit reaches the next reader with no restart, and
 * an absent or unparseable file answers with the shipped list rather than with
 * nothing. That last rule is the important one and it is repeated at every
 * reader below: a store nobody can parse must never be able to BLANK what a
 * change is expected to have done.
 *
 * ## What is editable, what is not, and why the difference is kept
 *
 * - **Wording** — every item's label and reason, on either list. An item that
 *   ships different words on GitHub has those as a second editable row, because
 *   they say a deliberately different thing.
 * - **Whether it applies** — per host, with a reason, which is `EXEMPT`. This
 *   is how an item comes off a list without pretending it was never there:
 *   "not here, and here is why" costs one line and keeps the other twelve
 *   believed. Exempt on both hosts is how a derived item is hidden.
 * - **Agent items may be added and removed.** A new one is just text somebody
 *   asserts, so there is nothing behind it that could be missing.
 * - **Derived items may not be added or removed.** Each is a `case` arm in
 *   `derive`, whose `default:` answers `unknown`; an item conjured from a name
 *   typed into a dialog would read `unknown` for ever, which is exactly the
 *   control that can never match anything this project has already had to fix.
 * - **Ids are never editable.** `EXEMPT` keys on them, `HEAD_PINNED` keys on
 *   `reviewed`, `deriveDetail` names `names-issue`, and every tick in this app's own
 *   store is filed under `(ref, item)` with no foreign key. A
 *   rename would silently orphan all of that and look like a success. Remove
 *   and add instead, which says what it is doing.
 *
 * ## What happens to ticks filed against an item that is removed
 *
 * They are ORPHANED, kept, and said out loud. Not deleted: a tick is a record
 * that an agent asserted something about a real change, and `check_mr`'s untick
 * is already deliberately ungated on the same principle — "a tick filed before
 * an exemption existed still has to be removable" — so the rows stay removable
 * by the tool that made them rather than being swept away by an edit somewhere
 * else. Not hidden either: `mr_checklist` lists them under the checklist, by
 * name, so nothing disappears in silence. Re-adding the same id picks them back
 * up, which is why adding an id that is merely removed is refused and pointed
 * at `restore`.
 *
 * ## One list, not one per repository
 *
 * `checklistFor(host)` already splits the WORDING two ways, and the note on
 * `ChecklistHost` says why it is one list rather than two: an item must never be
 * able to exist quietly on one side and be forgotten on the other. Nothing here
 * changes that. `EXEMPT` is the per-context layer, it is now editable, and it
 * carries its own reason — which is what the motivating example (`changeset` on
 * GitHub) actually is.
 */

/** The two lists, named so the store can key on them. */
export type ChecklistName = 'mr' | 'issue'
export const CHECKLIST_NAMES: readonly ChecklistName[] = ['mr', 'issue']

/** The list as it shipped, whatever the store may say. This is the way back. */
export function shippedList(name: ChecklistName): ChecklistItem[] {
  return name === 'mr' ? CHECKLIST : ISSUE_CHECKLIST
}

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

const stampSchema = z.object({
  setAt: z.string().optional(),
  setBy: z.string().optional(),
})

/**
 * A reworded label and reason.
 *
 * Keyed by `id`, or by `id@github` for the GitHub retelling of an item that
 * ships one.
 */
const wordingSchema = stampSchema.extend({
  label: z.string().optional(),
  why: z.string().optional(),
})

/** An item somebody added. Always `agent`; there is no code behind a new name. */
const addedSchema = stampSchema.extend({
  id: z.string(),
  label: z.string(),
  why: z.string(),
})

const listEditsSchema = z.object({
  wording: z.record(z.string(), wordingSchema).default({}),
  added: z.array(addedSchema).default([]),
  /** Shipped items taken off the list, by id. The stamp is who took it off. */
  removed: z.record(z.string(), stampSchema).default({}),
})

/**
 * An exemption per host, by id.
 *
 * An empty `why` is not the absence of an entry: it means somebody has said this
 * item DOES apply here, over an exemption that shipped. Without that
 * distinction, clearing `changeset` on GitHub would be indistinguishable from
 * never having touched it, and would come straight back.
 *
 * Stamped like every other edit. Deciding an item does not apply on a tracker
 * is a decision somebody made about what agents are held to, and a decision
 * nobody can be shown to have made is exactly the one that later has to be
 * accounted for.
 */
/**
 * A bare string is read as the reason, with nobody named.
 *
 * These entries were a plain `Record<string, string>` before the stamp was
 * added. Without this the whole file would fail to parse, and an unparseable
 * file reads as "nothing edited" — so a version bump would silently throw away
 * every exemption, every rewording and every removal in it, and report the list
 * as untouched. Migrating in the reader costs one line and cannot lose
 * anything; what it cannot recover is who wrote the reason, which is honestly
 * absent rather than attributed to whoever happens to be running.
 */
const exemptSchema = z.union([
  z.string().transform((why): { why: string; setAt?: string; setBy?: string } => ({ why })),
  stampSchema.extend({ why: z.string() }),
])

const exemptEditsSchema = z.object({
  gitlab: z.record(z.string(), exemptSchema).default({}),
  github: z.record(z.string(), exemptSchema).default({}),
})

const emptyList = { wording: {}, added: [], removed: {} }

export const checklistEditsSchema = z.object({
  lists: z
    .object({ mr: listEditsSchema.default(emptyList), issue: listEditsSchema.default(emptyList) })
    .default({ mr: emptyList, issue: emptyList }),
  exempt: exemptEditsSchema.default({ gitlab: {}, github: {} }),
  size: z.object({ fine: z.number().int().optional(), big: z.number().int().optional() }).default({}),
})
export type ChecklistEdits = z.infer<typeof checklistEditsSchema>

/**
 * Where the file lives: beside this program, under this app's own data
 * directory, which `CHECKLIST_DATA` moves. Read at call time rather than closed
 * over, so a test or a deployment that sets the variable does not depend on
 * which module happened to load first.
 */
export function checklistFile(): string {
  return join(dataDir(), 'checklist.json')
}

const emptyEdits = (): ChecklistEdits => checklistEditsSchema.parse({})

/**
 * The edited half, freshly read.
 *
 * Absent is the normal case and reads as "nothing edited". A file that cannot
 * be parsed reads the same way, for the reason the prompts store gives: the
 * fallback is the list somebody wrote on purpose, and a broken store must never
 * be able to blank what a merge request is expected to have done.
 */
export function readChecklistEdits(): ChecklistEdits {
  const path = checklistFile()
  if (!existsSync(path)) return emptyEdits()
  try {
    return checklistEditsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return emptyEdits()
  }
}

/**
 * Whether there is a store file that cannot be read, and what to say about it.
 *
 * `readChecklistEdits` answers an unreadable file with the shipped list, which
 * is right — a broken store must never be able to blank what a merge request is
 * expected to have done. What is NOT right is letting that be the whole story,
 * because the shipped list and "we could not read the edits" are different
 * answers and only one of them was being given: the page stated "Nobody has
 * changed this" about every row, which is a guess printed as a fact where the
 * honest answer is "cannot tell".
 *
 * Absent is not trouble. A file that has never been written is genuinely
 * nothing edited.
 */
export function checklistTrouble(): string | null {
  const path = checklistFile()
  if (!existsSync(path)) return null
  try {
    checklistEditsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    return null
  } catch (e) {
    return `${path} could not be read (${
      e instanceof Error ? e.message.split('\n')[0] : String(e)
    }), so what follows is the list as it SHIPPED — any wording, exemption or threshold in that file is not being applied, and is not shown here either. Nothing will be written over it until it parses, so the edits in it are recoverable: fix or move the file.`
  }
}

function writeChecklistEdits(file: ChecklistEdits): void {
  writeFileSync(checklistFile(), `${JSON.stringify(checklistEditsSchema.parse(file), null, 2)}\n`)
}

/* ------------------------------------------------------------------ *
 * The list as it now stands
 * ------------------------------------------------------------------ */

/**
 * The GitHub retelling in force for an item: the edit if there is one.
 *
 * Read from the merge-request list's edits and only that one. `GITHUB_WORDING`
 * is a merge-request thing — an issue reads the same on either tracker — and
 * ids are unique across both lists, so there is no second place a retelling
 * could be hiding.
 */
function hostWording(id: string): { label: string; why: string } | undefined {
  const shipped = GITHUB_WORDING[id]
  const edit = readChecklistEdits().lists.mr.wording[`${id}@github`]
  if (!edit) return shipped
  const label = edit.label ?? shipped?.label
  const why = edit.why ?? shipped?.why
  // Half an override is not an override: an edited label with no reason behind
  // it would put new words over the reasoning that explains the old ones.
  if (label === undefined || why === undefined) return shipped
  return { label, why }
}

/**
 * One list as it now stands: shipped items, minus the ones taken off, reworded
 * where somebody has reworded them, with anything added on the end.
 *
 * Added items go last rather than into a place of their own. Order here is the
 * order somebody reads them in and nothing turns on it, so an ordering control
 * would be a fourth thing to keep in step for no answer it could give.
 */
export function effectiveList(name: ChecklistName): ChecklistItem[] {
  const edits = readChecklistEdits().lists[name]
  const kept = shippedList(name)
    .filter((c) => !(c.id in edits.removed))
    .map((c) => {
      const over = edits.wording[c.id]
      return over ? { ...c, label: over.label ?? c.label, why: over.why ?? c.why } : c
    })
  const added: ChecklistItem[] = edits.added
    .filter((a) => !(a.id in edits.removed))
    .map((a) => {
      const over = edits.wording[a.id]
      return { id: a.id, kind: 'agent' as const, label: over?.label ?? a.label, why: over?.why ?? a.why }
    })
  return [...kept, ...added]
}

/** The exemptions in force on one host: what shipped, as the store has left it. */
export function exemptFor(host: ChecklistHost): Record<string, string> {
  const out: Record<string, string> = { ...EXEMPT[host] }
  for (const [id, entry] of Object.entries(readChecklistEdits().exempt[host])) {
    // An empty reason is somebody saying the item DOES apply here, which is the
    // only way back off an exemption that shipped.
    if (entry.why.trim()) out[id] = entry.why
    else delete out[id]
  }
  return out
}

/**
 * Ticks filed against something that is no longer on the list.
 *
 * Removing an item does not delete its ticks, and this is the line that stops
 * that being a silence. A tick is a record that an agent asserted something
 * about a real change, and `check_mr`'s untick is already deliberately ungated
 * on the same principle — "a tick filed before an exemption existed still has
 * to be removable" — so the rows stay removable by the tool that made them
 * rather than being swept away by an edit somewhere else. Putting the id back
 * picks its ticks up again, which is why adding an id that is merely removed is
 * refused and pointed at restoring it.
 *
 * An exempt item is NOT an orphan: it is still on the list, said out loud, with
 * its reason beside it.
 */
export function orphanTicks(
  ticked: { item: string; agent: string }[],
): { item: string; agent: string; said: string }[] {
  /* The effective list, and deliberately not `checklistFor(host)`.
   *
   * An exempt item is still ON the list — it is printed with its reason beside
   * it — so a tick against one is not an orphan, and an untick is already
   * ungated for exactly that case. Taking the host into account here would also
   * have made a tick an orphan on one tracker and not on the other, which is
   * the same tick reading two ways depending on where it was looked at. */
  const known = new Set(effectiveList('mr').map((i) => i.id))
  return ticked
    .filter((t) => !known.has(t.item))
    .map((t) => ({
      ...t,
      said: `ticked by ${t.agent}, but no such item is on the checklist any more. The tick is kept rather than deleted, because it is a record of something an agent asserted about this change; check_mr with done: false is what takes it back, and putting the item back on the list makes it count again.`,
    }))
}

/** Every agent item on the merge-request list, as it now stands. */
export function agentItems(): string[] {
  return effectiveList('mr')
    .filter((c) => c.kind === 'agent')
    .map((c) => c.id)
}

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

export type ChecklistOp =
  | {
      op: 'save'
      list: ChecklistName
      id: string
      label: string
      why: string
      exempt?: Partial<Record<ChecklistHost, string>>
      by?: string
    }
  | { op: 'revert'; list: ChecklistName; id: string; by?: string }
  | { op: 'add'; list: ChecklistName; id: string; label: string; why: string; by?: string }
  | { op: 'remove'; list: ChecklistName; id: string; by?: string }
  | { op: 'restore'; list: ChecklistName; id: string; by?: string }
  | { op: 'size'; fine?: number | null; big?: number | null; by?: string }

export type ChecklistResult = { ok: true; said: string } | { ok: false; error: string }

const ID_SHAPE = /^[a-z][a-z0-9-]{1,31}$/

/** The id an `id@github` row is a retelling of, or null for a plain row. */
function retellingOf(key: string): string | null {
  const at = key.indexOf('@')
  return at === -1 ? null : key.slice(0, at)
}

function knownIds(): Set<string> {
  const file = readChecklistEdits()
  const out = new Set<string>()
  for (const name of CHECKLIST_NAMES) {
    for (const c of shippedList(name)) out.add(c.id)
    for (const a of file.lists[name].added) out.add(a.id)
  }
  return out
}

function findItem(name: ChecklistName, id: string): ChecklistItem | undefined {
  const shipped = shippedList(name).find((c) => c.id === id)
  if (shipped) return shipped
  const added = readChecklistEdits().lists[name].added.find((a) => a.id === id)
  return added ? { id: added.id, kind: 'agent', label: added.label, why: added.why } : undefined
}

/** The words an item shipped with — an added one shipped with its own. */
export function shippedWordingOf(list: ChecklistName, id: string): { label: string; why: string } | undefined {
  const shipped = shippedList(list).find((c) => c.id === id)
  if (shipped) return { label: shipped.label, why: shipped.why }
  const added = readChecklistEdits().lists[list].added.find((a) => a.id === id)
  return added ? { label: added.label, why: added.why } : undefined
}

/**
 * Change one row of one list, and say what happened in a sentence somebody can
 * read back.
 *
 * Every refusal below names what was wrong and what to do instead, in the shape
 * `validateMachinePath` and `setPrompt` already use: the moment somebody can
 * still fix it is now, not in a session nobody is watching.
 */
export function setChecklist(input: ChecklistOp): ChecklistResult {
  /* Nothing is written over a file that could not be read.
     *
     `readChecklistEdits` falls back to the shipped list, so without this the
     first save after a corrupted byte would serialise that fallback over the
     top — permanently discarding every rewording, removal, exemption and
     threshold in the file, and reporting plain success. The store is somebody's
     decided material; the moment it cannot be read is the moment to stop, not
     to overwrite. */
  const trouble = checklistTrouble()
  if (trouble) {
    return {
      ok: false,
      error: `nothing was changed, because the checklist store cannot be read and saving would write over it. ${trouble}`,
    }
  }
  const file = readChecklistEdits()
  const by = input.by?.trim() || 'the settings dialog'
  const stamp = { setAt: new Date().toISOString(), setBy: by }

  if (input.op === 'size') {
    const fine = input.fine ?? null
    const big = input.big ?? null
    if (fine === null && big === null) {
      file.size = {}
      writeChecklistEdits(file)
      return {
        ok: true,
        said: `the size thresholds are back to the ones that shipped: fine up to ${SIZE_FINE} files, too big over ${SIZE_BIG}`,
      }
    }
    /* One number sent leaves the other where it is, rather than dropping it
       back to what shipped. Half a pair silently reverting the other half is a
       change nobody asked for reported as the change they did. */
    const f = fine ?? file.size.fine ?? SIZE_FINE
    const b = big ?? file.size.big ?? SIZE_BIG
    if (!Number.isInteger(f) || !Number.isInteger(b) || f < 1 || b < 1) {
      return {
        ok: false,
        error: 'both thresholds count files touched, so both have to be whole numbers of one or more.',
      }
    }
    if (f >= b) {
      return {
        ok: false,
        error: `the first threshold (${f}) has to be below the second (${b}). Under the first is "small enough", between them is "worth a look", over the second is "too big" — equal or crossed leaves the middle answer with nothing that could ever land in it.`,
      }
    }
    file.size = { fine: f, big: b }
    writeChecklistEdits(file)
    return { ok: true, said: `a change reads as small enough up to ${f} files and too big over ${b}` }
  }

  const list = input.list
  if (list !== 'mr' && list !== 'issue') {
    return { ok: false, error: `no such list: ${String(list)}. There are two, "mr" and "issue".` }
  }
  const edits = file.lists[list]
  const listName = list === 'mr' ? 'merge-request' : 'issue'

  if (input.op === 'add') {
    const id = input.id.trim()
    if (!ID_SHAPE.test(id)) {
      return {
        ok: false,
        error: `"${id}" cannot be an id. An id is what a tick is filed under and what code keys on, so it is lower-case letters, digits and hyphens, starting with a letter, 2 to 32 characters long. The label is where the words go.`,
      }
    }
    if (edits.removed[id]) {
      return {
        ok: false,
        error: `there was already a "${id}" and it was taken off the list. Ticks filed against it are still in the store under that name, so putting it back is a restore rather than a new item — otherwise old ticks would reattach to a different item wearing the same id.`,
      }
    }
    if (knownIds().has(id)) {
      return {
        ok: false,
        error: `"${id}" is already an item. Reword that one rather than adding a second under the same id: a tick names an id, and two items sharing one could never be told apart.`,
      }
    }
    const label = input.label.trim()
    const why = input.why.trim()
    if (!label) return { ok: false, error: 'an item needs a label: it is the line somebody reads on the list.' }
    if (!why) return { ok: false, error: WHY_REQUIRED }
    edits.added.push({ id, label, why, ...stamp })
    writeChecklistEdits(file)
    return {
      ok: true,
      said: `"${label}" was added to the ${listName} list as an agent item, id ${id}. It is something an agent asserts with check_mr, because nothing reads a new name off a tracker.`,
    }
  }

  if (input.op === 'remove') {
    const id = input.id.trim()
    const item = findItem(list, id)
    if (!item) return { ok: false, error: `no item "${id}" on the ${listName} list.` }
    if (item.kind === 'derived') {
      return {
        ok: false,
        error: `"${id}" is read from the tracker by a case arm in derive(), so there is nothing here to remove — taking the name away would leave the code that answers it answering for nobody. If it should not be asked here, say it does not apply and why: it then comes off the list carrying its reason, which is the one thing an unexplained absence cannot do.`,
      }
    }
    /* The list `check_mr` publishes is built from this one. An empty agent half
       leaves a tool that can never tick anything, which is a control that
       cannot act, and this project does not ship one.
       *
       Exempting every agent item instead reaches the same shape and is NOT
       refused, deliberately: an exemption refuses each tick with the reason it
       carries, so the tool still answers, and it answers with the sentence
       somebody wrote about why the item does not apply here. That is a control
       saying why it cannot act, which is the thing the rule actually asks for. */
    if (list === 'mr' && agentItems().filter((x) => x !== id).length === 0) {
      return {
        ok: false,
        error: `"${id}" is the last item an agent can assert. Removing it would leave check_mr a tool with nothing it could ever tick, which is a control that cannot act. Add its replacement first, then take this one off.`,
      }
    }
    /* An added item is taken off exactly the way a shipped one is, and its
       entry in `added` is kept as the tombstone.
       *
       Deleting it outright was the obvious thing and it was wrong twice over:
       the id would be free again, so a new item could take it and inherit the
       old one's ticks — which is precisely what the refusal below exists to
       prevent for shipped ids — and its row would disappear from a dialog
       somebody has open, leaving a live "Take it off the list" over an item
       that is no longer there. */
    /* Refused rather than accepted as a no-op, and for the reason the stamp
       exists: a second removal would overwrite who removed it with whoever
       pressed it again, putting one person's name on another person's
       decision. `restore` refuses the mirror case already. */
    if (edits.removed[id]) {
      const who = edits.removed[id]?.setBy
      return {
        ok: false,
        error: `"${id}" is already off the ${listName} list${who ? `, taken off by ${who}` : ''}. Nothing here to do — "put it back" is what changes that.`,
      }
    }
    edits.removed[id] = stamp
    writeChecklistEdits(file)
    // An added item never shipped, so telling somebody it did would name a
    // version of it that has never existed — the same falsehood `revert` refuses
    // to tell one branch below.
    const wasAdded = edits.added.some((a) => a.id === id)
    return {
      ok: true,
      said: wasAdded
        ? `"${id}" is off the ${listName} list. It was added here rather than shipped, but it is still one press from coming back — and ticks already filed against it are kept rather than deleted, and are listed as orphans rather than vanishing.`
        : `"${id}" is off the ${listName} list. It shipped, so it is one press from coming back — and ticks already filed against it are kept rather than deleted, and are listed as orphans rather than vanishing.`,
    }
  }

  if (input.op === 'restore') {
    const id = input.id.trim()
    if (!edits.removed[id]) {
      return { ok: false, error: `"${id}" is on the ${listName} list already, so there is nothing to put back.` }
    }
    delete edits.removed[id]
    writeChecklistEdits(file)
    return { ok: true, said: `"${id}" is back on the ${listName} list, and any tick still filed against it counts again.` }
  }

  if (input.op === 'revert') {
    const key = input.id.trim()
    const base = retellingOf(key)
    /* Refused rather than answered "put back", because "there is no such item"
       and "it is as it shipped" are different answers and only one of them is
       true. A press that silently succeeds on a name nothing has is how a
       typo becomes a change somebody believes they made. */
    const item = findItem(list, base ?? key)
    if (!item) return { ok: false, error: `no item "${base ?? key}" on the ${listName} list, so there is nothing to put back.` }
    if (base && !GITHUB_WORDING[base]) {
      return { ok: false, error: `"${base}" does not ship words of its own on GitHub, so there is no second wording to put back.` }
    }
    const wasAdded = edits.added.some((a) => a.id === key)
    delete edits.wording[key]
    if (!base) {
      delete file.exempt.gitlab[key]
      delete file.exempt.github[key]
    }
    writeChecklistEdits(file)
    /* Three things said, and each is said because the press does not do what
       its shortest description says.
       *
       An added item never shipped, so "back to the way it shipped" would name a
       version of it that has never existed. And this puts the WORDING back —
       being off the list is not a wording, so a removed item stays off, and
       saying "back to the way it shipped" beside a chip reading "off the list"
       would be two answers to one question. */
    const hidden = notShownWhy(list, key)
    return {
      ok: true,
      said: `${
        wasAdded ? `"${key}" is back to the words it was added with` : `"${key}" is back to the way it shipped`
      }${hidden ? `, and still ${hidden}` : ''}`,
    }
  }

  /* save: the wording, and — where the row has them — the two exemptions. */
  const key = input.id.trim()
  const base = retellingOf(key)
  const item = findItem(list, base ?? key)
  if (!item) return { ok: false, error: `no item "${base ?? key}" on the ${listName} list.` }
  if (base && !GITHUB_WORDING[base]) {
    return {
      ok: false,
      error: `"${base}" does not ship words of its own on GitHub, so there is no second wording to edit — its one wording is retold there automatically.`,
    }
  }
  const label = input.label.trim()
  const why = input.why.trim()
  if (!label) return { ok: false, error: 'an item needs a label: it is the line somebody reads on the list.' }
  if (!why) return { ok: false, error: WHY_REQUIRED }

  const asked = input.exempt
  if (asked && base) {
    return {
      ok: false,
      error: 'an exemption belongs to the item, not to the words GitHub reads it in. Set it on the item itself.',
    }
  }
  if (asked && list === 'issue') {
    /* Refused rather than stored and ignored. `checklistFor` only consults the
       exemptions for the merge-request list, so an exemption written here would
       sit in the file changing nothing while the page's chip said the row had
       been changed — a control that cannot act, wearing the look of one that
       did. The issue list has no host to be exempt from anyway: an issue is an
       issue on either tracker. */
    return {
      ok: false,
      error: 'the issue list has no per-tracker exemptions — an issue is an issue on either tracker, and nothing reads one here. Take the item off the list instead; every item on it is the agent\'s to assert, so every one can go.',
    }
  }
  if (asked) {
    for (const host of ['gitlab', 'github'] as const) {
      const wanted = asked[host]
      if (wanted === undefined) continue
      const text = wanted.trim()
      if (text && text.length < MIN_EXEMPT) {
        return {
          ok: false,
          error: `"not here" needs a reason somebody can act on, and "${text}" is not one. An item nobody can ever tick reads as a standing accusation unless it says why it does not apply, so that sentence is the whole point of an exemption — every one that shipped is a paragraph.`,
        }
      }
      const shipped = EXEMPT[host][key]
      if (text === (shipped ?? '')) delete file.exempt[host][key]
      else file.exempt[host][key] = { why: text, ...stamp }
    }
  }

  /* Stored only where it differs from what shipped. A copy of the default kept
     in the store would leave the page saying "changed" about words nobody has
     changed, which is a false fact about the checklist told by the checklist. */
  const was = base ? GITHUB_WORDING[base] : shippedWordingOf(list, key)
  if (label === was?.label && why === was?.why) delete edits.wording[key]
  else edits.wording[key] = { label, why, ...stamp }

  writeChecklistEdits(file)
  /* Allowed on a row nothing currently shows — somebody fixing the wording
     before putting it back is a real thing to want — but not silently: a save
     that reports success while nothing an agent reads has changed is a press
     that looks like it acted and did not. */
  const hidden = notShownWhy(list, key)
  return {
    ok: true,
    said: `"${key}" was saved${asked ? ', wording and where it applies' : ''}${
      hidden ? `, but it is ${hidden}` : ''
    }`,
  }
}

const WHY_REQUIRED =
  'an item needs a reason. It is what is shown on hover and in the tool, and it is the only thing standing between a list and something an agent learns to skim past — every item that shipped has one.'

/** Long enough to be a reason rather than a shrug. */
const MIN_EXEMPT = 20

/**
 * Why this row's words currently reach nobody, or null when they reach somebody.
 *
 * There are two ways for a row to be edited and yet change nothing an agent
 * ever sees — taken off the list, or marked as not applying on every tracker
 * that would show it — and a save that reported plain success in either would be
 * a press that looked like it acted. Being off the list is not the only one, so
 * this is the check rather than `removed` alone.
 *
 * One function, used by the save, the revert and the view, so the sentence a
 * press gives back and the sentence the row carries can never be two different
 * claims about the same state.
 */
export function notShownWhy(list: ChecklistName, key: string): string | null {
  const base = retellingOf(key)
  const id = base ?? key
  const listName = list === 'mr' ? 'merge-request' : 'issue'
  if (readChecklistEdits().lists[list].removed[id]) {
    /* A retelling has no button of its own, so it is not told to press one: it
       is the item above it that came off, and that row is where the press is.
       Naming a control the reader cannot see is the same fault as offering one
       that cannot act. */
    return base
      ? `the item these words retell is off the ${listName} list, so nothing shows either of them — putting the item back is what changes that`
      : `off the ${listName} list, so nothing that reads the checklist shows it — "put it back" is what changes that`
  }
  // Only the merge-request list has hosts to be exempt from.
  if (list !== 'mr') return null
  const onGithub = !(id in exemptFor('github'))
  if (base) {
    // A retelling is shown on GitHub and nowhere else, so GitHub is the only
    // side whose exemption can silence it.
    return onGithub
      ? null
      : 'marked as not applying on a GitHub pull request — and GitHub is the only place these words are ever read, so nothing shows them until that reason is cleared'
  }
  if (onGithub || !(id in exemptFor('gitlab'))) return null
  return 'marked as not applying on either tracker, so no checklist shows it — the reasons below are what a reader is given in its place'
}

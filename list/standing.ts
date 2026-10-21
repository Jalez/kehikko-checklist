import { readTrackerRef } from 'kehikot-module-protocol'

import type { Entry, StandingHold } from './shapes.ts'
import { everyName, type RefKind, type Target } from './targets.ts'

/**
 * A list held against every issue, or every change, of a project — or of one
 * epic — and how a ref comes to have it in front (Jalez/kehikko-checklist#31).
 *
 * ## The report this answers
 *
 * > "The issue and change checklists are meant for every issue or every merge
 * > request, but a list is only in front of a person on a ref somebody held it
 * > against, one at a time. Clicking any other ref shows an empty Checklist
 * > pane."
 *
 * And the empty pane read as "this issue owes nothing" when it meant "nobody
 * held the list here" — opposite conclusions the pane could not tell apart.
 *
 * ## Held once, ticked per ref
 *
 * A standing hold is one line on the list in `lists.json` (`standing` in
 * `list/shapes.ts`). It is never fanned out into the list's folder: a project
 * with four thousand issues is not four thousand writes, and an issue opened
 * tomorrow is covered without anybody remembering it. What it decides is only
 * whether the list is IN FRONT on a ref; what is ticked there is filed under
 * that ref's own key (`ref:gh#105`), exactly as for a ref held by hand, so
 * `gh#105` and `gh#106` keep two sets of ticks and releasing the standing hold
 * keeps them, as releasing any target does.
 *
 * ## Whether a ref is an issue or a change is the tracker's to say
 *
 * `gh#41` is an issue or a pull request and its spelling does not say which.
 * The host's tracker reading does (`tracker.get`, a row's `kind`), and the page
 * hands what it read to the server beside the refs in front (`RefsRead`). A
 * GitLab spelling says it itself (`!7` is a merge request), which the protocol
 * reads (`readTrackerRef`). Where neither has said, the answer is `unknown`
 * and the pane says so, rather than guessing: a guess either way puts the
 * wrong list in front or hides the right one with nothing to show for it.
 *
 * A list standing against both kinds needs no kind at all: whatever the ref
 * turns out to be, the list is for it.
 *
 * ## One epic's refs
 *
 * A standing hold may name an epic, and is then for the refs THAT epic names.
 * Which refs those are is the host's again (`tracker.get` with `epic`), read
 * by the page for the epics a standing hold names. An epic the page did not
 * read is `unknown` for the same reason a kind is.
 *
 * Pure: the store reads it in `inFront`, the tick reads it to decide whether
 * a tick holds the ref, and `test/standing.test.ts` is a table.
 */

/** What the host's tracker reading said about the refs in front, as the page hands it to the server. */
export interface RefsRead {
  /** The kind of each ref the reading had a row for. */
  kinds: Readonly<Record<string, RefKind>>
  /**
   * For each epic whose refs were read: those of the refs in front that the
   * epic names. An epic that is not a key here was not read, and is unknown.
   */
  epics: Readonly<Record<string, readonly string[]>>
}

/** Nothing read: what the MCP door and an unhosted page have. */
export const NOTHING_READ: RefsRead = { kinds: {}, epics: {} }

/** A ref's kind: the tracker reading's, else its own spelling's where that says (GitLab), else null. */
export function kindOf(ref: string, read: RefsRead): RefKind | null {
  /* Own keys only: a ref is a name somebody spelled, and `constructor` is one. */
  return (Object.hasOwn(read.kinds, ref) ? read.kinds[ref] : undefined) ?? readTrackerRef(ref)?.kind ?? null
}

/** Why a standing hold could not be decided for a ref: its kind, or which epic it belongs to. */
export type Undecided = 'kind' | 'epic'

export type Covered =
  | { answer: 'yes'; through: StandingHold[] }
  | { answer: 'no' }
  | { answer: 'unknown'; why: Undecided }

/** One standing hold against one ref, as if the ref were `kind`. */
function one(hold: StandingHold, kind: RefKind, ref: string, read: RefsRead): 'yes' | 'no' | 'unknown' {
  if (hold.of !== kind) return 'no'
  if (!hold.epic) return 'yes'
  const named = Object.hasOwn(read.epics, hold.epic) ? read.epics[hold.epic] : undefined
  if (!named) return 'unknown'
  return named.includes(ref) ? 'yes' : 'no'
}

function asKind(standing: readonly StandingHold[], kind: RefKind, ref: string, read: RefsRead): Covered {
  const through = standing.filter((hold) => one(hold, kind, ref, read) === 'yes')
  if (through.length) return { answer: 'yes', through }
  return standing.some((hold) => one(hold, kind, ref, read) === 'unknown') ? { answer: 'unknown', why: 'epic' } : { answer: 'no' }
}

/**
 * Whether a list's standing holds put it in front of `ref`, and through which.
 *
 * `unknown` says what is missing: the ref's kind, or whether an epic names it.
 */
export function covers(standing: readonly StandingHold[] | undefined, ref: string, read: RefsRead): Covered {
  if (!standing?.length) return { answer: 'no' }
  const kind = kindOf(ref, read)
  if (kind) return asKind(standing, kind, ref, read)
  const issue = asKind(standing, 'issue', ref, read)
  const change = asKind(standing, 'change', ref, read)
  if (issue.answer === 'yes' && change.answer === 'yes') return { answer: 'yes', through: [...issue.through, ...change.through] }
  if (issue.answer === 'no' && change.answer === 'no') return { answer: 'no' }
  return { answer: 'unknown', why: 'kind' }
}

/** A standing hold as the target it is named by. */
export function standingTarget(hold: StandingHold): Extract<Target, { kind: 'every' }> {
  return { kind: 'every', of: hold.of, epic: hold.epic ?? null }
}

/** Whether a list's standing holds include this one. */
export function standsAt(standing: readonly StandingHold[] | undefined, target: Extract<Target, { kind: 'every' }>): number {
  return (standing ?? []).findIndex((hold) => hold.of === target.of && (hold.epic ?? null) === target.epic)
}

/**
 * Whether an entry is ticks on a ref, held by nobody and released by nobody:
 * what a tick through a standing hold leaves (`apply` in `list/checklists.ts`).
 */
export function tickedUnheld(key: string, entry: Entry): boolean {
  return (
    key.startsWith('ref:') && entry.since === undefined && entry.released === undefined
    && Boolean(entry.ticks && Object.keys(entry.ticks).length)
  )
}

/**
 * Whether a list's entry is in use through its standing holds: ticks on a ref
 * it stands over. Storage counts it as held and Purge never takes it as
 * released; releasing the last standing hold marks it released.
 */
export function throughStanding(list: { standing?: readonly StandingHold[] }, key: string, entry: Entry): boolean {
  return Boolean(list.standing?.length) && tickedUnheld(key, entry)
}

/** A ref the page could not decide a standing hold for, with the lists that would have been in front. */
export interface UndecidedRef {
  ref: string
  why: Undecided
  /** The names of the lists, once each. */
  lists: string[]
}

/**
 * The line for refs a standing hold could not be decided for: said on the
 * pane, because a list that applies and is not drawn has to have a reason.
 */
export function undecidedLine(rows: readonly UndecidedRef[]): string | null {
  if (!rows.length) return null
  const refs = rows.map((row) => row.ref)
  const lists = [...new Set(rows.flatMap((row) => row.lists))].map((name) => `“${name}”`)
  const several = refs.length > 1
  const kind = rows.some((row) => row.why === 'kind')
  const what = kind
    ? `whether ${andList(refs)} ${several ? 'are issues or changes' : 'is an issue or a change'}`
    : `which epic ${andList(refs)} ${several ? 'belong' : 'belongs'} to`
  return (
    `The tracker has not said ${what}, so ${andList(lists)}, held against every issue or every change, `
    + `${lists.length > 1 ? 'are' : 'is'} not shown for ${several ? 'them' : 'it'} until it does.`
  )
}

/**
 * The line for an empty pane with refs in front, which says WHY it is empty.
 *
 * "Nothing is held here" and "no checklist applies here" are different
 * sentences: the first says nobody put a list on this ref — not that it owes
 * nothing — and the second that the lists standing against every issue or
 * every change are for other refs. Null with no refs in front, where the
 * page's own sentences stand.
 */
export function noneLine(
  refs: readonly string[],
  standing: readonly Target[],
): { said: string; why: 'nothing-held' | 'none-applies' } | null {
  if (!refs.length) return null
  const it = refs.length > 1 ? 'them' : 'it'
  const which = andList([...refs])
  if (!standing.length) {
    return {
      why: 'nothing-held',
      said:
        `Nothing is held against ${which}. That says nobody has put a checklist here, not that ${refs.length > 1 ? 'they owe' : 'it owes'} `
        + `nothing: a checklist’s edit page holds one against ${it}, or against every issue or every change.`,
    }
  }
  const names = [...new Set(standing.map((target) => (target.kind === 'every' ? everyName(target.of, target.epic) : '')))].filter(Boolean)
  return {
    why: 'none-applies',
    said: `No checklist applies to ${which}: none is held against ${it}, and the ones held against ${andList(names)} are for other refs.`,
  }
}

function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  const all = [...names]
  const last = all.pop()
  return `${all.join(', ')} and ${last}`
}

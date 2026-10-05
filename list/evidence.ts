import { z } from 'zod'

import type { TrackerRow } from 'kehikot-module-protocol'

/**
 * What the tracker says about a ref, as the one fact an item is checked
 * against — and what a tick remembers of it.
 *
 * ## The sentence this file exists for
 *
 * > "Nothing on the page shows what the tracker says about that target, so
 * > checking 'has tests', 'pipeline green', 'linked issue closed' or
 * > 'description explains the why' means leaving the page and reading the
 * > issue or MR somewhere else." — Jalez/kehikko-checklist#1
 *
 * The host reads the trackers once for every module (`tracker.get` in the
 * protocol), and this page asks it for the refs its lists are held against.
 * This file is the small, pure half of that: which facts an item may name as
 * its evidence, how a fact is spelled out of a row, and when a tick made on
 * one fact has gone stale.
 *
 * ## A fact informs a tick and never makes one
 *
 * Nothing here ticks anything. A tick is still a person's or an agent's own
 * verdict, made by a press or a `check_item`; a green pipeline is a reason to
 * press, not a press. What a fact adds is a record: a tick made on the page
 * while the item's fact was in front of the reader carries what the fact said
 * at that moment, and the page can then say when the ref has moved on since.
 * A stale tick is still a tick. Taking it back is the reader's call, made with
 * the same one press as always.
 *
 * ## Absent is not "no"
 *
 * The protocol leaves out a field the tracker does not record — GitHub issues
 * have no pipeline, GitLab has no close reason. `factOf` answers null for those
 * rather than inventing a "none", so the row can say "the tracker does not
 * record this" instead of a pipeline that never ran reading as a failed one.
 */

/**
 * The facts an item may name, in the order the edit page offers them.
 *
 * Kept to what `tracker.get` with `detail: 'detail'` actually carries. A word
 * here with nothing behind it would be a menu entry that always reads "not
 * recorded".
 */
export const FACTS = ['state', 'draft', 'pipeline', 'review', 'approvals', 'labels', 'files', 'description', 'links'] as const
export type Fact = (typeof FACTS)[number]

/** What each fact is called, in a menu and in front of its value. */
export const FACT_NAMES: Record<Fact, string> = {
  state: 'state',
  draft: 'draft',
  pipeline: 'pipeline',
  review: 'review',
  approvals: 'approved by',
  labels: 'labels',
  files: 'files',
  description: 'description',
  links: 'links',
}

/** A fact is a fact about the change at one commit, so a new commit makes a tick on it stale. */
const AT_A_COMMIT: ReadonlySet<Fact> = new Set(['pipeline', 'review', 'approvals', 'files'])

/** How long the words a tick keeps may be. A line, not the description itself. */
export const MAX_SAID = 200
const MAX_PRINT = 64

/**
 * What a tick remembers of the fact it was made on.
 *
 * `said` is the sentence drawn under the tick — "pipeline: success at
 * 4f6d7bb". `print` is what the fact is compared by, which is `said` for
 * every fact but the description, where it is a hash of the body: a
 * description is too long to keep in every tick and too long to draw, and
 * "has it changed" is the only question asked of it. `sha` is the commit the
 * change was at, when the tracker said, and `read` is when the host read the
 * row the tick was made from.
 */
export const evidenceSchema = z.object({
  fact: z.enum(FACTS),
  said: z.string().max(MAX_SAID),
  print: z.string().max(MAX_PRINT),
  sha: z.string().max(MAX_PRINT).nullable().default(null),
  read: z.string().max(MAX_PRINT),
})
export type Evidence = z.infer<typeof evidenceSchema>

/** A fact as the row says it now: the words, what it is compared by, and the commit. */
export interface Reading {
  said: string
  print: string
  sha: string | null
}

/** A commit as a person reads one. */
export function short(sha: string): string {
  return sha.slice(0, 7)
}

/**
 * One fact out of one row, or null when the tracker does not record it.
 *
 * Several facts are only in the row's `detail`, which the page asks for. A
 * row read without it — a host that answered `summary` anyway — answers null
 * for those, the same as a tracker that does not keep them.
 */
export function factOf(row: TrackerRow, fact: Fact): Reading | null {
  const sha = row.detail?.headSha ?? null
  const at = (words: string): Reading => {
    const said = (sha && AT_A_COMMIT.has(fact) ? `${words} at ${short(sha)}` : words).slice(0, MAX_SAID)
    return { said, print: said.slice(0, MAX_PRINT), sha }
  }
  const name = FACT_NAMES[fact]
  switch (fact) {
    case 'state':
      return at(`${name}: ${row.state}${row.stateReason ? ` (${row.stateReason.toLowerCase().replace(/_/g, ' ')})` : ''}`)
    case 'draft':
      return row.draft === undefined ? null : at(`${name}: ${row.draft ? 'yes' : 'no'}`)
    case 'pipeline':
      return row.pipeline === undefined ? null : at(`${name}: ${row.pipeline}`)
    case 'review':
      return row.review === undefined ? null : at(`${name}: ${row.review.replace(/-/g, ' ')}`)
    case 'approvals': {
      const by = row.detail?.approvedBy
      if (by === undefined) return null
      return at(`${name}: ${by.length ? by.join(', ') : 'nobody'}`)
    }
    case 'labels':
      return at(`${name}: ${row.labels.length ? row.labels.join(', ') : 'none'}`)
    case 'files': {
      if (!row.detail || row.kind !== 'change') return null
      const count = row.detail.files.length
      return at(`${name}: ${count}${row.detail.filesClipped ? '+' : ''} changed`)
    }
    case 'description': {
      if (!row.detail) return null
      const body = row.detail.body.trim()
      const said = `${name}: ${body ? `${body.length}${row.detail.bodyClipped ? '+' : ''} characters` : 'empty'}`
      return { said, print: `body:${fingerprint(body)}`, sha }
    }
    case 'links': {
      if (!row.links.length) return at(`${name}: none`)
      const closes = row.links.filter((l) => l.relation === 'closes').map((l) => l.ref)
      const closedBy = row.links.filter((l) => l.relation === 'closed-by').map((l) => l.ref)
      const parts = [
        ...(closes.length ? [`closes ${closes.join(', ')}`] : []),
        ...(closedBy.length ? [`closed by ${closedBy.join(', ')}`] : []),
      ]
      return at(`${name}: ${parts.join('; ')}`)
    }
  }
}

/** What a tick made now, on this row, would remember — or null when the fact is not recorded. */
export function evidenceOf(row: TrackerRow, fact: Fact): Evidence | null {
  const now = factOf(row, fact)
  if (!now) return null
  return { fact, said: now.said, print: now.print, sha: now.sha, read: row.detail?.readAt ?? row.readAt }
}

/**
 * Why a tick made on `kept` is stale against the row as it is now, or null.
 *
 * Two ways for the ref to have moved on. The change got new commits — for a
 * fact about one commit (pipeline, review, approvals, files) that is enough,
 * whatever the fact says now, because a green pipeline on the old head says
 * nothing about the new one. Or the fact itself reads differently. A fact the
 * row no longer carries says nothing either way, and is not called stale: a
 * host that read a summary this time has not seen the ref change.
 */
export function staleness(kept: Evidence, row: TrackerRow): string | null {
  const now = factOf(row, kept.fact)
  if (!now) return null
  if (AT_A_COMMIT.has(kept.fact) && kept.sha && now.sha && kept.sha !== now.sha) {
    return `new commits since it was ticked (${short(kept.sha)} → ${short(now.sha)}); now ${now.said}`
  }
  if (now.print !== kept.print) {
    return kept.fact === 'description' ? 'the description has changed since it was ticked' : `now ${now.said}`
  }
  return null
}

/** A short, stable hash of a string, for "has this changed" and nothing else. FNV-1a, 32 bits. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

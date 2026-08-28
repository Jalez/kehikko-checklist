import { REVIEW_LABEL, STATUS_PREFIX, type ChecklistHost, type ItemState } from '../list/shipped.ts'
import { sizeBig, sizeFine } from '../list/store.ts'
import type { RefState } from './ref-state.ts'

/**
 * What a tracker already answers, worked out here — with no tracker, no
 * credentials and no network call.
 *
 * This is the part of the extraction that made the whole thing possible, and it
 * is worth saying why it was never in doubt. `derive` is a pure function of one
 * `RefState`: hand it what a refresh read and it answers the four verdicts, and
 * it does not care who read it or when. So the app needs no tracker access to
 * compute every derived item on the list — it needs somebody to hand it a
 * `RefState`, which a framing roadmap does over `live.get` and an agent does
 * over this app's own MCP door. Asking for tracker credentials would have been
 * asking for something that answers a question already answered.
 *
 * Copied whole from the roadmap's `checklist.ts`, comments and all: every arm
 * below records a real mistake this project has already made once, and the
 * comment is the part that stops it being made again.
 */

/** GitLab caps the count and says "1000+", so read the number off the front. */
export function filesChanged(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * The sentence a derived item adds when the mark alone is not the answer.
 *
 * A `[!]` beside "Closes exactly one issue" says something is wrong and not
 * which thing, and the two ways to fail it have opposite remedies: name an
 * issue, or split the change. The remedy is the useful half, so it is said
 * here rather than left for the reader to infer from a bracket.
 */
export function deriveDetail(id: string, s: RefState): string | null {
  if (id !== 'names-issue' || s.declares === undefined) return null
  const named = [...s.declares, ...(s.partOf ?? [])]
  const n = named.length
  if (n === 1) return null
  if (n === 0) {
    // Three different sentences because they are three different answers, and
    // only one of them is a fault. A stacked change reads empty because the
    // tracker never looked, so telling its author to go and name an issue
    // sends them to fix something that is not broken.
    if (s.baseRef?.isDefault === false) {
      return `nothing was checked: this targets ${s.baseRef.name}, not the default branch, and the tracker only records closures for a change aimed at the default branch — so this cannot be read until it is retargeted. Stacking on another change is the recommended thing to do, not a fault; name the issue as usual and this answers once the base moves`
    }
    if (s.baseRef && s.baseRef.isDefault === undefined) {
      return `nothing was checked: the repository's default branch could not be read, so whether this targets it (${s.baseRef.name}) is unknown — and the tracker only records closures for a change aimed at the default branch. An empty list here may mean stacked rather than unnamed, so it is not read as either`
    }
    return 'it names no issue at all — neither closing one nor saying what it is part of, so it merges with nothing anywhere connecting it to the work. Either answers: "Closes #N", or an opening line "Refs #N — one of four". On GitHub the closing keyword is "Closes #N"; "gh#N" is this roadmap\'s own spelling and closes nothing'
  }
  const how = s.declares.length
    ? `closes ${s.declares.map((i) => `#${i}`).join(', ')}`
    : `is part of ${(s.partOf ?? []).map((i) => `#${i}`).join(', ')}`
  return `it ${how}${s.declares.length && s.partOf?.length ? ` and is part of ${s.partOf.map((i) => `#${i}`).join(', ')}` : ''} — ${n} issues in all, fine if they are one self-contained item, so check self-contained and size rather than taking this as the answer`
}

/**
 * What the tracker says about the derived items. `unknown` is deliberate: a
 * merge request read before its pipeline started has no answer yet, and
 * guessing "pending" would read as a failure that is not there. The same rule
 * decides the GitHub answers below — a checklist that green-ticks what it did
 * not check is worse than one that admits it did not check.
 *
 * `host` defaults to GitLab so every caller that has not been told keeps the
 * answers the roadmap's own builder gave.
 */
export function derive(id: string, s: RefState, host: ChecklistHost = 'gitlab'): ItemState {
  const labels = s.labels ?? []
  switch (id) {
    /* The issues the change itself declares it closes.

       Zero is a FAILURE, not a blank. A change that names no issue merges and
       leaves every one of them open with nothing anywhere saying so — which is
       how gh#17 landed fourteen fixes and closed none of them: its commits
       said `Closes gh#1`, this roadmap's own ref spelling, which GitHub has
       never heard of. Reading zero as "not filled in yet" green-ticks exactly
       that, so it does not — except where zero is not an answer at all, which
       is what `baseRef` below is for.

       More than one is NOT failed. The unit is one self-contained item small
       enough to read in one sitting, and one item can genuinely close two
       issues; whether it is one item is what `self-contained` and `size`
       already decide, and gh#17's 44 files failed `size` at the time. Saying
       it twice here would put a second opinion on a question that already has
       an owner. `pending` instead: worth a look, not a verdict. */
    case 'names-issue': {
      if (s.declares === undefined) return 'unknown'
      /* A slice that says what it is part of has answered this, and it is the
         answer the protocol asks for: once a whole solution is agreed and
         split, most slices correctly close nothing. Read alongside closures
         rather than instead of them, because a change may honestly do either —
         and `partOf` is DELIBERATELY not folded into `declares` upstream, so
         that delivery still counts closures alone. */
      const named = [...s.declares, ...(s.partOf ?? [])]
      if (named.length > 0) return named.length === 1 ? 'done' : 'pending'
      // Empty is only a failure where empty was actually checked. GitHub
      // records closing-issue links only for a pull request based on the
      // default branch, so a stacked one answers empty however correctly it
      // names its issue — and stacking is the thing the item's own text tells
      // agents to prefer. Reading that as "closes nothing" would print "no"
      // where the truth is "cannot tell", and punish the recommendation.
      //
      // Absent `baseRef` still fails: that is GitLab, which reads the issues
      // out of the description whatever the target branch, so empty there is
      // genuinely empty — and GitLab's own reading already counts "part of",
      // so a correctly-declared slice there is not caught by this either.
      if (s.baseRef && s.baseRef.isDefault !== true) return 'unknown'
      return 'failed'
    }
    case 'size': {
      const files = filesChanged(s.changesCount)
      if (files === null) return 'unknown'
      // The thresholds are read here rather than closed over, so a number
      // changed in the settings dialog governs the next merge request read
      // rather than the next process started.
      if (files <= sizeFine()) return 'done'
      return files <= sizeBig() ? 'pending' : 'failed'
    }
    case 'pipeline':
      // The GitHub tracker folds the check rollup into these same four words,
      // so the reading is shared; only what a green one *promises* differs,
      // and that is in the wording rather than here.
      if (!s.pipeline) return 'unknown'
      if (s.pipeline === 'success') return 'done'
      if (s.pipeline === 'failed' || s.pipeline === 'canceled') return 'failed'
      return 'pending'
    case 'conflicts':
      return s.conflicts === undefined ? 'unknown' : s.conflicts ? 'failed' : 'done'
    case 'discussions':
      return s.discussionsResolved === undefined ? 'unknown' : s.discussionsResolved ? 'done' : 'pending'
    case 'ready':
      // GitLab derives draft from the title, so a merge request that has no
      // "Draft:" on it genuinely is not one and absence means false. GitHub
      // reports isDraft as its own field, which is absent when it was not
      // read — so on that side absence is "not read", and reading it as "out
      // of draft" would tick an item nothing answered.
      if (host === 'github' && s.draft === undefined) return 'unknown'
      return s.draft ? 'pending' : 'done'
    case 'handed-over':
      // Approval clears the mark, so an approved merge request has handed over
      // even though the label has gone.
      if (labels.includes(REVIEW_LABEL) || s.approved) return 'done'
      if (host === 'github') {
        // A requested reviewer is GitHub's own handover: it is the thing that
        // puts the pull request in a person's queue and mails them about it.
        if ((s.reviewers ?? []).length > 0) return 'done'
        // Otherwise it turns on whether this repo marks work with the scoped
        // labels at all. Another status:: label on the pull request says the
        // vocabulary is in use and this one is genuinely missing; no status::
        // label anywhere says we cannot tell the two apart, and guessing
        // "pending" would accuse a repo of skipping a habit it never had.
        return labels.some((l) => l.startsWith(STATUS_PREFIX)) ? 'pending' : 'unknown'
      }
      return 'pending'
    case 'mark-cleared':
      if (!s.approved) return 'unknown' // nothing to clear until someone approves
      // True on both hosts whatever the repo's habits: what this asks is that
      // no review mark is left sitting in everyone else's queue, and a pull
      // request carrying none satisfies that however it got there.
      return labels.includes(REVIEW_LABEL) ? 'pending' : 'done'
    default:
      return 'unknown'
  }
}

/**
 * Agent items that are statements about the code rather than about the work.
 * A tick on one of these is only ever as current as the head it was made
 * against; the rest stay true however the branch moves.
 */
export const HEAD_PINNED: readonly string[] = ['reviewed']

export type TickState = 'done' | 'stale' | 'todo'

/**
 * Whether an agent's tick still stands.
 *
 * `stale` is a third answer rather than an untick, because the round did
 * happen: what the next reader needs is to look at the new head, not to run
 * the whole thing again. A tick with no head recorded reads as done — it
 * predates heads being stored, and inventing a failure there would cry wolf
 * on every merge request opened before this.
 */
export function tickState(
  id: string,
  tick: { sha?: string | null } | undefined,
  head: string | undefined,
): TickState {
  if (!tick) return 'todo'
  if (!HEAD_PINNED.includes(id) || !tick.sha || !head) return 'done'
  return tick.sha === head ? 'done' : 'stale'
}

/** Short enough to read, long enough to tell two heads apart. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 9) : ''
}

/**
 * What the last refresh read about one reference, as the roadmap hands it over.
 *
 * Copied from the roadmap's `src/schema.ts` rather than imported, and that is
 * the point of copying it: this app is a separate program, and a type reaching
 * into somebody else's repository would not survive the directory being moved.
 * What it really is, is the shape of the `live.get` answer — a wire format, and
 * a wire format is exactly the kind of thing two programs each hold their own
 * copy of.
 *
 * Every field is optional in practice: absent means UNKNOWN and never "no",
 * which is the rule `derive` beside this is built on. A reference read before
 * its pipeline started has no answer yet, and a checklist that green-ticks what
 * it did not check is worse than one that admits it did not look.
 */
export interface RefState {
  state: 'opened' | 'closed' | 'merged'
  title: string
  /** When it reached that state, or when it last moved. */
  at: string
  draft?: boolean
  url: string
  /** Label names exactly as the tracker spells them. */
  labels?: string[]
  /**
   * Who the tracker says is on it. An issue carries assignees; a merge request
   * carries an author and reviewers too. Read, never written here: an issue
   * with nobody against it is a fact about the tracker worth seeing, not a gap
   * to be filled in on a page.
   */
  assignees?: string[]
  author?: string
  reviewers?: string[]
  /**
   * Merge requests only: the issues this merge request says it is for, read
   * from its own description ("Closes #2231", "Part of #2274"). Absent on a
   * state carried over from a snapshot taken before this was recorded, which
   * is why an absent value means "unknown" rather than "none".
   */
  declares?: number[]
  /**
   * Merge requests only: the issues this change declares itself PART of
   * without closing them — "Refs #1698, one of four".
   *
   * Kept apart from `declares` rather than folded into it, and the reason is
   * `released.ts`: delivery is measured from closures alone, because a change
   * that declares itself one slice of four is not a promise to finish
   * anything, and counting it would let a quarter of the work reaching prod
   * report the whole issue released. What the two share is only the question
   * "does this change say which issue it is for", which is what the checklist
   * asks — so the checklist reads both and nothing else does.
   *
   * Absent means unknown, as with `declares`: a state carried over from a
   * snapshot taken before this was recorded has no answer, not an empty one.
   */
  partOf?: number[]
  /**
   * Merge requests only: the branch this change targets, and whether that is
   * the repository's default branch.
   *
   * It is here because on GitHub `declares` cannot be read without it: GitHub
   * only records closing-issue links for a pull request aimed at the default
   * branch, so a stacked one reports none however correctly it names its
   * issue. `isDefault` absent means the default branch could not be read,
   * which is not the same answer as "not the default" and must not be
   * collapsed into it. Absent entirely on GitLab, which reads the issues out
   * of the description whatever the target branch and so needs no such check.
   */
  baseRef?: { name: string; isDefault?: boolean }
  /** Merge requests only: what the checklist can work out without being told. */
  pipeline?: string
  conflicts?: boolean
  discussionsResolved?: boolean
  approved?: boolean
  /**
   * Merge requests only: the current head. What a review was a statement
   * about, so a tick made against an older one can be told apart from one
   * that still describes the branch.
   */
  sha?: string
  /** Files touched, as GitLab reports it — capped, so it may read "1000+". */
  changesCount?: string
  /**
   * Merge requests only: who spoke last on it, and what they said. The point
   * is whose turn it is. `at` moves for a rebase or a label change and names
   * nobody, so it cannot answer "has a reviewer come back to me yet".
   *
   * `by` is the handle, not the display name: it is what identity gets
   * compared on, and a display name is free to change or to collide.
   */
  lastNote?: { by: string; at: string; system: boolean; excerpt: string }
}

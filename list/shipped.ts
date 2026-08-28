/**
 * The lists as this app ships them — the material, before anybody has edited it.
 *
 * Taken wholesale out of the roadmap's `src/modules/checklist/checklist.ts`,
 * text and reasoning unchanged, because the words are the product here: every
 * `why` below was argued over on a real merge request, and an extraction that
 * paraphrased them would have thrown away the only part of a checklist that
 * makes an agent read it twice. What was left behind is the roadmap's store and
 * the roadmap's tracker; what came across is what a change is held to.
 *
 * Nothing in this file reads a store. `list/store.ts` is the layer that lets
 * somebody change any of it, and it is deliberately downstream: this is the
 * way back, so it must not be able to move.
 */

export type ItemKind = 'derived' | 'agent' | 'human'
export type ItemState = 'done' | 'pending' | 'failed' | 'unknown'

export interface ChecklistItem {
  id: string
  label: string
  kind: ItemKind
  /** Why it is on the list, shown on hover. */
  why: string
}

/**
 * Which tracker the change lives on.
 *
 * The expectations are the same wherever the work happens; two things about
 * them are not. The words differ — "merge request" is not a thing on GitHub —
 * and so does what a tracker can actually answer: a GitLab merge-request
 * pipeline has the Sonar gate wired into it, a GitHub check rollup has
 * whatever that repo's workflows run. Kept as one parameter over one list
 * rather than as two lists, so an item can never quietly exist on one side and
 * be forgotten on the other.
 */
export type ChecklistHost = 'gitlab' | 'github'

/**
 * What is expected on an *issue* before anything is opened against it.
 *
 * Almost all of it is judgement, so almost all of it is the agent's to assert:
 * no tracker can tell you whether somebody understood the problem. The last
 * item is the exception and is the owner's, for the reason `ItemKind` gives.
 */
export const ISSUE_CHECKLIST: ChecklistItem[] = [
  {
    id: 'read',
    label: 'Read the issue, and what it points at',
    kind: 'agent',
    why: 'Including the epic it belongs to. Four reviewers once missed three epic-level points by reading only the diff.',
  },
  {
    id: 'duplicate',
    label: 'Checked nobody is already on it',
    kind: 'agent',
    why: 'Search open merge requests for the number before starting. Parallel sessions have shipped the same issue twice and thrown one away.',
  },
  {
    id: 'claimed',
    label: 'Claimed the step, so nobody else starts it',
    kind: 'agent',
    why: 'claim_step marks it in progress on this page. A second agent is then refused rather than duplicating the work.',
  },
  {
    id: 'scoped',
    label: 'Scope agreed, and it fits one merge request',
    kind: 'agent',
    why: 'If it does not fit, split it and say so before writing code, rather than opening something too large to review.',
  },
  {
    id: 'reported',
    label: 'Said what you found, if it changed the plan',
    kind: 'agent',
    why: 'notify with level attention when a person has to decide before you can go on. Silence reads as progress.',
  },
  {
    id: 'agreed',
    label: 'The owner has seen the finished version and agrees it solves this',
    kind: 'human',
    why: 'Solve the whole issue first and show the finished thing — then ask, and wait. Splitting comes after this, never before: a reviewer who meets the work as four separate changes is asked the same question about the shape of the solution four times, and can only answer it properly on the last one, by which point three are already open. Ask once, about the whole, while it is still cheap to say no. This is the owner’s tick and nothing else can make it: an agent that could assert its own go-ahead has a formality, not a gate.',
  },
]

export const CHECKLIST: ChecklistItem[] = [
  {
    id: 'solved',
    label: 'The issue is actually solved',
    kind: 'agent',
    why: 'The change does what the issue asked, not the part of it that was easy.',
  },
  {
    id: 'names-issue',
    label: 'Says which issue it is for',
    kind: 'derived',
    why: 'Read off the change, not asserted. It does NOT have to close one: once the whole solution has been agreed and split, most slices correctly close nothing, and demanding a closure from each would mean four changes racing to shut one issue. Either declaration answers this — "Closes #N", or an opening line saying what it is part of, "Refs #N — one of four". What is not allowed is silence: a change naming no issue at all merges with nothing anywhere connecting it to the work, and this roadmap finds merged changes ONLY through those declarations. On GitHub the closing keyword is "Closes #N", never "gh#N", which is this roadmap’s own spelling and closes nothing. One exception, and it is not a fault: GitHub records closures only for a change based on the default branch, so a stacked one reads empty on that half — its part-of line still answers, which is exactly the case that needs it.',
  },
  {
    id: 'self-contained',
    label: 'One reason to review it',
    kind: 'agent',
    why: 'A reviewer should be able to say what this merge request is for in a sentence. A refactor riding along with a feature hides the feature, and a rename buried in a fix makes both harder to judge — split them.',
  },
  {
    id: 'no-overlap',
    label: 'Does not overlap another open change',
    kind: 'agent',
    why: 'Check the other open changes on this work before you ask for review. Two that touch the same file cannot both be judged: whichever lands second is no longer the diff that was read, and the reviewer has to hold both in their head to see what either does. Slices of one agreed solution are especially prone to it, because they came out of one branch — so this is asserted per change, against the others open at the time.',
  },
  {
    id: 'test',
    label: 'A test that fails without the change',
    kind: 'agent',
    why: 'Undo the change: if the test still passes it proves nothing and reads as coverage, which is worse than none.',
  },
  {
    id: 'changeset',
    label: 'Changeset added, or the type is exempt',
    kind: 'agent',
    why: 'A user-visible change with no .changeset/*.md merges with no version bump and never reaches the changelog. refactor, chore, docs, test and ci are exempt.',
  },
  {
    id: 'aligned',
    label: 'Fits the epic, not just the issue',
    kind: 'agent',
    why: 'Read the epic step this sits on and say it still holds. A change can close its issue exactly and still contradict the journey around it, or quietly settle a decision the epic was still holding open. Four reviewers once missed three epic-level points by reading only the diff.',
  },
  {
    id: 'reviewed',
    label: 'Independently approved at the current head',
    kind: 'agent',
    why: 'One round of fresh-context reviewers, and their findings fixed. Fixing what they found moves the head, so the tick is pinned to the head it was made against and goes stale when the head moves — a review of the code before the fix is not a review of the fix. Re-tick once the last head has been looked at.',
  },
  {
    id: 'proof',
    label: 'Before and after shown, if a user sees a difference',
    kind: 'agent',
    why: 'Same framing, from the running app — Playwright is usually the quickest way to capture both. A UI change without it makes a reviewer boot the branch to see what you did.',
  },
  {
    id: 'size',
    label: 'Small enough to read in one sitting',
    kind: 'derived',
    why: 'Counted from the files the merge request touches. Attention falls off long before a big diff ends, so a large one is not reviewed more slowly, it is reviewed less well — and it waits longer to be started at all.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline green, Sonar included',
    kind: 'derived',
    why: 'On a merge request pipeline the Sonar gate is a hard blocker, so a green pipeline means Sonar is pleased too.',
  },
  {
    id: 'conflicts',
    label: 'No conflicts with the target',
    kind: 'derived',
    why: 'A conflicted merge request cannot be reviewed honestly, because the diff is not what would land.',
  },
  {
    id: 'discussions',
    label: 'Threads resolved',
    kind: 'derived',
    why: 'An unresolved thread is someone still waiting on an answer.',
  },
  {
    id: 'ready',
    label: 'Out of draft',
    kind: 'derived',
    why: 'Draft says "not for you yet", so it must come off before review is asked for.',
  },
  {
    id: 'handed-over',
    label: 'Marked status::requires-review',
    kind: 'derived',
    why: 'The mark is how a human knows it is their turn. Set it once it is ready and out of draft.',
  },
  {
    id: 'mark-cleared',
    label: 'Mark removed once review approves',
    kind: 'derived',
    why: 'Leaving it on after approval keeps the merge request in everyone else\'s review queue.',
  },
]

/** The merge-request half, kept under its old name for every existing caller. */
export const MR_CHECKLIST = CHECKLIST

export const REVIEW_LABEL = 'status::requires-review'

/** The scoped-label family the review mark belongs to, in both trackers. */
export const STATUS_PREFIX = 'status::'

/**
 * Items that cannot apply on a host at all, and why.
 *
 * Said out loud rather than left sitting at pending forever. An item nobody
 * can ever tick reads as a standing accusation, and by the second pull request
 * an agent has learned to skim past the whole list; "not here, and here is
 * why" costs one line and keeps the other twelve believed.
 */
export const EXEMPT: Record<ChecklistHost, Record<string, string>> = {
  gitlab: {},
  github: {
    changeset:
      'No .changeset in the GitHub repos here — they deploy from a branch rather than publishing a version, so there is no changelog for a changeset to reach. Nothing to add, and nothing to tick.',
  },
}

/**
 * The same item said in the host's own words. Wording only: where the logic
 * differs the difference lives in `derive`, so nothing can read right here and
 * answer wrong there.
 */
export const GITHUB_WORDING: Record<string, { label: string; why: string }> = {
  pipeline: {
    // "Sonar included" is a GitLab fact, and on GitHub it is a promise the
    // label cannot keep: there is no Sonar gate in these repos, so a green
    // rollup says nothing about one.
    label: 'Checks green',
    why: 'Every check GitHub rolls up on the pull request, folded into one verdict: one failure fails it, anything still running holds it pending. It covers whatever that repo\'s workflows run and nothing more — there is no Sonar gate behind it here.',
  },
  'handed-over': {
    // The status:: vocabulary does exist in the product repo, so the mark
    // still counts where it is used — but GitHub's own handover is the review
    // request, which is the thing that actually notifies a person.
    label: 'Handed to a person: review requested, or marked status::requires-review',
    why: 'A person only knows it is their turn if something tells them. Requesting a review is what GitHub notifies on; status::requires-review does the same job in a repo that uses the scoped labels.',
  },
}
/**
 * Where a diff stops being read properly, in files touched.
 *
 * Calibrated on this project rather than a rule of thumb. !623 changed 47
 * files, sat a month without review, and only moved once it was split into
 * three of 12, 21 and 14 — each of which was reviewed within a day. So the
 * sizes that worked sit under the first threshold and the size that failed
 * sits above the second.
 */
export const SIZE_FINE = 25
export const SIZE_BIG = 40

import type { ChecklistHost } from '../list/shipped.ts'

/**
 * A reference to something in a tracker, written the way people say it out
 * loud: "#2274" is a GitLab issue, "!1800" a merge request, "gh#41" a GitHub
 * issue or pull request in the default repo, "gh:owner/repo#41" one anywhere
 * else. Anything matching none of those is a gate outside every tracker, which
 * nothing here can answer for.
 *
 * Copied from the roadmap's `schema.ts` for the reason `ref-state.ts` gives:
 * this spelling is a wire format between two programs, and a wire format is the
 * kind of thing each end holds its own copy of. `local#…` is left out — it
 * names something that has not reached a tracker at all, so no checklist here
 * has anything to say about it, and matching it would only let one be typed
 * into the box and answered with a list it can never satisfy.
 */
const REF = /^(?:gh(?::([\w.-]+\/[\w.-]+))?#(\d+)|#(\d+)|!(\d+))$/

export type RefKind = 'issue' | 'mr' | 'gh' | 'manual'

export interface ParsedRef {
  kind: RefKind
  number?: number
  repo?: string
  raw: string
}

export function parseRef(raw: string): ParsedRef {
  const m = REF.exec(raw.trim())
  if (!m) return { kind: 'manual', raw: raw.trim() }
  if (m[4]) return { kind: 'mr', number: Number(m[4]), raw: raw.trim() }
  if (m[3]) return { kind: 'issue', number: Number(m[3]), raw: raw.trim() }
  return { kind: 'gh', number: Number(m[2]), repo: m[1], raw: raw.trim() }
}

/**
 * Which tracker's words a reference is read in.
 *
 * Off the spelling and nothing else, exactly as the roadmap's builder does it:
 * "merge request" is not a thing on GitHub, and the wording has to be settled
 * before anything is drawn — including on a reference nothing has ever been
 * read about, which is the ordinary case for this app standing alone.
 */
export function hostOf(raw: string): ChecklistHost {
  return parseRef(raw).kind === 'gh' ? 'github' : 'gitlab'
}

/**
 * Whether a reference names a CHANGE rather than a piece of work, and how
 * confident that answer is.
 *
 * `!1800` says so in its own spelling. GitHub numbers issues and pull requests
 * in one sequence, so `gh#1894` cannot — only a read can, and this app does not
 * read trackers. So a GitHub reference is a change when the last state anyone
 * handed us says it is one (a pull request carries a pipeline, a base branch, a
 * merge state), and otherwise it is UNSETTLED rather than an issue.
 *
 * That third answer is why this returns a word instead of a boolean. An issue
 * and a change owe different lists, and quietly guessing "issue" for every
 * GitHub number nobody has told us about would put the issue list under a pull
 * request and read as if that were the answer. The page asks which list to show
 * where it cannot tell; it does not pick one and keep quiet.
 */
export type Shape = 'change' | 'work' | 'unsettled'

export function shapeOf(raw: string, state: { pipeline?: string; baseRef?: unknown; sha?: string } | null): Shape {
  const p = parseRef(raw)
  if (p.kind === 'mr') return 'change'
  if (p.kind === 'issue') return 'work'
  if (p.kind === 'manual') return 'work'
  if (!state) return 'unsettled'
  /* Three tells, any of which only a pull request has. A pull request read
     before its first check ran has no pipeline, so one field would not do. */
  return state.pipeline !== undefined || state.baseRef !== undefined || state.sha !== undefined
    ? 'change'
    : 'unsettled'
}

/** The word for what a reference is, in the tracker's own vocabulary. */
export function nounFor(raw: string, shape: Shape): string {
  const host = hostOf(raw)
  if (shape === 'work') return 'issue'
  if (shape === 'change') return host === 'github' ? 'pull request' : 'merge request'
  return host === 'github' ? 'issue or pull request' : 'reference'
}

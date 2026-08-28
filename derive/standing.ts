import { type ChecklistHost, type ChecklistItem } from '../list/shipped.ts'
import { effectiveList, exemptFor, itemFor, orphanTicks, type ChecklistName } from '../list/store.ts'
import { ago, seen, ticks, type Tick } from '../list/ticks.ts'
import { derive, deriveDetail, shortSha, tickState } from './derive.ts'
import { hostOf, nounFor, shapeOf, type Shape } from './refs.ts'

/**
 * Where one reference stands: the list it owes, and how far along it is.
 *
 * One function, and everything reads it — the page, the two MCP tools, and any
 * later door somebody adds. That is not tidiness. The built-in had this
 * computed twice, once in `page.ts` for the drawer and once in `mcp.ts` for the
 * tool, and the two agreed only because somebody kept them agreeing; the whole
 * argument for the checklist is that there is ONE answer to "what is this held
 * to", so two computations of it is the defect the feature exists to prevent.
 *
 * ## The state that is new here, and why it had to be
 *
 * The built-in had four verdicts for a derived item — done, failed, pending,
 * unknown — where `unknown` meant "the tracker was read and had nothing to say
 * about this". Standing alone, this app meets a fifth thing constantly: nobody
 * has ever shown it a tracker state at all. That is not `unknown`. `unknown` is
 * an answer arrived at by looking; `unasked` is not having looked, and the
 * remedy is completely different — one is a repository with no checks
 * configured, the other is an app nothing has framed yet.
 *
 * Flattening the two would have been the single most dishonest thing in this
 * extraction: every derived item on every reference would have read "the
 * tracker has nothing to say", which is a statement about a tracker, made by a
 * program that has never spoken to one.
 */
export type RowState = 'done' | 'failed' | 'pending' | 'unknown' | 'unasked' | 'stale' | 'todo'

export interface StandingRow {
  id: string
  label: string
  why: string
  kind: ChecklistItem['kind']
  state: RowState
  /** Who says so, or who WOULD: an agent's name, "you", "the tracker". */
  by: string
  at: string | null
  note: string | null
  /** The remedy sentence a derived item adds when the mark alone is not the answer. */
  detail: string | null
  /** Which tracker a derived answer was read from. Derived rows only. */
  read: ChecklistHost | null
  /** Present on a row that does not apply here: the reason somebody wrote. */
  exempt: string | null
  /** A tick against an item that is no longer on the list — kept, and said out loud. */
  orphan: boolean
  /** Which of the two lists this row came off, so a reader shown both can tell. */
  list: ChecklistName
}

export interface Standing {
  ref: string
  host: ChecklistHost
  shape: Shape
  /** `merge request`, `pull request`, `issue` — the tracker's own word. */
  noun: string
  rows: StandingRow[]
  /** The last tracker state anybody handed this app for this reference. */
  seen: { at: string; ago: string; from: string; sha: string | null } | null
  /**
   * What this app cannot see from where it is standing, in one sentence, or
   * null when it can see everything the list needs.
   *
   * Composed here rather than in the page, for the reason the roadmap's own
   * `appliesSaid` gives: the page draws it once and the browser redraws it
   * after every press, so two copies of the rule would be two answers to "can
   * this app see the tracker", differing by whether a server had answered yet.
   */
  cannotSee: string | null
  done: number
  total: number
}

/**
 * The sentence an app with no tracker says about itself.
 *
 * It names the way out — frame it in a roadmap — because a limitation with no
 * next action is one a reader learns to skim past, which is the same failure an
 * unexplained exemption has. And it says outright that there is no other way,
 * so nobody goes looking for a setting that would give this app a tracker.
 */
export const NEVER_SEEN =
  'Nothing has ever shown this app what a tracker says about this reference, so the items read from one are marked “not asked” rather than guessed at. Opening this page inside a roadmap changes it: the roadmap hands over what its own last refresh read, and every one of those items is then computed here. There is no other way for this app to know — it holds no credentials and never speaks to a tracker itself.'

/**
 * Where one reference stands.
 *
 * `assume` is for a caller that knows something the reference cannot say. It
 * exists for one reader: `mr_checklist`, whose whole name is a claim that the
 * thing it was handed is a change. Everybody else passes nothing and is told
 * the truth, including that the truth is sometimes "nobody has said".
 */
export function standingFor(ref: string, assume?: Shape): Standing {
  const host = hostOf(ref)
  const memory = seen(ref)
  const state = memory?.state ?? null
  const shape = assume ?? shapeOf(ref, state)
  /* An issue and a change owe different things, and where this app cannot tell
     which it is holding it shows BOTH rather than picking one and keeping
     quiet. That case is ordinary standing alone: GitHub numbers issues and pull
     requests in one sequence, so `gh#126` says nothing about which it is, and
     only a tracker read could settle it. Showing the change list alone would
     have hidden the owner's own item, which lives on the issue list — the one
     row on either list that is a gate, quietly gone because a guess was made.
     Each row carries the list it came from, and the reader is told why they are
     seeing two. */
  const changeItems = effectiveList('mr').map((c) => itemFor(c, host))
  const issueItems = effectiveList('issue')
  const onChange = new Set(changeItems.map((c) => c.id))
  const chosen: { item: ChecklistItem; list: ChecklistName }[] =
    shape === 'work'
      ? issueItems.map((item) => ({ item, list: 'issue' as const }))
      : shape === 'change'
        ? changeItems.map((item) => ({ item, list: 'mr' as const }))
        : [
            ...changeItems.map((item) => ({ item, list: 'mr' as const })),
            ...issueItems.filter((i) => !onChange.has(i.id)).map((item) => ({ item, list: 'issue' as const })),
          ]
  const filed = new Map(ticks(ref).map((t) => [t.item, t]))
  /* Exemptions belong to the change list and to nothing else: an issue is an
     issue on either tracker, which is why `setChecklist` refuses to store one
     against the issue list at all. */
  const exempt = exemptFor(host)

  const rows: StandingRow[] = chosen.map(({ item, list }): StandingRow => {
    const why = list === 'mr' ? exempt[item.id] : undefined
    if (why) {
      return {
        id: item.id,
        label: item.label,
        why: item.why,
        kind: item.kind,
        state: 'unknown',
        by: 'nobody',
        at: null,
        note: null,
        detail: null,
        read: null,
        exempt: why,
        orphan: false,
        list,
      }
    }
    if (item.kind === 'derived') {
      /* The whole degradation, in three lines. With a state, the same arms the
         roadmap runs, on the same data, giving the same verdict. Without one,
         `unasked` — never `pending`, which would accuse a change of a failing
         pipeline nobody has looked at. */
      return {
        id: item.id,
        label: item.label,
        why: item.why,
        kind: item.kind,
        state: state ? derive(item.id, state, host) : 'unasked',
        by: state ? host : 'nobody has looked',
        at: memory?.at ?? null,
        note: null,
        detail: state ? deriveDetail(item.id, state) : null,
        read: state ? host : null,
        exempt: null,
        orphan: false,
        list,
      }
    }
    const t = filed.get(item.id)
    const ts = tickState(item.id, t, state?.sha)
    return {
      id: item.id,
      label: item.label,
      why: item.why,
      kind: item.kind,
      state: ts === 'done' ? 'done' : ts === 'stale' ? 'stale' : 'todo',
      by: t ? t.agent : item.kind === 'human' ? 'you' : 'an agent',
      at: t?.at ?? null,
      note:
        ts === 'stale'
          ? `made against ${shortSha(t?.sha)}, and the head is now ${shortSha(state?.sha)} — a review of the code before the fix is not a review of the fix`
          : (t?.note ?? null),
      detail: null,
      read: null,
      exempt: null,
      orphan: false,
      list,
    }
  })

  /* Ticks filed against something no longer on the list. Kept rather than
     deleted, and named here rather than left to go quiet: a tick is a record
     that somebody asserted something about a real change, and an edit made
     somewhere else must not be able to sweep it away in silence. */
  for (const o of orphanTicks([...filed.values()].map((t: Tick) => ({ item: t.item, agent: t.agent })))) {
    rows.push({
      id: o.item,
      label: o.item,
      why: o.said,
      kind: 'agent',
      state: 'done',
      by: o.agent,
      at: filed.get(o.item)?.at ?? null,
      note: null,
      detail: null,
      read: null,
      exempt: null,
      orphan: true,
      list: 'mr',
    })
  }

  const counted = rows.filter((r) => !r.orphan && !r.exempt)
  return {
    ref,
    host,
    shape,
    noun: nounFor(ref, shape),
    rows,
    seen: memory
      ? { at: memory.at, ago: ago(memory.at), from: memory.from, sha: memory.state.sha ?? null }
      : null,
    cannotSee: state ? null : rows.some((r) => r.kind === 'derived') ? NEVER_SEEN : null,
    done: counted.filter((r) => r.state === 'done').length,
    total: counted.length,
  }
}

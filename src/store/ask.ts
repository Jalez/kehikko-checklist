import type { Standing } from '../../derive/standing.ts'
import type { ChecklistView } from '../../list/view.ts'
import type { RefState } from '../../derive/ref-state.ts'
import type { Shape } from '../live/lookup.ts'

/**
 * Talking to this app's own server, which is the same origin this page came
 * from.
 *
 * ## Why these are plain relative fetches and it is worth saying so
 *
 * `/api/lists` and `/api/standings` are relative paths, so the browser resolves
 * them against the document — which is `http://127.0.0.1:7860/app`, framed or
 * not, because this module declares `storage: true` and therefore keeps its
 * origin. Every request below is an ordinary same-origin request: no preflight,
 * no CORS header offered to anybody, and no way for a page in another tab to
 * make one of them. The essay in `manifest.ts` is why that was worth the
 * declaration.
 *
 * ## The types come from the server's own files
 *
 * `Standing` and `ChecklistView` are imported from `derive/` and `list/` above
 * the `src/` boundary, as types, and are erased at build. That is deliberate
 * rather than lazy: these two shapes are decided in one place and drawn in
 * another, and a hand-written copy on this side would be a second definition
 * that silently disagrees the first time a row grows a field. The wire between
 * this page and this server is not a wire between two programs — it is one
 * program with a socket in the middle.
 */

/**
 * The ticket, read once off the inert JSON island the document carries.
 *
 * Read at module load rather than per request, because it cannot change while
 * this document is open: it is minted per server process and printed into the
 * page. A missing island is an empty string rather than a throw — that is a page
 * served by something other than this app's own server, which is a real state
 * during a build, and the writes will be refused with a sentence rather than the
 * page failing to render at all.
 */
function ticket(): string {
  const island = typeof document === 'undefined' ? null : document.getElementById('ticket')
  if (!island?.textContent) return ''
  try {
    const parsed: unknown = JSON.parse(island.textContent)
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return ''
  }
}

const TICKET = ticket()

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-checklist-ticket': TICKET },
    body: JSON.stringify(body),
  })
  return response.json()
}

/** Both lists as this app now holds them, with what shipped travelling beside it. */
export async function lists(): Promise<ChecklistView> {
  const response = await fetch('/api/lists')
  return (await response.json()) as ChecklistView
}

/** Every reference this app has anything recorded against — ticked, or seen, or both. */
export async function knownRefs(): Promise<string[]> {
  const response = await fetch('/api/known')
  const body = (await response.json()) as { refs?: unknown }
  return Array.isArray(body.refs) ? body.refs.filter((r): r is string => typeof r === 'string') : []
}

export interface Asked {
  ref: string
  /** What a host last read about it, where a host has read anything. Null is ordinary. */
  state: RefState | null
  /** What the reference IS, where the reading said. Absent leaves the app to say it cannot tell. */
  shape?: Shape
}

/**
 * Where each of these references stands, and — as a side effect the server owns
 * — this app remembering what it was just shown about them.
 *
 * One request for the whole selection rather than one per ref. Three panes'
 * worth of round trips would arrive out of order and paint the list three times;
 * more to the point, the server writes `ticks.json` as it remembers each state,
 * and one writer per request is one file rewrite instead of five racing.
 *
 * A ref with `state: null` is still sent. That is the case where somebody picked
 * a reference the open epic's reading does not contain, and it must come back as
 * a standing that says `unasked` — never be quietly left out of the list. A
 * missing row looks exactly like a row that was never meant to be there.
 */
export async function standings(refs: Asked[], from: string): Promise<Standing[]> {
  const body = (await post('/api/standings', {
    from,
    refs: refs.map((r) => ({ ref: r.ref, state: r.state, shape: r.shape })),
  })) as { standings?: unknown }
  return Array.isArray(body.standings) ? (body.standings as Standing[]) : []
}

export type TickAnswer = { ok: true; standing: Standing } | { ok: false; error: string }

/**
 * The owner's tick, which is the one write this page makes.
 *
 * Answered with the whole standing rather than with the tick, and the page
 * repaints from that rather than toggling itself green. The server is what
 * decides whether the tick stands, and a control that showed itself done on a
 * write that failed halfway is the one lie this particular control must never
 * tell — its entire value is that it means a person at this machine really did
 * agree.
 */
export async function tick(ref: string, item: string, done: boolean): Promise<TickAnswer> {
  const body = (await post('/api/tick', { ref, item, done })) as {
    ok?: unknown
    error?: unknown
    standing?: unknown
  }
  if (body.ok === true && body.standing) return { ok: true, standing: body.standing as Standing }
  return { ok: false, error: typeof body.error === 'string' ? body.error : 'it did not work, and said nothing about why' }
}

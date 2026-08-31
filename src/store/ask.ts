import type { Held, Summary } from '../../list/checklists.ts'
import type { Placed } from '../../list/scope.ts'
import type { Target } from '../../list/targets.ts'

/**
 * Talking to this app's own server, which is the same origin this page came
 * from.
 *
 * ## Why these are plain relative fetches and it is worth saying so
 *
 * `/api/checklists` and `/api/checklist` are relative paths, so the browser
 * resolves them against the document — which is `http://127.0.0.1:7860/app`,
 * framed or not, because this module declares `storage: true` and therefore
 * keeps its origin. Every request below is an ordinary same-origin request: no
 * preflight, no CORS header offered to anybody, and no way for a page in another
 * tab to make one of them. The essay in `manifest.ts` is why that was worth the
 * declaration.
 *
 * ## The types come from the server's own files
 *
 * `Held`, `Summary` and `Target` are imported from `list/` above the `src/`
 * boundary, AS TYPES, and are erased at build. That is deliberate rather than
 * lazy: these shapes are decided in one place and drawn in another, and a
 * hand-written copy on this side would be a second definition that silently
 * disagrees the first time a row grows a field. The wire between this page and
 * this server is not a wire between two programs — it is one program with a
 * socket in the middle.
 *
 * `import type` and not a value import, and that is load-bearing rather than
 * tidy: `list/checklists.ts` imports `node:fs`, and a value import would drag it
 * into the browser bundle. `tsc` would say nothing, `bun test` would say nothing,
 * and the only symptom would be a page that loads and never answers the host's
 * greeting. `list/targets.ts` and `list/keep.ts` touch no node module at all and
 * are imported for their functions on purpose — target identity has to be spelled
 * the same on both sides of that socket or the page asks about a target the
 * server does not have.
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

export type { Held, Placed, Summary, Target }

/**
 * Which project every request below is about.
 *
 * ## Why it is on the wire at all, when the server is on this machine too
 *
 * Because the server cannot know it. This app's store moved into the project —
 * `<projectPath>/.kehikot/checklist/checklists.json` — and the only thing that says which
 * project a container is showing is `roadmap.context.projectPath`, which arrives at
 * THIS page over the frame. The server has no host, no canvas and no way to ask;
 * a server that guessed would be answering about some other folder.
 *
 * So it rides on every request, read and write alike, and a request without one
 * is answered with a sentence rather than with somebody else's lists.
 */
function withProject(path: string, projectPath: string | null): string {
  if (!projectPath) return path
  return `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectPath)}`
}

/**
 * What comes back when there is no project to read from.
 *
 * Carried as its own field rather than as an empty list, all the way from
 * `list/checklists.ts`, because "this project has no checklists" and "nothing
 * said which project" draw two different screens and send a reader to two
 * different places. Flattening them is the failure this app argues against
 * everywhere else.
 */
export interface Everything {
  lists: Summary[]
  trouble: string | null
  nowhere: boolean
}

/** Every checklist in the open project. The first thing the page asks for. */
export async function everyChecklist(projectPath: string | null): Promise<Everything> {
  const response = await fetch(withProject('/api/checklists', projectPath))
  const body = (await response.json()) as { lists?: unknown; trouble?: unknown; nowhere?: unknown }
  return {
    lists: Array.isArray(body.lists) ? (body.lists as Summary[]) : [],
    trouble: typeof body.trouble === 'string' ? body.trouble : null,
    nowhere: body.nowhere === true,
  }
}

/**
 * Where the reader is pointing, as this page holds it: the wire's flattened
 * string, parsed once.
 *
 * The parse lives here rather than in `use-roadmap.ts` because this is the file
 * that spells it back onto a request, and a value that is flattened in one file
 * and re-inflated in another is a format with two owners. See the essay on
 * `passage` in the hook for why it travels flat at all.
 */
export interface Pointing {
  path: string
  from: number | null
  to: number | null
}

export function pointing(passage: string): Pointing | null {
  if (!passage) return null
  const [path, , from, to] = passage.split('\t')
  if (!path) return null
  const start = from === '' || from === undefined ? null : Number(from)
  const end = to === '' || to === undefined ? null : Number(to)
  const ranged = start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end > start
  return { path, from: ranged ? start : null, to: ranged ? end : null }
}

/**
 * The target and the passage, spelled into a query the server reads back with
 * the same rules.
 *
 * Both, and not one or the other, because they answer two different questions
 * and the server needs both to answer honestly — see the essay on
 * `/api/checklist` in `doors.ts`. The passage says where the reader IS; the
 * target says what the ticks are about, which differs the moment somebody
 * widens.
 *
 * ## `pick=1`, which is the whole of the difference between the two
 *
 * The path is sent whether or not the reader picked their target by hand,
 * because the heading wants the file's real name and the words at the top of the
 * section either way. What `pick` says is who DECIDED: without it the server may
 * derive the target from the path, and with it the target is somebody's choice
 * and the path is only there to be described.
 *
 * It exists because of a bug this probe found rather than one anybody predicted.
 * Pressing "show the whole paper" produced `{epic, section: null}`, which is
 * indistinguishable on the wire from a target nobody has narrowed yet — so the
 * server dutifully resolved the path back into the section the reader had just
 * climbed out of, and the control appeared to do nothing. A derivation must
 * never overrule a decision, and this is the one bit that says which it is
 * looking at.
 */
function query(id: string, target: Target | null, at: Pointing | null, picked: boolean): string {
  const parts = [`id=${encodeURIComponent(id)}`]
  if (target?.kind === 'ref') parts.push(`ref=${encodeURIComponent(target.ref)}`)
  if (target?.kind === 'paper') {
    parts.push(`epic=${encodeURIComponent(target.epic)}`)
    if (target.section) parts.push(`section=${encodeURIComponent(target.section)}`)
  }
  /* Sent only with a paper target. A checklist held against an issue has no
     document and never will, and putting a path on that request would be asking
     the server to open a file in order to answer a question that does not
     involve one. That is the whole of "non-document targets keep working exactly
     as they do", enforced one line above the fence rather than inside it. */
  if (at && target?.kind === 'paper') {
    parts.push(`path=${encodeURIComponent(at.path)}`)
    if (at.from !== null && at.to !== null) parts.push(`from=${at.from}`, `to=${at.to}`)
    if (picked) parts.push('pick=1')
  }
  return parts.join('&')
}

export interface Opened {
  held: Held
  /** Every target this list has ticks against, so nothing recorded becomes unreachable. */
  targets: { target: Target; done: number }[]
  /**
   * Where the reader turned out to be, as the server read the file — not as this
   * page guessed.
   *
   * Null whenever nothing narrowed: no passage, a ref target, a path the fence
   * refused, a file with no headings this app recognises. Every one of those is
   * the same instruction to the screen — say the paper — which is why they are
   * one value rather than four.
   */
  placed: Placed | null
}

/**
 * One checklist, with the ticks for one target.
 *
 * Refused rather than empty when the list is gone or the target is not a name —
 * the server says so in a sentence, and this hands the sentence on rather than
 * turning it into an empty list. "Nobody has ticked anything" and "that
 * checklist is not here" are two different answers with two different remedies,
 * and this is a module whose whole argument is that those do not get flattened.
 */
export async function openChecklist(
  id: string,
  target: Target | null,
  projectPath: string | null,
  at: Pointing | null = null,
  picked = false,
): Promise<Opened | { error: string }> {
  const response = await fetch(withProject(`/api/checklist?${query(id, target, at, picked)}`, projectPath))
  const body = (await response.json()) as {
    ok?: unknown
    held?: unknown
    targets?: unknown
    placed?: unknown
    error?: unknown
  }
  if (body.ok === true && body.held) {
    return {
      held: body.held as Held,
      targets: Array.isArray(body.targets) ? (body.targets as { target: Target; done: number }[]) : [],
      placed: (body.placed as Placed | null) ?? null,
    }
  }
  return { error: typeof body.error === 'string' ? body.error : 'this app could not read that checklist.' }
}

export type Edit =
  | { op: 'create'; name: string }
  | { op: 'rename'; id: string; name: string }
  | { op: 'forget'; id: string }
  | { op: 'add'; id: string; text: string }
  | { op: 'reword'; id: string; item: string; text: string }
  | { op: 'move'; id: string; item: string; to: number }
  | { op: 'drop'; id: string; item: string }
  | { op: 'tick'; id: string; item: string; target: Target; done: boolean }

export type Answer = { ok: true; said: string; id: string; lists: Summary[]; held: Held | null } | { ok: false; error: string }

/**
 * Every change the owner makes, through the one door the server decides at.
 *
 * Answered with the whole list rather than with the one row, and the page
 * repaints from that rather than toggling itself. The server holds the order and
 * the ticks, and a page that reordered itself optimistically would show an order
 * the file does not have the moment a write is refused.
 */
export async function edit(change: Edit, projectPath: string | null): Promise<Answer> {
  /* The target is flattened into the body here rather than being sent as a
     nested object, because the server reads a ref, an epic and a section as
     three bounded strings — the same three the MCP door reads. One spelling of a
     target across both doors is what stops the page and an agent naming the same
     work two ways. */
  const target =
    change.op === 'tick'
      ? change.target.kind === 'ref'
        ? { ref: change.target.ref }
        : { epic: change.target.epic, ...(change.target.section ? { section: change.target.section } : {}) }
      : {}
  const body = (await post('/api/checklist', { ...change, ...target, project: projectPath })) as {
    ok?: unknown
    said?: unknown
    id?: unknown
    lists?: unknown
    held?: unknown
    error?: unknown
  }
  if (body.ok === true) {
    return {
      ok: true,
      said: typeof body.said === 'string' ? body.said : '',
      id: typeof body.id === 'string' ? body.id : '',
      lists: Array.isArray(body.lists) ? (body.lists as Summary[]) : [],
      held: (body.held as Held | null) ?? null,
    }
  }
  return { ok: false, error: typeof body.error === 'string' ? body.error : 'it did not work, and said nothing about why' }
}

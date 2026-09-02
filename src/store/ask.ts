import type { Held, Summary } from '../../list/checklists.ts'
import type { Outline, OutlineFile, OutlineSection } from '../../file/outline.ts'
import type { Placed } from '../../list/scope.ts'
import type { Target } from '../../list/targets.ts'

/**
 * Talking to this app's own server, which is the same origin this page came
 * from.
 *
 * ## Why these are plain relative fetches and it is worth saying so
 *
 * `/api/here`, `/api/checklists` and `/api/checklist` are relative paths, so
 * the browser resolves them against the document — which is
 * `http://127.0.0.1:7860/app`, framed or not, because this module declares
 * `storage: true` and therefore keeps its origin. Every request below is an
 * ordinary same-origin request: no preflight, no CORS header offered to
 * anybody, and no way for a page in another tab to make one of them. The essay
 * in `manifest.ts` is why that was worth the declaration.
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
 * greeting. `list/targets.ts`, `list/scope.ts` and `list/holding.ts` touch no
 * node module at all and are imported for their functions on purpose — target
 * identity has to be spelled the same on both sides of that socket or the page
 * asks about a target the server does not have.
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

export type { Held, Outline, OutlineFile, OutlineSection, Placed, Summary, Target }

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

/** Every checklist in the open project: the screen behind `All checklists`. */
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
 * What is in front of the reader: every checklist held against where they
 * are or what they have selected, each with the ticks for that target.
 */
export interface Here {
  /** Where the reader's document turned out to be, as the server read it. Null when nothing narrowed. */
  placed: Placed | null
  /** One entry per (checklist, target) pairing in front of the reader. `held.target` is never null here. */
  instances: Held[]
  trouble: string | null
  nowhere: boolean
}

/**
 * The reading page's one request: position and selection in, instances out.
 *
 * The passage is sent only with an epic. A checklist held against a paper
 * needs an epic to name the paper, so a passage with no epic narrows nothing —
 * and sending it would be asking the server to open a file in order to answer
 * a question that does not involve one.
 */
export async function whatIsHere(
  projectPath: string | null,
  epic: string | null,
  at: Pointing | null,
  selection: string[],
): Promise<Here> {
  const parts: string[] = []
  if (epic) parts.push(`epic=${encodeURIComponent(epic)}`)
  if (epic && at) {
    parts.push(`path=${encodeURIComponent(at.path)}`)
    if (at.from !== null && at.to !== null) parts.push(`from=${at.from}`, `to=${at.to}`)
  }
  if (selection.length) parts.push(`refs=${encodeURIComponent(selection.join(' '))}`)
  const response = await fetch(withProject(`/api/here${parts.length ? `?${parts.join('&')}` : ''}`, projectPath))
  const body = (await response.json()) as { placed?: unknown; instances?: unknown; trouble?: unknown; nowhere?: unknown }
  return {
    placed: (body.placed as Placed | null) ?? null,
    instances: Array.isArray(body.instances) ? (body.instances as Held[]) : [],
    trouble: typeof body.trouble === 'string' ? body.trouble : null,
    nowhere: body.nowhere === true,
  }
}

export interface Opened {
  /** The list on its own: `target` null, nothing ticked, because the edit page ticks nothing. */
  held: Held
  /** Every target this list is held against, with how much is ticked on each. */
  targets: { target: Target; done: number }[]
}

/**
 * One checklist, on its own, for the edit page.
 *
 * Refused rather than empty when the list is gone — the server says so in a
 * sentence, and this hands the sentence on rather than turning it into an
 * empty list. "This list has no items" and "that checklist is not here" are two
 * different answers with two different remedies.
 */
export async function openChecklist(id: string, projectPath: string | null): Promise<Opened | { error: string }> {
  const response = await fetch(withProject(`/api/checklist?id=${encodeURIComponent(id)}`, projectPath))
  const body = (await response.json()) as { ok?: unknown; held?: unknown; targets?: unknown; error?: unknown }
  if (body.ok === true && body.held) {
    return {
      held: body.held as Held,
      targets: Array.isArray(body.targets) ? (body.targets as { target: Target; done: number }[]) : [],
    }
  }
  return { error: typeof body.error === 'string' ? body.error : 'this app could not read that checklist.' }
}

/**
 * The paper the reader is standing in, so the edit page can offer its files and
 * headings as targets rather than a box to spell an id into.
 *
 * ## Asked when the edit page opens, and not on every context
 *
 * This opens every `.tex` of a paper. `whatIsHere` above runs on every context
 * — and a context arrives after every selection change anywhere on the canvas
 * — so folding this into that request would read the whole thesis several
 * times a second to answer a question nobody has asked. `src/app.tsx` asks when
 * somebody is editing a list and holds the answer until they move to another
 * file, which is the point at which it would be about a different paper.
 *
 * ## Null is an ordinary answer and not a failure
 *
 * No project open, no document under the reader, a path the fence refused, a
 * directory that will not list: every one of those is the same instruction to
 * the screen — offer no files, say one short line, and leave the box that types
 * a reference exactly where it was. Distinguishing them here would be the
 * existence oracle `file/confine.ts` refuses, one question at a time.
 */
export async function paperOutline(projectPath: string | null, path: string): Promise<Outline | null> {
  const response = await fetch(withProject(`/api/outline?path=${encodeURIComponent(path)}`, projectPath))
  const body = (await response.json()) as { outline?: unknown }
  const outline = body.outline as Outline | null | undefined
  return outline && Array.isArray(outline.files) ? outline : null
}

export type Edit =
  | { op: 'create'; name: string }
  /**
   * Copy a list out of another project into the open one.
   *
   * `from` is the other project's absolute path and `id` is the list's id
   * THERE — the only place in this file where an id is not about the open
   * project. `from` came out of `pickProject`, which is to say out of a dialog
   * the host drew and a person pressed; this page has no other source for one
   * and must never grow one.
   */
  | { op: 'import'; from: string; id: string }
  | { op: 'rename'; id: string; name: string }
  | { op: 'forget'; id: string }
  /** Hold this list against one more target, or stop. The edit page's two presses; see `list/checklists.ts`. */
  | { op: 'hold'; id: string; target: Target }
  | { op: 'release'; id: string; target: Target }
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
    change.op === 'tick' || change.op === 'hold' || change.op === 'release'
      ? change.target.kind === 'ref'
        ? { ref: change.target.ref }
        : { epic: change.target.epic, ...(change.target.section ? { section: change.target.section } : {}) }
      : {}
  const { ...sent } = change as Record<string, unknown>
  delete sent.target
  const body = (await post('/api/checklist', { ...sent, ...target, project: projectPath })) as {
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

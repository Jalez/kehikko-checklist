import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The doors, tested without a socket.
 *
 * `answer()` takes a method, a path, a query, a body and a ticket and gives back
 * a status and a document — which is the whole reason it is a function rather
 * than a `fetch` handler. Everything the server decides is decided here, so
 * everything the server decides is testable here.
 */
/**
 * `dir` is a PROJECT, and every door below is told which one.
 *
 * That is the change these doors carry: the store lives at
 * `<project>/.kehikot/checklist/checklists.json`, so a read carries `?project=` and a
 * write carries `project` in its body. `query` is therefore built per test
 * rather than shared and empty.
 */
let dir = ''
/** The empty query, for the doors that take none. */
const query = new URLSearchParams()
/** A query that names the project under test, plus whatever else a test needs. */
function asking(extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ project: dir, ...extra })
}

/**
 * The registry of modules on this machine, pointed at a folder of the test's
 * own: the door reads module ids off it, and the real one holds whatever is
 * installed on the machine these run on.
 */
let registry = ''
const registryBefore = process.env.KEHIKOT_MODULES_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-doors-'))
  registry = mkdtempSync(join(tmpdir(), 'checklist-registry-'))
  process.env.KEHIKOT_MODULES_DIR = registry
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(registry, { recursive: true, force: true })
  if (registryBefore === undefined) delete process.env.KEHIKOT_MODULES_DIR
  else process.env.KEHIKOT_MODULES_DIR = registryBefore
})

/** Modules registered on this machine, as a host's registry names them: one file each. */
function registered(...files: string[]): void {
  mkdirSync(registry, { recursive: true })
  for (const file of files) writeFileSync(join(registry, file), '{}\n')
}

/** One tool call, in the shape an MCP client makes it, with the text it answered. */
async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const { answer } = await import('../doors.ts')
  const reply = answer(
    'POST',
    '/mcp',
    query,
    /* The project is folded in here rather than written into thirty calls, but a
       test that needs to see the refusal passes `project: undefined` and gets
       it — see "an agent that did not say which project". */
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: dir, ...args } } },
    null,
  )
  const result = (reply?.body as { result: { content: { text: string }[]; isError?: boolean } }).result
  return { text: result.content[0]?.text ?? '', isError: result.isError === true }
}

/** Create a list with one item, and give back both ids. */
async function aList(name = 'What a change owes'): Promise<{ list: string; item: string }> {
  const { change } = await import('../list/checklists.ts')
  const made = change({ op: 'create', name, by: 'a test' }, dir)
  if (!made.ok) throw new Error(made.error)
  const added = change({ op: 'add', id: made.id, text: 'A test that fails without the change', by: 'a test' }, dir)
  if (!added.ok) throw new Error(added.error)
  return { list: made.id, item: added.held!.rows[0]!.item.id }
}

/** A file of a paper, written where `at` says inside the project under test, with one labelled heading. */
async function aChapter(at: string, label = 'sec:meth-design'): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  mkdirSync(dirname(join(dir, at)), { recursive: true })
  writeFileSync(join(dir, at), `\\section{Research design}\\label{${label}}\n\nWords.\n`)
}

/** Where in `aChapter`'s file the words under its heading are, in bytes. */
const WORDS = { from: 45, to: 50 }

describe('reads', () => {
  test('the health check answers with this module’s own name', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('GET', '/healthz', query, null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe('kehikot.checklist')
  })

  test('a fresh store holds no checklists, because nothing here ships one', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('GET', '/api/checklists', asking(), null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { lists: unknown[] }).lists).toEqual([])
  })

  test('the checklists are readable with no ticket, because a checklist is not a secret', async () => {
    const { answer } = await import('../doors.ts')
    await aList()
    const reply = answer('GET', '/api/checklists', asking(), null, null)
    expect((reply?.body as { lists: { name: string }[] }).lists[0]?.name).toBe('What a change owes')
  })

  test('a path that is not ours is handed back to Vite rather than refused', async () => {
    /* `null` is how the middleware knows to call `next()`, which is what keeps
       the page, the client module and the hot-reload socket working without being
       enumerated in this file. */
    const { answer } = await import('../doors.ts')
    expect(answer('GET', '/src/main.tsx', query, null, null)).toBeNull()
  })

  test('an unknown path under /api is ours to refuse, not Vite’s to serve as source', async () => {
    const { answer } = await import('../doors.ts')
    expect(answer('GET', '/api/nothing', query, null, null)?.status).toBe(404)
  })

  test('a checklist read with no target comes back with nothing ticked, and says so is not an error', async () => {
    const { answer } = await import('../doors.ts')
    const { list } = await aList()
    const reply = answer('GET', '/api/checklist', asking({ id: list }), null, null)
    const body = reply?.body as { ok: boolean; held: { target: unknown; rows: { done: unknown }[] } }
    expect(body.ok).toBe(true)
    expect(body.held.target).toBeNull()
    expect(body.held.rows[0]?.done).toBeNull()
  })

  /**
   * The reading page's one request: where the reader is and what is selected
   * in, every checklist in front of them out. Position never invents a
   * pairing — a list is in front of the reader only where somebody held it.
   */
  test('/api/here answers with every list held against where the reader is, and nothing else', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { list, item } = await aList()
    const other = answer('POST', '/api/checklist', query, { op: 'create', name: 'What the thesis owes', project: dir }, TICKET)
    const otherId = (other?.body as { id: string }).id
    /* On disk before it is held: this door holds a list against a file that is there. */
    await aChapter('chapters/3_methods.tex')
    answer('POST', '/api/checklist', query, { op: 'hold', id: list, epic: 'thesis', section: 'chapters:3_methods', project: dir }, TICKET)
    answer('POST', '/api/checklist', query, { op: 'hold', id: otherId, epic: 'thesis', project: dir }, TICKET)
    answer('POST', '/api/checklist', query, { op: 'tick', id: list, item, epic: 'thesis', section: 'chapters:3_methods', done: true, project: dir }, TICKET)

    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    mkdirSync(join(dir, 'chapters'), { recursive: true })
    writeFileSync(join(dir, 'chapters', '3_methods.tex'), '\\section{Research design}\\label{sec:meth-design}\n\nWords.\n')
    writeFileSync(join(dir, 'chapters', '1_introduction.tex'), '\\section{Why}\\label{sec:intro}\n\nWords.\n')

    type Here = { instances: { checklist: { id: string }; target: unknown; done: number }[]; placed: { file: string } | null }
    const inMethods = answer('GET', '/api/here', asking({ epic: 'thesis', path: 'chapters/3_methods.tex', from: '40', to: '45' }), null, null)
    const methods = inMethods?.body as Here
    expect(methods.placed?.file).toBe('chapters/3_methods.tex')
    expect(methods.instances.map((one) => one.checklist.id)).toEqual([list, otherId])
    /* The chapter list's ticks are the chapter's, and the whole-paper list is
       shown as the whole paper — each instance says which target it is. */
    expect(methods.instances[0]?.target).toEqual({ kind: 'paper', epic: 'thesis', section: 'chapters:3_methods' })
    expect(methods.instances[0]?.done).toBe(1)
    expect(methods.instances[1]?.target).toEqual({ kind: 'paper', epic: 'thesis', section: null })

    const inIntro = answer('GET', '/api/here', asking({ epic: 'thesis', path: 'chapters/1_introduction.tex' }), null, null)
    expect((inIntro?.body as Here).instances.map((one) => one.checklist.id)).toEqual([otherId])

    /* A selected reference nothing is held against adds nothing; one that is
       held leads. */
    answer('POST', '/api/checklist', query, { op: 'hold', id: list, ref: 'gh#105', project: dir }, TICKET)
    const selected = answer('GET', '/api/here', asking({ epic: 'thesis', path: 'chapters/1_introduction.tex', refs: 'gh#900 gh#105' }), null, null)
    expect((selected?.body as Here).instances.map((one) => `${one.checklist.id}`)).toEqual([list, otherId])
    expect((selected?.body as Here).instances[0]?.target).toEqual({ kind: 'ref', ref: 'gh#105' })

    /* Nothing open and nothing selected: nothing in front. */
    const nothing = answer('GET', '/api/here', asking(), null, null)
    expect((nothing?.body as Here).instances).toEqual([])

    /* Several places at once — two chapters, each shown by a container on
       the kehikko — and every list held against either is in front, with the
       whole-paper list once though both chapters are in it. */
    const both = new URLSearchParams(asking({ epic: 'thesis', path: 'chapters/1_introduction.tex' }))
    both.append('doc', 'chapters/3_methods.tex\t40\t45')
    const several = answer('GET', '/api/here', both, null, null)
    const spread = several?.body as Here & { positions: ({ file: string } | null)[] }
    expect(spread.placed?.file).toBe('chapters/1_introduction.tex')
    expect(spread.positions.map((one) => one?.file)).toEqual(['chapters/1_introduction.tex', 'chapters/3_methods.tex'])
    expect(spread.instances.map((one) => one.checklist.id)).toEqual([otherId, list])
    expect(spread.instances.filter((one) => one.checklist.id === otherId)).toHaveLength(1)

    /* `whole=1`, which the page asks while parts of the epic are picked: every
       list held against this paper, wherever in it, each with its own ticks —
       and the reader's place is not what decides it. */
    const whole = answer('GET', '/api/here', asking({ epic: 'thesis', whole: '1', path: 'chapters/1_introduction.tex' }), null, null)
    const all = whole?.body as Here
    expect(all.instances.map((one) => one.checklist.id)).toEqual([list, otherId])
    expect(all.instances[0]?.target).toEqual({ kind: 'paper', epic: 'thesis', section: 'chapters:3_methods' })
    expect(all.instances[0]?.done).toBe(1)
    /* The place named is resolved for its name, and is nobody's position. */
    expect(all.placed).toBeNull()
    expect((all as Here & { positions: ({ file: string } | null)[] }).positions.map((one) => one?.file)).toEqual(['chapters/1_introduction.tex'])
    /* Without an epic there is no paper to be the whole of. */
    expect((answer('GET', '/api/here', asking({ whole: '1' }), null, null)?.body as Here).instances).toEqual([])
  })

  test('the page can hold and release through its own door, and a release with no target is refused', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { list } = await aList()
    const held = answer('POST', '/api/checklist', query, { op: 'hold', id: list, ref: 'gh#105', project: dir }, TICKET)
    expect((held?.body as { ok: boolean }).ok).toBe(true)
    const back = answer('GET', '/api/checklist', asking({ id: list }), null, null)
    expect((back?.body as { targets: { target: unknown; done: number }[] }).targets).toEqual([
      { target: { kind: 'ref', ref: 'gh#105' }, done: 0 },
    ])
    const refused = answer('POST', '/api/checklist', query, { op: 'release', id: list, project: dir }, TICKET)
    expect(refused?.status).toBe(400)
    expect((refused?.body as { error: string }).error).toContain('did not say which target')
  })

  test('a target that is not a name is refused with a sentence, not read as no target', async () => {
    /* The failure this refuses is silent: a ref with a space in it, quietly
       dropped, would show the list with no ticks at all — which looks exactly
       like a target nobody has worked on yet. */
    const { answer } = await import('../doors.ts')
    const { list } = await aList()
    const reply = answer('GET', '/api/checklist', asking({ id: list, ref: 'gh# 105' }), null, null)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('not a target')
  })
})

describe('writes', () => {
  test('are refused without the ticket this process handed out with the page', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/checklist', query, { op: 'create', name: 'Mine', project: dir }, 'not-the-ticket')
    expect(reply?.status).toBe(403)
  })

  test('with the ticket, a checklist can be created and read back', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const made = answer('POST', '/api/checklist', query, { op: 'create', name: 'What a paper owes', project: dir }, TICKET)
    const body = made?.body as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    const back = answer('GET', '/api/checklists', asking(), null, null)
    expect((back?.body as { lists: { id: string }[] }).lists[0]?.id).toBe(body.id)
  })

  test('an op this door does not know is named rather than shrugged at', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { list } = await aList()
    const reply = answer('POST', '/api/checklist', query, { op: 'sort', id: list, project: dir }, TICKET)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('there is no "sort"')
  })

  test('a tick with no target is refused, because a tick without one is about nothing', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { list, item } = await aList()
    const reply = answer('POST', '/api/checklist', query, { op: 'tick', id: list, item, project: dir }, TICKET)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('did not say what it was against')
  })

  test('a move with no position is refused, and nothing is moved', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { list, item } = await aList()
    const reply = answer('POST', '/api/checklist', query, { op: 'move', id: list, item, project: dir }, TICKET)
    expect((reply?.body as { error: string }).error).toContain('nothing was moved')
  })

  test('the same list held against two targets keeps two independent sets of ticks', async () => {
    /* The whole model, in one test. This is what the ref-scoped machinery was
       actually giving anybody, and it is what survived its deletion. */
    const { TICKET, answer } = await import('../doors.ts')
    const { list, item } = await aList()
    answer('POST', '/api/checklist', query, { op: 'tick', id: list, item, ref: 'gh#105', done: true, project: dir }, TICKET)

    const one = answer('GET', '/api/checklist', asking({ id: list, ref: 'gh#105' }), null, null)
    const two = answer('GET', '/api/checklist', asking({ id: list, ref: 'gh#106' }), null, null)
    expect((one?.body as { held: { done: number } }).held.done).toBe(1)
    expect((two?.body as { held: { done: number } }).held.done).toBe(0)
  })

  test('a paper section is its own target, distinct from the whole paper', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { list, item } = await aList()
    await aChapter('chapters/bridge.tex', 'ch:bridge')
    const section = 'chapters:bridge#ch:bridge'
    answer(
      'POST',
      '/api/checklist',
      query,
      { op: 'tick', id: list, item, epic: 'modes-are-modules', section, done: true, project: dir },
      TICKET,
    )
    const whole = answer('GET', '/api/checklist', asking({ id: list, epic: 'modes-are-modules' }), null, null)
    const part = answer('GET', '/api/checklist', asking({ id: list, epic: 'modes-are-modules', section }), null, null)
    expect((whole?.body as { held: { done: number } }).held.done).toBe(0)
    expect((part?.body as { held: { done: number } }).held.done).toBe(1)
  })
})

describe('the agent’s door', () => {
  test('is not held to the page’s ticket, because an MCP client has no page', async () => {
    /* An MCP client is not a browser and was never handed a ticket. Requiring one
       at `/mcp` would mean the door could never be opened by the thing it exists
       for — so the check is deliberately below it, and this is what says so. */
    const { list, item } = await aList()
    const out = await tool('check_item', { checklist: list, item, ref: 'gh#105' })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('is ticked for ref:gh#105')
  })

  test('checklist_for says what it does in MCP’s own form: it writes, and destroys nothing', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const tools = (reply?.body as { result: { tools: { name: string; annotations?: Record<string, boolean> }[] } }).result.tools
    expect(tools.find((one) => one.name === 'checklist_for')?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false })
    /* And no tool here that writes claims to only read. */
    for (const one of tools) if (one.name !== 'checklists') expect(one.annotations?.readOnlyHint).not.toBe(true)
  })

  test('lists exactly the nine tools this app now has', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const names = (reply?.body as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)
    expect(names).toEqual([
      'checklists',
      'create_checklist',
      'hold_checklist',
      'checklist_for',
      'add_checklist_item',
      'check_item',
      'reword_checklist_item',
      'move_checklist_item',
      'drop_checklist_item',
    ])
    /* The old names are gone rather than aliased. They named a merge request
       because the list they read was hardcoded to one; a tool named after a list
       that no longer exists is a tool about nothing. */
    expect(names).not.toContain('mr_checklist')
    expect(names).not.toContain('check_mr')
    expect(names).not.toContain('paper_checklist')
  })

  /**
   * The refusal that replaces a default, and the argument for it.
   *
   * Every default on offer was wrong: this module's own `cwd` files lists where
   * no page will ever show them, "the only project, if there is one" is correct
   * until there are two, and no partition at all is the arrangement being
   * removed. So it refuses, and the refusal says what to pass — which costs an
   * agent one round trip, where a wrong default costs somebody their work in a
   * folder they will never open.
   */
  test('an agent that did not say which project is refused, and told what to pass', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer(
      'POST',
      '/mcp',
      query,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'checklists', arguments: {} } },
      null,
    )
    const result = (reply?.body as { result: { content: { text: string }[]; isError?: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('needs project')
    expect(result.content[0]?.text).toContain('.kehikot/checklist')
  })

  test('a write with no project writes nothing, rather than into a guessed folder', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer(
      'POST',
      '/mcp',
      query,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_checklist', arguments: { name: 'Nowhere in particular' } },
      },
      null,
    )
    const result = (reply?.body as { result: { content: { text: string }[]; isError?: boolean } }).result
    expect(result.isError).toBe(true)
    /* And the project under test is untouched, which is the half that matters. */
    const { checklists } = await import('../list/checklists.ts')
    expect(checklists(dir).lists).toEqual([])
  })

  test('every tool says project is required, so an agent finds out before it calls', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const tools = (reply?.body as { result: { tools: { name: string; inputSchema: { required?: string[] } }[] } }).result
      .tools
    for (const t of tools) expect(t.inputSchema.required).toContain('project')
  })

  test('the page’s own door refuses a write with no project too', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/checklist', query, { op: 'create', name: 'Mine' }, TICKET)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('needs project')
  })

  test('a read with no project says so as a state rather than as a refusal', async () => {
    /* `nowhere` beside the lists, and a 200: the page draws its own screen for
       it, and a 400 would make an ordinary state — no project open — look like
       the page had asked something wrong. */
    const { answer } = await import('../doors.ts')
    const reply = answer('GET', '/api/checklists', query, null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { nowhere: boolean; lists: unknown[] }).nowhere).toBe(true)
    expect((reply?.body as { lists: unknown[] }).lists).toEqual([])
  })

  test('a tool nobody has is refused by name rather than silently', async () => {
    const out = await tool('check_mr', { ref: 'gh#1', item: 'agreed' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('no tool "check_mr" here')
  })

  test('an agent MAY tick, and the record says it came through this door', async () => {
    /* The answer to what the old `agreed` gate meant. There is no shipped item to
       refuse an agent any more, so what survives is that the tick is never
       anonymous about where it came from — see the essay in
       `list/checklists.ts`. */
    const { list, item } = await aList()
    await tool('check_item', { checklist: list, item, ref: '!1848', agent: 'a test', note: 'ran it against the parent commit' })
    const back = await tool('checklists', { checklist: list, ref: '!1848' })
    expect(back.text).toContain('a test, over MCP: ran it against the parent commit')
  })

  test('hold_checklist holds a list against a target, and the listing says where every list is held', async () => {
    /* The tool that answers the report from the agent's side: a list is SHOWN
       to a person where it is held, and this is how an agent puts one there. */
    await aChapter('chapters/3_methods.tex')
    const { list } = await aList()
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'chapters:3_methods' })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('is now held against thesis · chapters:3_methods')
    const all = await tool('checklists', {})
    expect(all.text).toContain('held against thesis · chapters:3_methods')
    const one = await tool('checklists', { checklist: list })
    expect(one.text).toContain('Held against: thesis · chapters:3_methods (0 ticked)')
  })

  test('hold_checklist with release: true lets go, and says the ticks are kept', async () => {
    const { list, item } = await aList()
    await tool('check_item', { checklist: list, item, ref: 'gh#105' })
    const out = await tool('hold_checklist', { checklist: list, ref: 'gh#105', release: true })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('is no longer held against gh#105')
    expect(out.text).toContain('kept')
    expect(out.text).toContain('Held against nothing yet')
  })

  test('hold_checklist resolves a path into the heading being looked at, like check_item does', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    mkdirSync(join(dir, 'chapters'), { recursive: true })
    const source = '\\section{Research design}\\label{sec:meth-design}\n\nWords.\n'
    writeFileSync(join(dir, 'chapters', '3_methods.tex'), source)
    const { list } = await aList()
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', path: 'chapters/3_methods.tex', from: 40, to: 45 })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('chapters:3_methods#sec:meth-design')
  })

  test('a path spelled from the paper’s own folder is that file, not the whole paper (Jalez/kehikko-checklist#14)', async () => {
    await aChapter('.kehikot/paper/thesis/chapters/3_methods.tex')
    const { list } = await aList()
    const file = await tool('hold_checklist', { checklist: list, epic: 'thesis', path: 'chapters/3_methods.tex' })
    expect(file.isError).toBe(false)
    expect(file.text).toContain('is now held against thesis · .kehikot:paper:thesis:chapters:3_methods')
    expect(file.text).not.toContain('(the paper)')
    const heading = await tool('hold_checklist', { checklist: list, epic: 'thesis', path: 'chapters/3_methods.tex', ...WORDS })
    expect(heading.text).toContain('is now held against thesis · .kehikot:paper:thesis:chapters:3_methods#sec:meth-design')
  })

  test('a path that is not a file is refused, and nothing is held against the whole paper instead', async () => {
    const { list, item } = await aList()
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', path: 'chapters/nowhere.tex' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('is not a file this app can open')
    expect(out.text).toContain('refused rather than read as the whole paper')
    const tick = await tool('check_item', { checklist: list, item, epic: 'thesis', path: 'chapters/nowhere.tex' })
    expect(tick.isError).toBe(true)
    const read = await tool('checklists', { checklist: list, epic: 'thesis', path: 'chapters/nowhere.tex' })
    expect(read.isError).toBe(true)
    expect((await tool('checklists', {})).text).toContain('held against nothing yet')
  })

  test('a section that names no file or heading is refused, so a typo cannot become a target nothing shows', async () => {
    await aChapter('.kehikot/paper/thesis/chapters/3_methods.tex')
    const { list } = await aList()
    /* The bare label the description used to suggest: it is not the id this app
       mints for that heading, so no container's `showing` resolves to it. */
    const bare = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'sec:meth-design' })
    expect(bare.isError).toBe(true)
    expect(bare.text).toContain('names no file or heading')
    expect(bare.text).toContain('A bare label is not one')
    const typo = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'chapters:3_methods#sec:design' })
    expect(typo.isError).toBe(true)
    expect(typo.text).toContain('has no heading with the id "sec:design"')
    expect(typo.text).toContain('Its headings are: .kehikot:paper:thesis:chapters:3_methods#sec:meth-design')
    expect((await tool('checklists', {})).text).toContain('held against nothing yet')
  })

  test('a section spelled from the paper’s folder or from the project’s is one target, the one a reader arrives at', async () => {
    await aChapter('.kehikot/paper/thesis/chapters/3_methods.tex')
    const { list } = await aList()
    const short = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' })
    expect(short.isError).toBe(false)
    expect(short.text).toContain('is now held against thesis · .kehikot:paper:thesis:chapters:3_methods#sec:meth-design')
    const long = await tool('hold_checklist', {
      checklist: list,
      epic: 'thesis',
      section: '.kehikot:paper:thesis:chapters:3_methods#sec:meth-design',
    })
    expect(long.text).toContain('is already held against')
    const walked = await tool('checklists', {
      checklist: list,
      epic: 'thesis',
      path: join(dir, '.kehikot/paper/thesis/chapters/3_methods.tex'),
      ...WORDS,
    })
    expect(walked.text).toContain('held against thesis · .kehikot:paper:thesis:chapters:3_methods#sec:meth-design — 0/1 ticked')
    expect(walked.text).not.toContain('Also held')
  })

  test('a target a list is already held against stays nameable when nothing on disk answers to it', async () => {
    /* A hold made before the refusal existed, or a heading renamed since. The
       ticks are a record of work done, so it can still be read, unticked and
       let go by the name it was stored under. */
    const { change } = await import('../list/checklists.ts')
    const { list, item } = await aList()
    const stale = { kind: 'paper' as const, epic: 'thesis', section: 'sec:dependencies' }
    change({ op: 'tick', id: list, item, target: stale, done: true, by: 'a test' }, dir)
    const read = await tool('checklists', { checklist: list, epic: 'thesis', section: 'sec:dependencies' })
    expect(read.isError).toBe(false)
    expect(read.text).toContain('1/1 ticked')
    const untick = await tool('check_item', { checklist: list, item, epic: 'thesis', section: 'sec:dependencies', done: false })
    expect(untick.isError).toBe(false)
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'sec:dependencies', release: true })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('is no longer held against thesis · sec:dependencies')
    /* And once let go it is a new target like any other, and refused. */
    const again = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'sec:dependencies' })
    expect(again.isError).toBe(true)
  })

  test('a hold stored under an older spelling stays nameable beside the file that spelling now resolves to', async () => {
    /* `chapters:3_methods` is the "chapter file's name" form the tool once
       suggested. The file is there, under the id a reader arrives at, and the
       stored name must not be swallowed by it. */
    const { change } = await import('../list/checklists.ts')
    const { list, item } = await aList()
    await aChapter('.kehikot/paper/thesis/chapters/3_methods.tex')
    const stale = { kind: 'paper' as const, epic: 'thesis', section: 'chapters:3_methods' }
    change({ op: 'tick', id: list, item, target: stale, done: true, by: 'a test' }, dir)
    const named = { checklist: list, epic: 'thesis', section: 'chapters:3_methods' }

    const read = await tool('checklists', named)
    expect(read.text).toContain('held against thesis · chapters:3_methods — 1/1 ticked')
    const untick = await tool('check_item', { ...named, item, done: false })
    expect(untick.isError).toBe(false)
    expect(untick.text).toContain('held against thesis · chapters:3_methods — 0/1 ticked')
    const tick = await tool('check_item', { ...named, item, done: true })
    expect(tick.isError).toBe(false)
    expect(tick.text).toContain('held against thesis · chapters:3_methods — 1/1 ticked')

    /* A NEW hold by that spelling is the one call that asks the disk first. */
    const held = await tool('hold_checklist', named)
    expect(held.text).toContain('is now held against thesis · .kehikot:paper:thesis:chapters:3_methods')

    const released = await tool('hold_checklist', { ...named, release: true })
    expect(released.isError).toBe(false)
    expect(released.text).toContain('is no longer held against thesis · chapters:3_methods')
    expect(released.text).toContain('Held against: thesis · .kehikot:paper:thesis:chapters:3_methods')
  })

  test('a relative path both folders have is the paper’s, and the answer says how to name the project’s', async () => {
    await aChapter('chapters/3_methods.tex')
    await aChapter('.kehikot/paper/thesis/chapters/3_methods.tex')
    const { list } = await aList()
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', path: 'chapters/3_methods.tex' })
    expect(out.text).toContain('is now held against thesis · .kehikot:paper:thesis:chapters:3_methods')
    expect(out.text).toContain('The paper’s was taken')
    expect(out.text).toContain(`give its absolute path: "${join(dir, 'chapters/3_methods.tex')}"`)
    const other = await tool('hold_checklist', { checklist: list, epic: 'thesis', path: join(dir, 'chapters/3_methods.tex') })
    expect(other.text).toContain('is now held against thesis · chapters:3_methods')
    expect(other.text).not.toContain('was taken')

    const second = await aList('What a chapter owes')
    const byId = await tool('hold_checklist', { checklist: second.list, epic: 'thesis', section: 'chapters:3_methods' })
    expect(byId.text).toContain('is now held against thesis · .kehikot:paper:thesis:chapters:3_methods')
    expect(byId.text).toContain(`To mean the project’s instead, give path: "${join(dir, 'chapters/3_methods.tex')}"`)
  })

  test('a folder beside a file of the same name does not hide the file', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'notes'))
    writeFileSync(join(dir, 'notes.txt'), 'Words.\n')
    const { list } = await aList()
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'notes' })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('is now held against thesis · notes')
  })

  test('a refusal that lists only some of a file’s headings says so, and how many there are', async () => {
    const { writeFileSync } = await import('node:fs')
    const headings = Array.from({ length: 30 }, (_, at) => `\\section{Part ${at}}\\label{sec:p${at}}\n\nWords.\n`)
    writeFileSync(join(dir, 'long.tex'), headings.join('\n'))
    const { list } = await aList()
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'long#sec:nope' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('long#sec:p23 — the first 24 of 30')
    expect(out.text).not.toContain('long#sec:p24')
  })

  test('a place whose id would be too long is refused for its length, not as a file that is not there', async () => {
    const name = 'a'.repeat(55)
    await aChapter(`.kehikot/paper/thesis/chapters/${name}.tex`)
    const { list } = await aList()
    const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: `chapters:${name}` })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('is on disk')
    expect(out.text).toContain('at most 80 characters')
    expect(out.text).not.toContain('names no file')
    const heading = await tool('hold_checklist', {
      checklist: list,
      epic: 'thesis',
      section: `chapters:${'a'.repeat(30)}#sec:meth-design`,
    })
    expect(heading.text).toContain('names no file')
    await aChapter(`.kehikot/paper/thesis/chapters/${'b'.repeat(40)}.tex`)
    const tooLong = await tool('hold_checklist', {
      checklist: list,
      epic: 'thesis',
      section: `chapters:${'b'.repeat(40)}#sec:meth-design`,
    })
    expect(tooLong.isError).toBe(true)
    expect(tooLong.text).toContain('at most 80 characters')
  })

  test('the page’s door holds to the same standard: a new hold names something on disk, a stored one stays usable', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { change, targetsOf } = await import('../list/checklists.ts')
    const { list, item } = await aList()
    const post = (body: Record<string, unknown>) =>
      answer('POST', '/api/checklist', query, { project: dir, id: list, epic: 'thesis', ...body }, TICKET)

    const typo = post({ op: 'hold', section: 'chapters:3_methods' })
    expect(typo?.status).toBe(400)
    expect((typo?.body as { error: string }).error).toContain('names no file or heading')
    expect(post({ op: 'tick', item, section: 'chapters:3_methods#sec:nope', done: true })?.status).toBe(400)
    expect(targetsOf(list, dir)).toEqual([])

    /* The whole paper and a reference are not places in a file, and pass. */
    expect((post({ op: 'hold' })?.body as { ok: boolean }).ok).toBe(true)
    expect((post({ op: 'hold', epic: undefined, ref: 'gh#105' })?.body as { ok: boolean }).ok).toBe(true)

    /* What the outline offers is on disk, by the project's own spelling —
       taken as pressed even when the paper's folder has a file of that name. */
    await aChapter('chapters/3_methods.tex')
    await aChapter('.kehikot/paper/thesis/chapters/3_methods.tex')
    expect((post({ op: 'hold', section: 'chapters:3_methods#sec:meth-design' })?.body as { ok: boolean }).ok).toBe(true)
    expect(targetsOf(list, dir).map((row) => row.target)).toContainEqual({
      kind: 'paper',
      epic: 'thesis',
      section: 'chapters:3_methods#sec:meth-design',
    })

    /* A target stored before any of this, naming nothing on disk. */
    const stale = { kind: 'paper' as const, epic: 'thesis', section: 'sec:dependencies' }
    change({ op: 'hold', id: list, target: stale, by: 'a test' }, dir)
    const ticked = post({ op: 'tick', item, section: 'sec:dependencies', done: true })
    expect((ticked?.body as { ok: boolean }).ok).toBe(true)
    expect(targetsOf(list, dir).find((row) => row.target.kind === 'paper' && row.target.section === 'sec:dependencies')?.done).toBe(1)
    expect((post({ op: 'release', section: 'sec:dependencies' })?.body as { ok: boolean }).ok).toBe(true)
    expect(targetsOf(list, dir).some((row) => row.target.kind === 'paper' && row.target.section === 'sec:dependencies')).toBe(false)
  })

  test('an id names its file through folders whose names the id respells', async () => {
    await aChapter('My Thesis/ch/1.tex')
    await aChapter('My Thesis/Part One/2.tex')
    const { list } = await aList()
    const file = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'My-Thesis:ch:1' })
    expect(file.isError).toBe(false)
    expect(file.text).toContain('is now held against thesis · My-Thesis:ch:1')
    const heading = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'My-Thesis:ch:1#sec:meth-design' })
    expect(heading.text).toContain('is now held against thesis · My-Thesis:ch:1#sec:meth-design')
    const nested = await tool('hold_checklist', {
      checklist: list,
      epic: 'thesis',
      section: 'My-Thesis:Part-One:2#sec:meth-design',
    })
    expect(nested.isError).toBe(false)
    expect(nested.text).toContain('is now held against thesis · My-Thesis:Part-One:2#sec:meth-design')
    const typo = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'My-Thesis:Part-Two:2' })
    expect(typo.isError).toBe(true)
  })

  test('a heading is found in whichever of two files of one stem has it', async () => {
    const { writeFileSync } = await import('node:fs')
    await aChapter('pair.tex', 'sec:in-tex')
    writeFileSync(join(dir, 'pair.md'), '# Aims\n\nWords.\n')
    const { list } = await aList()
    for (const section of ['pair#sec:in-tex', 'pair#Aims']) {
      const out = await tool('hold_checklist', { checklist: list, epic: 'thesis', section })
      expect(out.isError).toBe(false)
      expect(out.text).toContain(`is now held against thesis · ${section}`)
    }
    const neither = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'pair#sec:nope' })
    expect(neither.isError).toBe(true)
    const whole = await tool('hold_checklist', { checklist: list, epic: 'thesis', section: 'pair' })
    expect(whole.text).toContain('is now held against thesis · pair')
    expect(whole.text).not.toContain('was taken')
  })

  test('the page’s door holds what the outline offers in a folder with a space, and in either file of one stem', async () => {
    const { writeFileSync } = await import('node:fs')
    const { TICKET, answer } = await import('../doors.ts')
    const { targetsOf } = await import('../list/checklists.ts')
    const { list } = await aList()
    await aChapter('My Thesis/ch/1.tex')
    await aChapter('My Thesis/Part One/2.tex')
    await aChapter('pair.tex', 'sec:in-tex')
    writeFileSync(join(dir, 'pair.md'), '# Aims\n\nWords.\n')
    const pressed = [
      'My-Thesis:ch:1',
      'My-Thesis:ch:1#sec:meth-design',
      'My-Thesis:Part-One:2#sec:meth-design',
      'pair#sec:in-tex',
      'pair#Aims',
    ]
    for (const section of pressed) {
      const held = answer('POST', '/api/checklist', query, { op: 'hold', project: dir, id: list, epic: 'thesis', section }, TICKET)
      expect((held?.body as { ok: boolean }).ok).toBe(true)
    }
    expect(targetsOf(list, dir).map((row) => (row.target.kind === 'paper' ? row.target.section : null)).sort()).toEqual(
      [...pressed].sort(),
    )
  })

  test('hold_checklist with nothing to hold against is refused and told what a target is', async () => {
    const { list } = await aList()
    const out = await tool('hold_checklist', { checklist: list })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('needs to say WHAT to hold the list against')
  })

  test('checklist_for says whose work a list is for, and touches neither its targets nor its ticks (Jalez/kehikko-checklist#15)', async () => {
    const { list, item } = await aList('What a screenplay owes its learner')
    await tool('check_item', { checklist: list, item, ref: 'gh#105' })
    const out = await tool('checklist_for', { checklist: list, module: 'kehikot.screenplay' })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('is for kehikot.screenplay’s work')
    expect((await tool('checklists', {})).text).toContain('for kehikot.screenplay’s work; held against gh#105')
    expect((await tool('checklists', { checklist: list, ref: 'gh#105' })).text).toContain('1/1 ticked')

    const { answer } = await import('../doors.ts')
    const here = answer('GET', '/api/here', asking({ refs: 'gh#105' }), null, null)
    const instances = (here?.body as { instances: { checklist: { for?: string }; done: number }[] }).instances
    expect(instances).toHaveLength(1)
    expect(instances[0]?.checklist.for).toBe('kehikot.screenplay')
    expect(instances[0]?.done).toBe(1)

    const back = await tool('checklist_for', { checklist: list, module: null })
    expect(back.isError).toBe(false)
    expect(back.text).toContain('is for every module’s work again')
    expect((await tool('checklists', {})).text).not.toContain('’s work;')
  })

  test('a module that is not a name is refused, and the list stays every module’s', async () => {
    const { list } = await aList()
    const out = await tool('checklist_for', { checklist: list, module: 'the slides' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('that is not a module')
    expect((await tool('checklists', {})).text).not.toContain('’s work;')
  })

  test('a module is stored in the one form ids are compared in, whichever way it was spelled', async () => {
    registered('kehikot.screenplay.json', 'roadmap.slides.json', 'kehikot.checklist.json', 'notes.txt', 'Not A Module.json')
    const { checklists } = await import('../list/checklists.ts')
    const { list } = await aList()
    const whose = () => checklists(dir).lists[0]?.for

    /* The short name a row prints, typed back. */
    expect((await tool('checklist_for', { checklist: list, module: 'screenplay' })).text).toContain('is for kehikot.screenplay’s work')
    expect(whose()).toBe('kehikot.screenplay')
    /* An id from before the rename, and a registration still filed under one. */
    expect((await tool('checklist_for', { checklist: list, module: 'roadmap.slides' })).isError).toBe(false)
    expect(whose()).toBe('kehikot.slides')

    /* Shaped like an id and not here: kept, and the answer says what follows. */
    const absent = await tool('checklist_for', { checklist: list, module: 'kehikot.narration' })
    expect(absent.isError).toBe(false)
    expect(absent.text).toContain('No module by that id is among the ones here (kehikot.screenplay, kehikot.slides)')
    expect(absent.text).toContain('the list stays in front whatever is picked out')
    expect(whose()).toBe('kehikot.narration')

    /* Not shaped like one: refused, with the modules that are here. This app is never one of them. */
    const refused = await tool('checklist_for', { checklist: list, module: 'Screen_Play' })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('that is not a module')
    expect(refused.text).toContain('The modules here are: kehikot.screenplay, kehikot.slides.')
    expect(whose()).toBe('kehikot.narration')
  })

  test('only an explicit null clears it: a module left out, empty or not a string is refused, as on the page', async () => {
    registered('kehikot.slides.json')
    const { checklists } = await import('../list/checklists.ts')
    const { list } = await aList()
    await tool('checklist_for', { checklist: list, module: 'kehikot.slides' })
    for (const module of [undefined, '', '   ', 42, false, ['kehikot.slides']]) {
      const out = await tool('checklist_for', { checklist: list, module })
      expect(out.isError).toBe(true)
      expect(out.text).toContain('checklist_for needs module')
      expect(out.text).toContain('The modules here are: kehikot.slides.')
      expect(checklists(dir).lists[0]?.for).toBe('kehikot.slides')
    }
    expect((await tool('checklist_for', { checklist: list, module: null })).isError).toBe(false)
    expect(checklists(dir).lists[0]?.for).toBeUndefined()
  })

  test('the page’s door reads a module against what its host reported, and the registry', async () => {
    registered('kehikot.slides.json')
    const { answer, TICKET } = await import('../doors.ts')
    const { list } = await aList()
    const post = (module: unknown, present?: unknown) =>
      answer('POST', '/api/checklist', query, { project: dir, op: 'for', id: list, module, present }, TICKET)
    const whose = (reply: ReturnType<typeof post>) => (reply?.body as { held: { checklist: { for?: string } } }).held.checklist.for
    expect(whose(post('screenplay', ['kehikot.screenplay', 'kehikot.paper']))).toBe('kehikot.screenplay')
    expect(whose(post('slides', 'not a list'))).toBe('kehikot.slides')
    const refused = post('Screen_Play', ['kehikot.paper', 7, 'Nope!'])?.body as { ok: boolean; error: string }
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('The modules here are: kehikot.paper, kehikot.slides.')
  })

  test('a list stored before a list could say whose work it is for is every module’s, and its file is not rewritten', async () => {
    const { readFileSync } = await import('node:fs')
    const { checklists, checklistsFile } = await import('../list/checklists.ts')
    const { list } = await aList()
    const file = checklistsFile(dir)!
    const before = readFileSync(file, 'utf8')
    expect(before).not.toContain('"for"')
    const [summary] = checklists(dir).lists
    expect(summary?.id).toBe(list)
    expect(summary?.for).toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('the page’s door sets and clears it, and refuses an empty module rather than clearing', async () => {
    const { answer, TICKET } = await import('../doors.ts')
    const { list } = await aList()
    const post = (module: unknown) => answer('POST', '/api/checklist', query, { project: dir, op: 'for', id: list, module }, TICKET)
    expect((post('kehikot.slides')?.body as { held: { checklist: { for?: string } } }).held.checklist.for).toBe('kehikot.slides')
    expect(post('')?.status).toBe(400)
    expect((post(null)?.body as { held: { checklist: { for?: string } } }).held.checklist.for).toBeUndefined()
  })

  test('a tick against a target the list is not held against holds it, and the agent is told', async () => {
    const { list, item } = await aList()
    const out = await tool('check_item', { checklist: list, item, ref: 'gh#105' })
    expect(out.text).toContain('is now held against gh#105')
    const listed = await tool('checklists', {})
    expect(listed.text).toContain('held against gh#105')
  })

  test('a tick with no target is refused in a sentence that says why there is nothing to record', async () => {
    const { list, item } = await aList()
    const out = await tool('check_item', { checklist: list, item })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('needs to say WHAT is being ticked off')
  })

  test('a position that is not a number is refused rather than read as 1', async () => {
    /* A tool that silently reordered somebody's list would be worse than one that
       failed. */
    const { list, item } = await aList()
    const out = await tool('move_checklist_item', { checklist: list, item, position: 'up' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('Nothing was moved')
  })

  test('a checklist id that is not here is refused with what to do instead', async () => {
    const out = await tool('add_checklist_item', { checklist: 'nope', text: 'something' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('there is no checklist "nope" here')
  })

  test('an item id that is not on the list is refused, and says ids do not move', async () => {
    const { list } = await aList()
    const out = await tool('drop_checklist_item', { checklist: list, item: 'nope' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('not by their words or their position')
  })

  test('adding an item with no text is refused rather than adding an empty line', async () => {
    const { list } = await aList()
    const out = await tool('add_checklist_item', { checklist: list, text: '   ' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('needs text')
  })

  test('creating a checklist with no name is refused, because the name is what says what it is for', async () => {
    const out = await tool('create_checklist', { name: '' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('needs a name')
  })

  test('a second checklist with the same name is refused, and the refusal carries the id of the first', async () => {
    await tool('create_checklist', { name: 'What a change owes' })
    const again = await tool('create_checklist', { name: 'what a CHANGE owes' })
    expect(again.isError).toBe(true)
    expect(again.text).toContain('there is already a checklist called')
  })

  test('rewording an item keeps its id and every tick on it, against every target', async () => {
    const { list, item } = await aList()
    await tool('check_item', { checklist: list, item, ref: 'gh#105' })
    await tool('check_item', { checklist: list, item, ref: 'gh#106' })
    await tool('reword_checklist_item', { checklist: list, item, text: 'A test that fails without it' })
    const one = await tool('checklists', { checklist: list, ref: 'gh#105' })
    const two = await tool('checklists', { checklist: list, ref: 'gh#106' })
    expect(one.text).toContain('1/1 ticked')
    expect(two.text).toContain('1/1 ticked')
    expect(one.text).toContain('A test that fails without it')
  })

  test('dropping an item takes its ticks with it, on every target', async () => {
    const { list, item } = await aList()
    await tool('check_item', { checklist: list, item, ref: 'gh#105' })
    const out = await tool('drop_checklist_item', { checklist: list, item })
    expect(out.text).toContain('along with the tick on it')
    const back = await tool('checklists', { checklist: list, ref: 'gh#105' })
    expect(back.text).toContain('no items yet')
  })

  test('asking about a list with no target is a question, not a refusal', async () => {
    const { list } = await aList()
    const out = await tool('checklists', { checklist: list })
    expect(out.isError).toBe(false)
    expect(out.text).toContain('no target named')
  })

  test('a target given and spelled wrong IS refused, so a typo cannot become no target', async () => {
    const { list } = await aList()
    const out = await tool('checklists', { checklist: list, ref: 'gh# 105' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('not a target')
  })

  test('with nothing created, the tool says so in words rather than answering with nothing', async () => {
    const out = await tool('checklists', {})
    /* The project is named in the sentence, which is new and is the point: with
       the store inside the project, "there is nothing here" is only meaningful
       if it says where "here" is. */
    expect(out.text).toContain('There are no checklists in')
    expect(out.text).toContain(dir)
  })

  test('a call names the target it was about, so the page can announce it under the right epic', async () => {
    const { forgetEverything, since } = await import('../list/outbox.ts')
    forgetEverything()
    const { list, item } = await aList()
    await tool('check_item', { checklist: list, item, epic: 'modes-are-modules' })
    const said = since(0).announcements.at(-1)
    expect(said?.epic).toBe('modes-are-modules')
    expect(said?.message).toContain('modes-are-modules (the paper)')
  })

  test('a call about a ref names no epic, and carries the ref instead', async () => {
    const { forgetEverything, since } = await import('../list/outbox.ts')
    forgetEverything()
    const { list, item } = await aList()
    await tool('check_item', { checklist: list, item, ref: 'gh#105' })
    const said = since(0).announcements.at(-1)
    expect(said?.epic).toBeNull()
    expect(said?.refs).toEqual(['gh#105'])
  })

  test('a refusal is announced too, because a panel showing only wins is the least useful half', async () => {
    const { forgetEverything, since } = await import('../list/outbox.ts')
    forgetEverything()
    const out = await tool('add_checklist_item', { checklist: 'nope', text: 'x' })
    expect(out.isError).toBe(true)
    expect(since(0).announcements).toHaveLength(1)
  })
})

describe('the page’s door, for a tracker fact (Jalez/kehikko-checklist#1)', () => {
  test('cite names one of the facts, or none, and refuses a word that is not one', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { list, item } = await aList()
    const bad = answer('POST', '/api/checklist', query, { op: 'cite', id: list, item, fact: 'vibes', project: dir }, TICKET)
    expect(bad?.status).toBe(400)
    const good = answer('POST', '/api/checklist', query, { op: 'cite', id: list, item, fact: 'pipeline', project: dir }, TICKET)
    expect((good?.body as { ok: boolean }).ok).toBe(true)
    const cleared = answer('POST', '/api/checklist', query, { op: 'cite', id: list, item, fact: null, project: dir }, TICKET)
    expect((cleared?.body as { said: string }).said).toContain('names no tracker fact')
  })

  test('a tick keeps well-formed evidence and is not refused for a malformed one', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const { held } = await import('../list/checklists.ts')
    const { list, item } = await aList()
    answer('POST', '/api/checklist', query, { op: 'cite', id: list, item, fact: 'labels', project: dir }, TICKET)
    const evidence = { fact: 'labels' as const, said: 'labels: tested', print: 'labels: tested', read: '2026-10-05T10:00:00Z' }
    answer('POST', '/api/checklist', query, { op: 'tick', id: list, item, ref: 'gh#41', evidence, project: dir }, TICKET)
    expect(held(list, { kind: 'ref', ref: 'gh#41' }, dir).held!.rows[0]!.done!.evidence).toEqual({ ...evidence, sha: null })

    const odd = answer('POST', '/api/checklist', query, { op: 'tick', id: list, item, ref: 'gh#42', evidence: { fact: 'vibes' }, project: dir }, TICKET)
    expect((odd?.body as { ok: boolean }).ok).toBe(true)
    expect(held(list, { kind: 'ref', ref: 'gh#42' }, dir).held!.rows[0]!.done!.evidence).toBeUndefined()
  })

  test('an agent reading the list is told which fact an item is checked against', async () => {
    const { list, item } = await aList()
    const { change } = await import('../list/checklists.ts')
    change({ op: 'cite', id: list, item, fact: 'pipeline', by: 'a test' }, dir)
    const out = await tool('checklists', { checklist: list, ref: '!7' })
    expect(out.text).toContain('[evidence: the tracker\'s pipeline]')
  })
})

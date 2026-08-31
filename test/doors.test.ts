import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-doors-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

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

describe('reads', () => {
  test('the health check answers with this module’s own name', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('GET', '/healthz', query, null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe('roadmap.checklist')
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
    answer(
      'POST',
      '/api/checklist',
      query,
      { op: 'tick', id: list, item, epic: 'modes-are-modules', section: 'ch:bridge', done: true, project: dir },
      TICKET,
    )
    const whole = answer('GET', '/api/checklist', asking({ id: list, epic: 'modes-are-modules' }), null, null)
    const part = answer(
      'GET',
      '/api/checklist',
      asking({ id: list, epic: 'modes-are-modules', section: 'ch:bridge' }),
      null,
      null,
    )
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

  test('lists exactly the seven tools this app now has', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const names = (reply?.body as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)
    expect(names).toEqual([
      'checklists',
      'create_checklist',
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

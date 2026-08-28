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
let dir = ''
const query = new URLSearchParams()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-doors-'))
  process.env.CHECKLIST_DATA = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHECKLIST_DATA
})

describe('reads', () => {
  test('the health check answers with this module’s own name', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('GET', '/healthz', query, null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe('roadmap.checklist')
  })

  test('the lists are readable with no ticket, because a checklist is not a secret', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('GET', '/api/lists', query, null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { lists: unknown[] }).lists).toHaveLength(2)
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
})

describe('writes', () => {
  test('are refused without the ticket this process handed out with the page', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/tick', query, { ref: '!1', item: 'agreed', done: true }, 'not-the-ticket')
    expect(reply?.status).toBe(403)
    expect((reply?.body as { error: string }).error).toContain('did not come from this app’s own page')
  })

  test('with the ticket, the owner’s item can be ticked and read back', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/tick', query, { ref: 'gh#131', item: 'agreed', done: true }, TICKET)
    expect(reply?.status).toBe(200)
    const body = reply?.body as { ok: boolean; standing: { rows: { id: string; state: string }[] } }
    expect(body.ok).toBe(true)
    expect(body.standing.rows.find((r) => r.id === 'agreed')?.state).toBe('done')
  })

  test('the page may not tick a derived item, and is told which of the two it met', async () => {
    /* The page and the MCP door admit different kinds and refuse in their own
       words. Both refusals name a remedy, because the two kinds have opposite
       ones — fix the change, or let an agent assert it. */
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/tick', query, { ref: '!1848', item: 'pipeline' }, TICKET)
    expect(reply?.status).toBe(403)
    expect((reply?.body as { error: string }).error).toContain('read from the tracker')
  })

  test('the page may not tick an agent item either', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/tick', query, { ref: '!1848', item: 'solved' }, TICKET)
    expect(reply?.status).toBe(403)
    expect((reply?.body as { error: string }).error).toContain('under its own name')
  })
})

describe('standings', () => {
  test('remember what they were shown, and answer for every ref asked about', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer(
      'POST',
      '/api/standings',
      query,
      {
        from: 'a host framing this page',
        refs: [
          {
            ref: '!1848',
            shape: 'change',
            state: { state: 'opened', title: 'x', at: 'x', url: 'https://x', pipeline: 'success' },
          },
          /* No state at all: somebody picked a reference the open epic's reading
             does not contain. An ordinary state, and it must come back as a
             standing rather than silently not appear. */
          { ref: 'gh#999', shape: 'change', state: null },
        ],
      },
      TICKET,
    )
    const body = reply?.body as { standings: { ref: string; rows: { id: string; state: string }[] }[] }
    expect(body.standings.map((s) => s.ref)).toEqual(['!1848', 'gh#999'])
    expect(body.standings[0]?.rows.find((r) => r.id === 'pipeline')?.state).toBe('done')
    expect(body.standings[1]?.rows.find((r) => r.id === 'pipeline')?.state).toBe('unasked')
  })

  test('a shape nobody may claim is discarded rather than trusted', async () => {
    /* `unsettled` is a conclusion this app reaches by not knowing, not a claim
       anyone can make on its behalf — accepting it would let a caller silently
       overrule a settled `!1848`. */
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/standings', query, { refs: [{ ref: '!1848', shape: 'unsettled' }] }, TICKET)
    expect((reply?.body as { standings: { shape: string }[] }).standings[0]?.shape).toBe('change')
  })
})

describe('the agent’s door', () => {
  test('is not held to the page’s ticket, because an MCP client has no page', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const tools = (reply?.body as { result: { tools: { name: string }[] } }).result.tools
    expect(tools.map((t) => t.name)).toEqual(['mr_checklist', 'check_mr'])
  })

  test('refuses an agent the owner’s item, and says who ticks it and where', async () => {
    /* The whole of the gate. An item asking whether a person has agreed to
       something, which the party doing the asking can tick, is a formality with a
       box beside it. */
    const { answer } = await import('../doors.ts')
    const reply = answer(
      'POST',
      '/mcp',
      query,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_mr', arguments: { ref: 'gh#131', item: 'agreed' } } },
      null,
    )
    const result = (reply?.body as { result: { content: { text: string }[]; isError?: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("is the owner's to tick, on this app's own page")
  })

  test('a tool nobody has does not become a TypeError out of a request handler', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer(
      'POST',
      '/mcp',
      query,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'constructor', arguments: {} } },
      null,
    )
    const result = (reply?.body as { result: { content: { text: string }[]; isError?: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('no tool "constructor" here')
  })

  test('an agent can tick its own half, and is told what is left', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer(
      'POST',
      '/mcp',
      query,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'check_mr', arguments: { ref: '!1848', item: 'solved', agent: 'a test' } },
      },
      null,
    )
    const text = (reply?.body as { result: { content: { text: string }[] } }).result.content[0]?.text ?? ''
    expect(text).toContain('!1848: solved ticked.')
    expect(text).toContain('Still yours to do:')
  })
})

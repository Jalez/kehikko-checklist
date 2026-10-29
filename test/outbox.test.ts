import { beforeEach, describe, expect, test } from 'bun:test'

import { announce, forgetEverything, since } from '../list/outbox.ts'

/**
 * The join between the door and the wire.
 *
 * Worth its own tests because it is a queue with a cursor, and both of the
 * failures a queue with a cursor has are silent: replaying — which shows an
 * agent's one tool call twice on somebody's panel — and a cursor walked
 * backwards by a trim, which replays everything.
 */

beforeEach(forgetEverything)

const call = (tool: string, epic: string | null = null) =>
  announce({ tool, refs: [], epic, message: `an agent called ${tool}`, level: 'info' })

describe('the cursor', () => {
  test('a reader that has never asked gets everything so far', () => {
    call('checklists')
    call('check_item')
    expect(since(0).announcements.map((a) => a.tool)).toEqual(['checklists', 'check_item'])
  })

  test('asking again from the cursor gets nothing, rather than the same rows twice', () => {
    call('checklists')
    const first = since(0)
    /* The failure this prevents: one tool call drawn twice on a panel is
       indistinguishable from the agent having done the thing twice. */
    expect(since(first.cursor).announcements).toEqual([])
  })

  test('only what happened since is handed over', () => {
    call('a')
    const seen = since(0).cursor
    call('b')
    expect(since(seen).announcements.map((a) => a.tool)).toEqual(['b'])
  })
})

describe('the bound', () => {
  test('the queue stops growing and the oldest go', () => {
    for (let i = 0; i < 200; i += 1) call(`tool${i}`)
    const out = since(0)
    /* Bounded because an agent can call the door faster than a page is told,
       and a program somebody leaves running for a week must not grow a queue
       for the whole week. */
    expect(out.announcements.length).toBeLessThanOrEqual(64)
    expect(out.announcements.at(-1)?.tool).toBe('tool199')
    expect(out.dropped).toBeGreaterThan(0)
  })

  test('the cursor keeps rising past a trim, so a trim does not replay everything', () => {
    for (let i = 0; i < 200; i += 1) call(`tool${i}`)
    const out = since(0)
    /* The highest seq handed out, not the queue's length. Using the length here
       would walk the cursor backwards on every trim, and the page would emit the
       whole queue again every time its stream opened — forever. */
    expect(out.cursor).toBe(200)
    expect(since(out.cursor).announcements).toEqual([])
  })
})

describe('the page’s stream', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

  test('opens with the backlog after its cursor, then each announcement as the door writes it down, once', async () => {
    const { EVENTS_PATH } = await import('../list/outbox.ts')
    const { stream } = await import('../doors.ts')
    call('before-one')
    call('before-two')
    /* Told on a microtask, to nobody yet. */
    await settle()
    const heard: { announcements: { seq: number; tool: string }[]; cursor: number }[] = []
    const live = stream('GET', EVENTS_PATH, new URLSearchParams({ since: '1' }), (told) => heard.push(told as (typeof heard)[number]), null)
    if (!live || !('close' in live)) throw new Error('the stream did not open')
    await settle()
    expect(heard).toHaveLength(1)
    expect(heard[0]!.announcements.map((a) => a.tool)).toEqual(['before-two'])
    expect(heard[0]!.cursor).toBe(2)

    call('during')
    await settle()
    expect(heard).toHaveLength(2)
    expect(heard[1]).toMatchObject({ announcements: [{ seq: 3, tool: 'during' }], cursor: 3 })

    live.close()
    call('after')
    await settle()
    expect(heard).toHaveLength(2)
  })

  test('with no cursor it opens on the seek: where the outbox is, and nothing in it', async () => {
    const { EVENTS_PATH } = await import('../list/outbox.ts')
    const { stream } = await import('../doors.ts')
    call('old')
    await settle()
    const heard: unknown[] = []
    const live = stream('GET', EVENTS_PATH, new URLSearchParams(), (told) => heard.push(told), null)
    await settle()
    expect(heard).toEqual([{ announcements: [], cursor: 1, dropped: 0 }])
    if (live && 'close' in live) live.close()
    expect(stream('GET', '/api/announcements', new URLSearchParams(), () => {}, null)).toBeNull()
  })

  test('an agent’s tool call through the MCP door is told on the stream, after its work is done', async () => {
    const { EVENTS_PATH } = await import('../list/outbox.ts')
    const { stream, answer } = await import('../doors.ts')
    const heard: { announcements: { tool: string }[] }[] = []
    const live = stream('GET', EVENTS_PATH, new URLSearchParams({ since: '0' }), (told) => heard.push(told as (typeof heard)[number]), null)
    await settle()
    await answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'checklists', arguments: {} } }, null)
    await settle()
    expect(heard.at(-1)?.announcements.map((a) => a.tool)).toEqual(['checklists'])
    if (live && 'close' in live) live.close()
  })
})

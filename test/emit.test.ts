import { afterEach, describe, expect, test } from 'bun:test'

import { pump } from '../src/wire/emit.ts'

/**
 * The pump, tested with a stubbed door and a stubbed host.
 *
 * Worth its own tests because the two failures it can have are both invisible
 * from either end. It emits the wrong number of times, or it emits the right
 * number under the wrong epic, and in both cases every program involved carries
 * on working while somebody's notification panel says something untrue.
 *
 * `fetch` is stubbed rather than served, and `request` is a function passed in,
 * so nothing here needs a browser or a port.
 */

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/** A door holding `announcements`, answering the cursor protocol properly. */
function door(rows: { seq: number; tool: string; refs: string[]; message: string; level: string }[]) {
  const asked: number[] = []
  globalThis.fetch = (async (url: string) => {
    const since = Number(new URL(url, 'http://x').searchParams.get('since') ?? '0')
    asked.push(since)
    return {
      json: async () => ({
        ok: true,
        announcements: rows.filter((r) => r.seq > since),
        cursor: rows.length ? rows[rows.length - 1]!.seq : 0,
        dropped: 0,
      }),
    }
  }) as unknown as typeof fetch
  return asked
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    tool: 'checklists',
    refs: [`gh#${i}`],
    message: `an agent called checklists on a checklist`,
    level: 'info',
  }))

function recorder() {
  const sent: { method: string; params: Record<string, unknown> }[] = []
  return {
    sent,
    request: async (method: string, params: Record<string, unknown>) => {
      sent.push({ method, params })
      return null
    },
  }
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))

describe('a page that has just loaded', () => {
  test('seeks to the end and announces nothing it was not there for', async () => {
    door(rows(3))
    const host = recorder()
    const stop = pump(host.request, () => 'modes-are-modules', 5)
    await settle()
    stop()

    /*
     * The bug this exists to prevent, and it was measured before it was fixed:
     * a fresh page starting at cursor 0 re-emits the whole outbox, so every
     * reload of the host announced every MCP call the process had ever seen,
     * again. One tool call, three reloads, six lines on the panel — which reads
     * exactly like an agent having done the same thing six times.
     */
    expect(host.sent).toHaveLength(0)
  })

  test('announces what happens AFTER it has loaded', async () => {
    const all = rows(2)
    const visible = [...all]
    door(visible)
    const host = recorder()
    const stop = pump(host.request, () => 'modes-are-modules', 5)
    await settle()
    /* An agent calls the door now, with the page already up. */
    visible.push({ seq: 3, tool: 'check_item', refs: [], message: 'an agent called check_item on the checklist', level: 'info' })
    await settle()
    stop()

    expect(host.sent).toHaveLength(1)
    expect(host.sent[0]!.method).toBe('events.emit')
    expect((host.sent[0]!.params.payload as { message: string }).message).toContain('check_item')
  })
})

describe('what is emitted', () => {
  test('the format is named and the epic is the canvas’s, not the door’s', async () => {
    const visible = rows(0)
    door(visible)
    const host = recorder()
    const stop = pump(host.request, () => 'modes-are-modules', 5)
    await settle()
    visible.push({ seq: 1, tool: 'checklists', refs: ['gh#41'], message: 'called', level: 'info' })
    await settle()
    stop()

    const { extension, payload } = host.sent[0]!.params as {
      extension: string
      payload: { epic: string; refs: string[] }
    }
    expect(extension).toBe('roadmap.notifications@1')
    /* The door has no idea which epic anything is about — an agent calls it with
       a ref, and a ref is not an epic. The page does, from `roadmap.context`. */
    expect(payload.epic).toBe('modes-are-modules')
    expect(payload.refs).toEqual(['gh#41'])
  })

  test('nothing is emitted when the canvas is on no epic, and nothing is invented', async () => {
    const visible = rows(0)
    door(visible)
    const host = recorder()
    const stop = pump(host.request, () => null, 5)
    await settle()
    visible.push({ seq: 1, tool: 'checklists', refs: [], message: 'called', level: 'info' })
    await settle()
    stop()

    /* `roadmap.notifications@1` files a line under an epic. A placeholder slug
       would put lines on a shared panel under an epic nobody chose, which is
       worse than silence: wrong rather than missing. */
    expect(host.sent).toHaveLength(0)
  })

  test('a refused emit is not retried, so a rate limit does not become a loop', async () => {
    const visible = rows(0)
    door(visible)
    const sent: unknown[] = []
    const stop = pump(
      async (_m, p) => {
        sent.push(p)
        throw new Error('this canvas carries at most 5 events a second from one module')
      },
      () => 'modes-are-modules',
      5,
    )
    await settle()
    visible.push({ seq: 1, tool: 'checklists', refs: [], message: 'called', level: 'info' })
    await settle(60)
    stop()

    /* Exactly once. An event held back until the storm passed would arrive
       describing the past — which is why the host refuses rather than queues,
       and why this must not undo that by retrying. */
    expect(sent).toHaveLength(1)
  })
})

describe('stopping', () => {
  test('nothing is emitted after the connection has gone', async () => {
    const visible = rows(0)
    door(visible)
    const host = recorder()
    const stop = pump(host.request, () => 'modes-are-modules', 5)
    await settle()
    stop()
    visible.push({ seq: 1, tool: 'checklists', refs: [], message: 'called', level: 'info' })
    await settle(40)

    expect(host.sent).toHaveLength(0)
  })
})

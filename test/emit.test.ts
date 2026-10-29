import { afterEach, describe, expect, test } from 'bun:test'

import { pump, type Listen, type Told } from '../src/wire/emit.ts'

/**
 * The pump, tested with a stubbed stream and a stubbed host.
 *
 * Worth its own tests because the two failures it can have are both invisible
 * from either end. It emits the wrong number of times, or it emits the right
 * number under the wrong epic, and in both cases every program involved carries
 * on working while somebody's notification panel says something untrue.
 *
 * The stream is a function passed in, as is the seek and `request`, so nothing
 * here needs a browser or a port. `outbox` below answers as the server does:
 * the backlog after `since` as a stream opens, then each announcement.
 */

type Row = { seq: number; tool: string; refs: string[]; message: string; level: string; epic?: string | null }

/** An outbox, a seek and a stream over it, answering the cursor protocol as `list/outbox.ts` does. */
function outbox(start: Row[] = []) {
  const rows = [...start]
  const opened: Record<string, string>[] = []
  const lines = new Set<(told: Told) => void>()
  const cursor = () => (rows.length ? rows[rows.length - 1]!.seq : 0)
  const hear: Listen = (query, onTold) => {
    opened.push({ ...query })
    lines.add(onTold)
    const since = query.since === undefined ? null : Number(query.since)
    queueMicrotask(() => onTold(since === null ? { announcements: [], cursor: cursor() } : { announcements: rows.filter((r) => r.seq > since), cursor: cursor() }))
    return () => void lines.delete(onTold)
  }
  return {
    rows,
    opened,
    hear,
    seek: async () => cursor(),
    lines,
    /** The door writing one down, and the server publishing it. */
    add(row: Omit<Row, 'seq'>) {
      const one = { seq: cursor() + 1, ...row }
      rows.push(one)
      for (const line of lines) line({ announcements: [one], cursor: one.seq })
    },
    /** The line dropping and coming back: the stream opens again with the same address. */
    reopen() {
      const query = opened.at(-1)!
      const line = [...lines].at(-1)!
      const since = Number(query.since)
      line({ announcements: rows.filter((r) => r.seq > since), cursor: cursor() })
    },
  }
}

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ seq: i + 1, tool: 'checklists', refs: [`gh#${i}`], message: 'an agent called checklists on a checklist', level: 'info' }))

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

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms))
const call = (tool = 'check_item', refs: string[] = []) => ({ tool, refs, message: `an agent called ${tool} on the checklist`, level: 'info' })

let stops: (() => void)[] = []
afterEach(() => {
  stops.forEach((stop) => stop())
  stops = []
})
const start = (...args: Parameters<typeof pump>) => {
  const stop = pump(...args)
  stops.push(stop)
  return stop
}

describe('a page that has just loaded', () => {
  test('seeks to the end and announces nothing it was not there for', async () => {
    const box = outbox(rows(3))
    const host = recorder()
    start(host.request, () => 'modes-are-modules', undefined, box.hear, box.seek)
    await settle()

    /*
     * The bug this exists to prevent, and it was measured before it was fixed:
     * a fresh page starting at cursor 0 re-emits the whole outbox, so every
     * reload of the host announced every MCP call the process had ever seen,
     * again. One tool call, three reloads, six lines on the panel — which reads
     * exactly like an agent having done the same thing six times.
     */
    expect(host.sent).toHaveLength(0)
    /* And the stream is opened from where the outbox was. */
    expect(box.opened).toEqual([{ since: '3' }])
  })

  test('with nobody answering the seek, the stream’s first message is the seek, and it opens again from it', async () => {
    const box = outbox(rows(2))
    const host = recorder()
    start(host.request, () => 'modes-are-modules', undefined, box.hear, async () => null)
    await settle()
    expect(host.sent).toHaveLength(0)
    expect(box.opened).toEqual([{}, { since: '2' }])
    expect(box.lines.size).toBe(1)
    box.add(call())
    await settle()
    expect(host.sent).toHaveLength(1)
  })

  test('announces what happens AFTER it has loaded, once each, as it happens', async () => {
    const box = outbox(rows(2))
    const host = recorder()
    start(host.request, () => 'modes-are-modules', undefined, box.hear, box.seek)
    await settle()
    box.add(call())
    await settle()
    expect(host.sent).toHaveLength(1)
    expect(host.sent[0]!.method).toBe('events.emit')
    expect((host.sent[0]!.params.payload as { message: string }).message).toContain('check_item')
  })
})

describe('a line that drops and comes back', () => {
  test('what happened while it was down is delivered, and nothing heard already is emitted twice', async () => {
    const box = outbox()
    const host = recorder()
    start(host.request, () => 'modes-are-modules', undefined, box.hear, box.seek)
    await settle()
    box.add(call('first'))
    await settle()
    /* Down: written, and not sent to anybody. */
    const lines = [...box.lines]
    box.lines.clear()
    box.add(call('second'))
    box.add(call('third'))
    lines.forEach((line) => box.lines.add(line))
    /* Back: the stream opens with the backlog after the cursor in its address, which includes `first`. */
    box.reopen()
    await settle()
    expect(host.sent.map((one) => (one.params.payload as { message: string }).message)).toEqual([
      'an agent called first on the checklist',
      'an agent called second on the checklist',
      'an agent called third on the checklist',
    ])
  })

  test('a server that restarted counts from 1 again, and what it holds is new', async () => {
    const box = outbox(rows(5))
    const host = recorder()
    start(host.request, () => 'modes-are-modules', undefined, box.hear, box.seek)
    await settle()
    const line = [...box.lines][0]!
    line({ announcements: [{ seq: 1, ...call('after-restart') }], cursor: 1 })
    await settle()
    expect(host.sent).toHaveLength(1)
  })
})

describe('what is emitted', () => {
  test('the format is named and the epic is the canvas’s, not the door’s', async () => {
    const box = outbox()
    const host = recorder()
    start(host.request, () => 'modes-are-modules', undefined, box.hear, box.seek)
    await settle()
    box.add(call('checklists', ['gh#41']))
    await settle()

    const { extension, payload } = host.sent[0]!.params as { extension: string; payload: { epic: string; refs: string[] } }
    expect(extension).toBe('kehikot.notifications@1')
    /* The door has no idea which epic anything is about — an agent calls it with
       a ref, and a ref is not an epic. The page does, from `kehikot.context`. */
    expect(payload.epic).toBe('modes-are-modules')
    expect(payload.refs).toEqual(['gh#41'])
  })

  test('nothing is emitted when the canvas is on no epic, and nothing is invented', async () => {
    const box = outbox()
    const host = recorder()
    start(host.request, () => null, undefined, box.hear, box.seek)
    await settle()
    box.add(call('checklists'))
    await settle()
    /* `kehikot.notifications@1` files a line under an epic. A placeholder slug
       would put lines on a shared panel under an epic nobody chose, which is
       worse than silence: wrong rather than missing. */
    expect(host.sent).toHaveLength(0)
  })

  test('a refused emit is not retried, so a rate limit does not become a loop', async () => {
    const box = outbox()
    const sent: unknown[] = []
    start(
      async (_m, p) => {
        sent.push(p)
        throw new Error('this canvas carries at most 5 events a second from one module')
      },
      () => 'modes-are-modules',
      undefined,
      box.hear,
      box.seek,
    )
    await settle()
    box.add(call('checklists'))
    await settle(60)
    /* Exactly once. An event held back until the storm passed would arrive
       describing the past — which is why the host refuses rather than queues,
       and why this must not undo that by retrying. */
    expect(sent).toHaveLength(1)
  })

  test('the page is told of every batch, emitted or not, so it can read its own store again', async () => {
    const box = outbox()
    const heard: unknown[][] = []
    start(recorder().request, () => null, (batch) => heard.push(batch), box.hear, box.seek)
    await settle()
    box.add(call('add_checklist_item'))
    await settle()
    expect(heard).toHaveLength(1)
  })
})

describe('no clock', () => {
  test('the pump sets no timer of its own: it only hears', async () => {
    const realInterval = globalThis.setInterval
    const realTimeout = globalThis.setTimeout
    let timers = 0
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (timers++, realInterval(...args))) as typeof setInterval
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => (timers++, realTimeout(...args))) as typeof setTimeout
    try {
      const box = outbox()
      start(recorder().request, () => 'e', undefined, box.hear, box.seek)
      await Promise.resolve()
      await Promise.resolve()
      expect(timers).toBe(0)
    } finally {
      globalThis.setInterval = realInterval
      globalThis.setTimeout = realTimeout
    }
  })
})

describe('stopping', () => {
  test('nothing is emitted after the connection has gone, and the stream is closed', async () => {
    const box = outbox()
    const host = recorder()
    const stop = start(host.request, () => 'modes-are-modules', undefined, box.hear, box.seek)
    await settle()
    stop()
    expect(box.lines.size).toBe(0)
    box.add(call('checklists'))
    await settle()
    expect(host.sent).toHaveLength(0)
  })
})

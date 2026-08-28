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

const call = (tool: string) => announce({ tool, refs: [], message: `an agent called ${tool}`, level: 'info' })

describe('the cursor', () => {
  test('a reader that has never asked gets everything so far', () => {
    call('mr_checklist')
    call('check_mr')
    expect(since(0).announcements.map((a) => a.tool)).toEqual(['mr_checklist', 'check_mr'])
  })

  test('asking again from the cursor gets nothing, rather than the same rows twice', () => {
    call('mr_checklist')
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
    /* Bounded because an agent can call the door faster than a page polls it,
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
       whole queue again on its next poll — forever. */
    expect(out.cursor).toBe(200)
    expect(since(out.cursor).announcements).toEqual([])
  })
})

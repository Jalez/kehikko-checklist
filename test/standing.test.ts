import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RefState } from '../derive/ref-state.ts'

/**
 * Where a reference stands, and in particular the two absences this module
 * exists to keep apart.
 *
 * `unasked` is not `unknown`. One is a program that has not looked; the other is
 * a tracker that was read and had nothing to say. They send a reader to
 * completely different places — a pane nothing has selected into, versus a
 * repository with no checks configured — and flattening them would be a
 * statement about a tracker made by a program that has never spoken to one.
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-standing-'))
  process.env.CHECKLIST_DATA = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHECKLIST_DATA
})

const opened: RefState = {
  state: 'opened',
  title: 'A change',
  at: '2026-01-01T00:00:00.000Z',
  url: 'https://example.invalid/1',
}

describe('a reference nothing has ever been read about', () => {
  test('marks every derived item “not asked”, and never “pending”', async () => {
    const { standingFor } = await import('../derive/standing.ts')
    const s = standingFor('!1848')
    const derived = s.rows.filter((r) => r.kind === 'derived' && !r.exempt)
    expect(derived.length).toBeGreaterThan(0)
    expect(derived.every((r) => r.state === 'unasked')).toBe(true)
    /* Pending would accuse a change of a failing pipeline nobody has looked at. */
    expect(derived.some((r) => r.state === 'pending')).toBe(false)
    expect(s.seen).toBeNull()
    expect(s.cannotSee).toContain('Nothing has ever shown this app')
  })
})

describe('a reference a host has handed a reading for', () => {
  test('computes the derived items here, with no tracker and no credentials', async () => {
    const { remember } = await import('../list/ticks.ts')
    const { standingFor } = await import('../derive/standing.ts')
    remember('!1848', { ...opened, pipeline: 'success', conflicts: false, changesCount: '9' }, 'a host framing this page')
    const s = standingFor('!1848')
    const at = (id: string) => s.rows.find((r) => r.id === id)
    expect(at('pipeline')?.state).toBe('done')
    expect(at('conflicts')?.state).toBe('done')
    expect(at('size')?.state).toBe('done')
    /* Read but with nothing said about it. A DIFFERENT answer from the one
       above, and this is the line that proves the two are kept apart. */
    expect(at('discussions')?.state).toBe('unknown')
    expect(s.seen?.from).toBe('a host framing this page')
    expect(s.cannotSee).toBeNull()
  })

  test('a tick pinned to an older head reads stale rather than done or undone', async () => {
    const { remember, setTick } = await import('../list/ticks.ts')
    const { standingFor } = await import('../derive/standing.ts')
    remember('!1848', { ...opened, sha: 'newhead0000' }, 'a host framing this page')
    setTick({ ref: '!1848', item: 'reviewed', done: true, agent: 'an agent', sha: 'oldhead0000' })
    const row = standingFor('!1848').rows.find((r) => r.id === 'reviewed')
    expect(row?.state).toBe('stale')
    expect(row?.note).toContain('a review of the code before the fix is not a review of the fix')
  })
})

describe('what a caller may assert about a reference', () => {
  test('a GitHub number nobody has classified shows BOTH lists rather than guessing', async () => {
    const { standingFor } = await import('../derive/standing.ts')
    const s = standingFor('gh#105')
    expect(s.shape).toBe('unsettled')
    /* The owner's own item lives on the issue list. Showing the change list alone
       would have hidden the one row on either list that is a gate. */
    expect(s.rows.some((r) => r.list === 'mr')).toBe(true)
    expect(s.rows.some((r) => r.kind === 'human')).toBe(true)
  })

  test('told it is a change, it shows the change list only', async () => {
    const { standingFor } = await import('../derive/standing.ts')
    const s = standingFor('gh#105', 'change')
    expect(s.shape).toBe('change')
    expect(s.noun).toBe('pull request')
    expect(s.rows.every((r) => r.list === 'mr')).toBe(true)
  })

  test('told it is work, it shows the issue list and its owner gate', async () => {
    const { standingFor } = await import('../derive/standing.ts')
    const s = standingFor('gh#131', 'work')
    expect(s.noun).toBe('issue')
    expect(s.rows.every((r) => r.list === 'issue')).toBe(true)
    expect(s.rows.find((r) => r.kind === 'human')?.id).toBe('agreed')
  })
})

describe('a tick against an item that is no longer on the list', () => {
  test('is kept, shown, and said out loud rather than swept away', async () => {
    const { setTick } = await import('../list/ticks.ts')
    const { standingFor } = await import('../derive/standing.ts')
    setTick({ ref: '!1848', item: 'a-thing-nobody-lists', done: true, agent: 'an agent' })
    const orphan = standingFor('!1848', 'change').rows.find((r) => r.orphan)
    /* A missing row looks exactly like a row that was never there, and a tick is
       a record that somebody asserted something about a real change. */
    expect(orphan?.id).toBe('a-thing-nobody-lists')
    expect(orphan?.why).toContain('The tick is kept rather than deleted')
  })
})

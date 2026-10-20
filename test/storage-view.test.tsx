import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

import { StorageView, finishedOf } from '../src/view/storage.tsx'
import { room } from '../src/view/room.ts'

/**
 * The Storage page: usage, then a preview, then a purge that takes two presses —
 * and the tracker's reading handed to the server with every request, so finished
 * targets are counted from what the host said.
 */

let sent: Record<string, unknown>[] = []

const REPORT = {
  lists: [{ id: 'abc', name: 'What an issue owes', bytes: 2048, held: 40, released: 3, ticks: 12, last: '2026-03-01T00:00:00.000Z', finished: 5 }],
  total: 4096,
  listsFile: 300,
  backups: [],
  other: 0,
  trouble: null,
  nowhere: false,
}
const PLAN = { rule: { scope: 'released', days: 180 }, cutoff: '', rows: [{ id: 'abc', name: 'What an issue owes', whole: false, targets: 3, ticks: 4, bytes: 512 }], lists: 0, targets: 3, ticks: 4, frees: 512, digest: 'd1' }

beforeEach(() => {
  sent = []
  const island = document.createElement('script')
  island.id = 'ticket'
  island.type = 'application/json'
  island.textContent = JSON.stringify('the-page-ticket')
  document.body.appendChild(island)
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
    sent.push(body)
    if (body.op === 'preview') return Response.json({ ok: true, plan: PLAN })
    if (body.op === 'purge') return Response.json({ ok: true, said: 'purged 3 targets, with 4 ticks (512 bytes)', ...REPORT, total: 3584 })
    return Response.json({ ok: true, ...REPORT })
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  document.getElementById('ticket')?.remove()
})

const reading = {
  at: null, refreshing: false, sources: [], missing: [],
  rows: [
    { ref: 'gh#1', state: 'closed', closedAt: '2026-01-01T00:00:00Z' },
    { ref: 'gh#2', state: 'open' },
    { ref: '!3', state: 'merged', mergedAt: '2026-02-01T00:00:00Z', closedAt: '2026-02-01T00:00:00Z' },
  ],
}

test('finished is closed or merged, with when', () => {
  expect(finishedOf(reading as never)).toEqual([
    { ref: 'gh#1', at: '2026-01-01T00:00:00Z' },
    { ref: '!3', at: '2026-02-01T00:00:00Z' },
  ])
  expect(finishedOf(null)).toBeNull()
})

test('usage per list and the total; preview, then a purge that is armed and then confirmed', async () => {
  let changed = 0
  const { container, getByText, findByText } = render(
    <StorageView projectPath="/p" readProject={async () => reading as never} onBack={() => {}} onChanged={() => (changed += 1)} room={room(900, 700)} />,
  )
  await findByText('What an issue owes')
  expect(container.textContent).toContain('4.0 KB')
  expect(container.textContent).toContain('held against 40 · 3 released with ticks kept · 12 ticks · 5 finished')
  expect(sent[0]).toMatchObject({ op: 'usage', project: '/p', finished: [{ ref: 'gh#1' }, { ref: '!3' }] })

  fireEvent.click(getByText('Preview'))
  await findByText(/Would remove 3 targets with 4 ticks, freeing 512 B/)
  expect(sent.at(-1)).toMatchObject({ op: 'preview', scope: 'released', days: 180 })

  fireEvent.click(getByText('Purge…'))
  expect(sent.at(-1)?.op).toBe('preview')
  fireEvent.click(getByText('Press again to purge'))
  await findByText(/purged 3 targets/)
  expect(sent.at(-1)).toMatchObject({ op: 'purge', digest: 'd1', keep: true, confirm: true })
  await waitFor(() => expect(changed).toBe(1))
})

test('without a backup the page says the purge is permanent before it is confirmed, and changing the rule drops the preview', async () => {
  const { container, getByText, getByLabelText, findByText } = render(
    <StorageView projectPath="/p" readProject={async () => null} onBack={() => {}} onChanged={() => {}} room={room(900, 700)} />,
  )
  await findByText('What an issue owes')
  expect(container.textContent).toContain('finished targets are not counted')
  fireEvent.click(getByLabelText('Keep a backup'))
  expect(container.querySelector('[data-permanent]')).not.toBeNull()
  fireEvent.click(getByText('Preview'))
  await findByText(/Permanent\./)
  fireEvent.change(getByLabelText('How old'), { target: { value: '9' } })
  await waitFor(() => expect(container.querySelector('[data-plan]')).toBeNull())
})

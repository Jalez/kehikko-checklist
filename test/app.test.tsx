import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { Kehikot } from '../src/wire/use-kehikot.ts'

/**
 * The page's own fetches, driven for real.
 *
 * The wire to the host is replaced and the server's answers are held by hand,
 * because the bug is an ORDER: a read for the project just left that resolves
 * after the read for the one now open.
 */
let wire: Partial<Kehikot> = {}
mock.module('../src/wire/use-kehikot.ts', () => ({
  useKehikot: () => ({
    where: 'hosted',
    epic: null,
    projectPath: null,
    project: null,
    kehikko: null,
    selection: [],
    passage: '',
    containers: '',
    chosen: '',
    resize: () => {},
    filters: () => {},
    pickProject: async () => null,
    trackerAt: '',
    trackerReading: false,
    marks: '',
    parts: '',
    readTracker: async () => null,
    ...wire,
  }),
  marksOf: () => [],
}))

const { App } = await import('../src/app.tsx')

afterEach(() => {
  cleanup()
  wire = {}
})

const summary = (name: string) => ({ id: name, name, at: '', by: '', items: 0, targets: 0, held: [] })

test('a late read of every checklist for the previous project does not replace the current one', async () => {
  const waiting = new Map<string, (body: unknown) => void>()
  globalThis.fetch = (async (url: string) => {
    const project = new URL(url, 'http://x').searchParams.get('project') ?? ''
    if (!url.startsWith('/api/checklists')) return Response.json({})
    return Response.json(await new Promise((resolve) => waiting.set(project, resolve)))
  }) as unknown as typeof fetch

  wire = { projectPath: '/old' }
  const { rerender } = render(<App />)
  await waitFor(() => expect(waiting.has('/old')).toBe(true))

  /* Switching project returns to the reading page, so the All view is opened after. */
  wire = { projectPath: '/new' }
  rerender(<App />)
  fireEvent.click(await screen.findByText('All checklists'))

  /* The new project answers first, the old one last. */
  await waitFor(() => expect(waiting.has('/new')).toBe(true))
  waiting.get('/new')!({ lists: [summary('new list')] })
  await screen.findByText('new list')
  waiting.get('/old')!({ lists: [summary('old list')] })
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20))
  })

  expect(screen.queryByText('new list')).not.toBeNull()
  expect(screen.queryByText('old list')).toBeNull()
})

/**
 * The parts focus, through the page's own fetch.
 *
 * The server is asked about everything in front, and the lists held against
 * references outside the picked parts are put aside after it answers — so the
 * count of what was hidden is on screen — and a change of focus re-draws the
 * page without asking the server again.
 */
test('a parts focus puts aside the lists held against refs outside it, says how many, and follows a change of focus', async () => {
  const instance = (id: string, target: unknown) => ({
    checklist: { id, name: `list ${id}`, at: '', by: '', origin: null, items: [], targets: [] },
    target,
    rows: [],
    done: 0,
    total: 0,
  })
  let asked = 0
  globalThis.fetch = (async (url: string) => {
    if (url.startsWith('/api/checklists')) return Response.json({ lists: [] })
    asked += 1
    return Response.json({
      placed: null,
      positions: [],
      instances: [
        instance('a', { kind: 'ref', ref: 'gh#10' }),
        instance('b', { kind: 'ref', ref: 'gh#7' }),
        instance('c', { kind: 'paper', epic: 'thesis', section: null }),
      ],
      trouble: null,
      nowhere: false,
    })
  }) as unknown as typeof fetch

  const parts = (seam: boolean, tests: boolean) =>
    JSON.stringify([
      { id: 'seam', heading: 'The posting seam', refs: ['gh#10'], picked: seam },
      { id: 'tests', heading: 'What the tests check', refs: ['gh#7'], picked: tests },
    ])
  const drawn = () => [...document.querySelectorAll('[data-instance]')].map((one) => one.getAttribute('data-instance'))
  const line = () => document.querySelector('[data-focus]')?.textContent ?? null

  /* Parts listed and none picked: the page as it always was. */
  wire = { projectPath: '/p', epic: 'thesis', selection: ['gh#10', 'gh#7'], parts: parts(false, false) }
  const { rerender } = render(<App />)
  await waitFor(() => expect(drawn()).toEqual(['a', 'b', 'c']))
  expect(line()).toBeNull()
  const before = asked

  wire = { ...wire, parts: parts(true, false) }
  rerender(<App />)
  await waitFor(() => expect(drawn()).toEqual(['a', 'c']))
  expect(line()).toBe(
    '1 checklist outside the picked part (The posting seam). 1 list held against the paper is shown as before: parts name references, not sections.',
  )

  wire = { ...wire, parts: parts(false, true) }
  rerender(<App />)
  await waitFor(() => expect(drawn()).toEqual(['b', 'c']))
  expect(line()).toContain('(What the tests check)')

  wire = { ...wire, parts: '' }
  rerender(<App />)
  await waitFor(() => expect(drawn()).toEqual(['a', 'b', 'c']))
  expect(line()).toBeNull()
  /* The focus is applied to an answer already held: no question was re-asked. */
  expect(asked).toBe(before)
})

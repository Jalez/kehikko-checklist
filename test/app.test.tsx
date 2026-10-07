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

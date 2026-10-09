import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { resetServerStanding } from 'kehikot-module-protocol/client'

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

/**
 * The not-ready moments, each as the protocol's one shared cover — and what stays under it.
 *
 * The hook is this file's stand-in (so `where` and the project are whatever a case says); the
 * server is `fetch`, and `ask()`, the standing and the cover are the real things.
 */
describe('the not-ready moments, each as the one shared cover', () => {
  const realFetch = globalThis.fetch
  let down = false
  let refuse = false
  let wrote: { ticket: string | null; body: Record<string, unknown> }[] = []
  const here = { placed: null, positions: [], instances: [], trouble: null, nowhere: false }

  beforeEach(() => {
    down = false
    refuse = false
    wrote = []
    resetServerStanding()
    const island = document.createElement('script')
    island.id = 'ticket'
    island.type = 'application/json'
    island.textContent = JSON.stringify('the-page-ticket')
    document.body.appendChild(island)
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (down) throw new TypeError('Load failed')
      const at = new URL(url, 'http://x')
      const project = at.searchParams.get('project')
      if ((init.method ?? 'GET') === 'POST') {
        wrote.push({ ticket: (init.headers as Record<string, string>)['x-module-ticket'] ?? null, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        if (refuse) return Response.json({ ok: false, error: 'that press did not come from this app’s own page', refused: 'ticket' }, { status: 403 })
        return Response.json({ ok: true, said: 'made', id: 'made', lists: [summary('made')], held: null })
      }
      if (at.pathname === '/api/checklists') return Response.json({ lists: project ? [summary('one list')] : [], trouble: null, nowhere: !project })
      if (at.pathname === '/api/here') return Response.json({ ...here, nowhere: !project })
      return Response.json({})
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    document.getElementById('ticket')?.remove()
    resetServerStanding()
  })

  const cover = () => document.querySelector('[data-cover]')?.getAttribute('data-cover') ?? null
  const settle = (ms = 30) => act(async () => void (await new Promise((done) => setTimeout(done, ms))))
  const openAll = async () => {
    fireEvent.click(await screen.findByText('All checklists'))
    await screen.findByText('one list')
  }

  test('before anything has greeted the page it is waiting — never "no project"', async () => {
    wire = { where: 'listening' }
    render(<App />)
    await settle()
    expect(cover()).toBe('waiting')
    expect(document.body.textContent).toContain('Waiting for Kehikot…')
    expect(document.body.textContent).not.toContain('No project')
  })

  test('nothing framing the page, and a host that named no folder, are two covers with where the lists live under them', async () => {
    wire = { where: 'unhosted' }
    const { unmount } = render(<App />)
    await settle()
    expect(cover()).toBe('unhosted')
    expect(document.body.textContent).toContain('Nothing is framing this page — open Checklist in Kehikot.')
    expect(document.body.textContent).toContain('.kehikot folder')
    expect(document.querySelector('[data-cover]')?.querySelectorAll('button')).toHaveLength(0)
    unmount()

    wire = { where: 'hosted', project: 'Roadmap' }
    render(<App />)
    await settle()
    expect(cover()).toBe('no-project')
    expect(document.body.textContent).toContain('“Roadmap”')
  })

  test('a project open: the first read is "loading", then the page', async () => {
    wire = { projectPath: '/p' }
    render(<App />)
    expect(cover()).toBe('loading')
    await settle()
    expect(cover()).toBeNull()
    expect(screen.getByText('All checklists')).toBeTruthy()
  })

  test('its own server not answering is the cover — not "Reading." for ever — with the page mounted under it, and Try again asks again', async () => {
    wire = { projectPath: '/p' }
    render(<App />)
    await openAll()
    down = true
    /* The next thing that asks. On a real page that is the announcements poll, every two seconds. */
    await act(async () => void (await (await import('kehikot-module-protocol/client')).ask('/api/checklists')))
    expect(cover()).toBe('down')
    expect(document.body.textContent).toContain('Checklist’s own server is not answering.')
    expect(document.querySelector('[hidden]')?.textContent).toContain('one list')
    down = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    expect(cover()).toBeNull()
  })

  test('a write carries the page’s ticket in the shared header', async () => {
    wire = { projectPath: '/p' }
    render(<App />)
    await openAll()
    const box = screen.getByLabelText('Start a checklist')
    fireEvent.change(box, { target: { value: 'What a change owes' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await settle()
    expect(wrote).toHaveLength(1)
    expect(wrote[0]).toMatchObject({ ticket: 'the-page-ticket', body: { op: 'create', name: 'What a change owes', project: '/p' } })
    expect(cover()).toBeNull()
  })

  test('a write refused because the page is older than its server: the words are not lost with the box that held them', async () => {
    wire = { projectPath: '/p' }
    render(<App />)
    await openAll()
    refuse = true
    const box = screen.getByLabelText('Start a checklist')
    fireEvent.change(box, { target: { value: 'Never made' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await settle()
    expect(wrote).toHaveLength(1)
    /* The box emptied itself on the press, as it always has. The page is NOT covered and does not
       reload: it says what happened and shows the words where they can be copied. */
    expect(cover()).toBeNull()
    expect(document.querySelector('[data-holding="stale"]')?.textContent).toContain('This page is older than its server, so what you have typed cannot be sent from it.')
    expect(document.querySelector('[data-unsent]')?.textContent).toBe('Not sent: “Never made”')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  test('something typed and not sent is not covered when the server stops: the words stay, with what to do about them', async () => {
    wire = { projectPath: '/p' }
    render(<App />)
    await openAll()
    fireEvent.change(screen.getByLabelText('Start a checklist'), { target: { value: 'half an item' } })
    down = true
    await act(async () => void (await (await import('kehikot-module-protocol/client')).ask('/api/checklists')))
    expect(cover()).toBeNull()
    expect(document.querySelector('[data-holding="down"]')?.textContent).toContain('Copy it now')
    expect((screen.getByLabelText('Start a checklist') as HTMLTextAreaElement).value).toBe('half an item')
  })

  test('a page with nothing typed, older than its server, is the stale cover', async () => {
    wire = { projectPath: '/p' }
    render(<App />)
    await openAll()
    refuse = true
    await act(async () => void (await (await import('kehikot-module-protocol/client')).ask('/api/checklist', { body: { op: 'create' } })))
    expect(cover()).toBe('stale')
    expect(document.body.textContent).toContain('This page is older than its server — reloading…')
  })
})

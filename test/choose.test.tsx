import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'
import { mailbox, resetServerStanding, unwrapKept } from 'kehikot-module-protocol/client'

import { TICKET, answerAt as door } from '../doors.ts'

/**
 * ONE target, and ONE checklist per type of item — the whole page, against the
 * real doors and the real wire, with a host that answers what the page asks it:
 * the tracker's reading of the picked refs (their type) and the containers on
 * the kehikko, picked or not, with what each shows (`list/one.ts`,
 * `list/choices.ts`).
 *
 * `test/app.test.tsx` replaces the wire hook by name, process-wide; this file
 * puts the real one back and imports a page of its own, as
 * `test/follows.test.tsx` does.
 */
// @ts-expect-error a query string, so this is the real module and never app.test.tsx's stand-in
const hook = (await import('../src/wire/use-kehikot.ts?real')) as typeof import('../src/wire/use-kehikot.ts')
mock.module('../src/wire/use-kehikot.ts', () => ({ ...hook }))
// @ts-expect-error a query string again: a page of this file's own
const { App } = (await import('../src/app.tsx?choose')) as typeof import('../src/app.tsx')

const realFetch = globalThis.fetch
let dir = ''
const ids: Record<string, string> = {}

const write = (body: Record<string, unknown>) =>
  door('POST', '/api/checklist', new URLSearchParams(), { ...body, project: dir }, TICKET)?.body as { ok: boolean; id: string }

/** A list with one line, applying to `types` × `roles`. */
function aList(name: string, types: string[], roles: string[]) {
  const id = write({ op: 'create', name, rule: { types, roles } }).id
  write({ op: 'add', id, text: `${name}: the one line` })
  ids[name] = id
}

/* The host's tracker reading: !7 is a GitLab merge request the person was asked to review, gh#200 a GitHub pull request they wrote. */
const ROWS: Record<string, Record<string, unknown>> = {
  '!7': { kind: 'change', tracker: 'gitlab', myRoles: ['reviewer-asked'] },
  'gh#200': { kind: 'change', tracker: 'github', myRoles: ['author'] },
  'gh#105': { kind: 'issue', tracker: 'github', myRoles: [] },
}
function row(ref: string) {
  const one = ROWS[ref]!
  return {
    ref,
    host: one.tracker === 'gitlab' ? 'gitlab.com' : 'github.com',
    repo: 'owner/repo',
    number: Number(ref.replace(/\D/g, '')),
    state: 'open',
    title: `Item ${ref}`,
    url: 'https://example.org',
    readAt: '2026-10-22T00:00:00.000Z',
    ...one,
  }
}

/** What the page sent the host, and the host's choice of filters for this container. */
let posted: Record<string, unknown>[] = []
let chosen: Record<string, string> = {}

function deliver(data: unknown) {
  const event = new MessageEvent('message', { data, origin: 'http://localhost:7777' })
  Object.defineProperty(event, 'source', { value: HOST })
  window.dispatchEvent(event)
}
const HOST = {
  postMessage: (message: Record<string, unknown>) => {
    posted.push(message)
    if (message.type !== MESSAGE.REQUEST) return
    const params = (message.params ?? {}) as Record<string, unknown>
    let data: unknown = {}
    if (message.method === 'tracker.get') {
      const refs = Array.isArray(params.refs) ? (params.refs as string[]) : []
      data = { at: '2026-10-22T00:00:00.000Z', rows: refs.filter((ref) => ROWS[ref]).map(row), missing: [] }
    }
    if (message.method === 'filters.set') {
      chosen = (params.filters ?? {}) as Record<string, string>
      data = { filters: chosen }
    }
    queueMicrotask(() => deliver({ type: MESSAGE.RESPONSE, id: message.id, ok: true, data }))
  },
}

/** What the canvas says besides the selection: the containers, what each shows, a passage, the kept view. */
interface Canvas {
  containers?: { module: string; selected: boolean; refs?: string[]; documents?: string[] }[]
  passage?: { path: string; from: number; to: number } | null
  kept?: string | null
  epic?: string | null
}
const context = (selection: string[], canvas: Canvas = {}) => ({
  project: 'harbour',
  projectPath: dir,
  epic: canvas.epic ?? null,
  theme: 'light',
  kehikko: { id: 1, name: 'Review', key: 'review' },
  selection,
  passage: canvas.passage ? { path: canvas.passage.path, from: canvas.passage.from, to: canvas.passage.to, quoted: '' } : null,
  filters: chosen,
  ...(canvas.containers
    ? {
        containers: canvas.containers.map((one) => ({
          module: one.module,
          selected: one.selected,
          showing: { refs: one.refs ?? [], documents: (one.documents ?? []).map((path) => ({ path })) },
        })),
      }
    : {}),
  ...(canvas.kept !== undefined ? { kept: canvas.kept } : {}),
})
const say = async (type: 'hello' | 'context', selection: string[], canvas: Canvas = {}) => {
  await act(async () => {
    deliver(
      type === 'hello'
        ? { type: MESSAGE.HELLO, protocol: PROTOCOL, session: 'choose', state: null, header: true, footer: true, context: context(selection, canvas) }
        : { type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context(selection, canvas) },
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

/** The footer the page last declared: its concerns readout. */
const readout = () => {
  const footer = posted.filter((one) => one.type === 'kehikot.footer').at(-1) as { items: { id: string; text?: string }[] } | undefined
  return footer?.items.find((one) => one.id === 'concerns')?.text
}
const press = async (item: string, value: string | boolean) => {
  await act(async () => {
    deliver({ type: 'kehikot.press', protocol: PROTOCOL, id: `press-${item}-${String(value)}`, item, value })
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
}

/** What is drawn: each item's line, and the names of its lists. */
const sections = () =>
  [...document.querySelectorAll('[data-section]')].map((one) => [
    one.querySelector('[data-item-line] span')?.textContent,
    ...[...one.querySelectorAll('[data-instance] h2')].map((name) => name.textContent),
  ])

beforeEach(() => {
  resetServerStanding()
  mailbox.forget?.()
  posted = []
  chosen = {}
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'checklist-choose-')))
  aList('What a review owes', ['mr', 'pr'], ['reviewer'])
  aList('Before asking for review', ['mr', 'pr'], ['author'])
  aList('What every change owes', ['mr', 'pr'], ['any'])
  aList('What an issue owes', ['issue'], ['any'])

  const island = document.createElement('script')
  island.id = 'ticket'
  island.type = 'application/json'
  island.textContent = JSON.stringify(TICKET)
  document.body.appendChild(island)
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const at = new URL(String(url), 'http://127.0.0.1')
    const ticket = (init.headers as Record<string, string> | undefined)?.['x-module-ticket'] ?? null
    const said = door((init.method ?? 'GET').toUpperCase(), at.pathname, at.searchParams, init.body ? JSON.parse(String(init.body)) : null, ticket)
    return new Response(JSON.stringify(said?.body ?? null), { status: said?.status ?? 404 })
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  globalThis.fetch = realFetch
  document.getElementById('ticket')?.remove()
  rmSync(dir, { recursive: true, force: true })
})

describe('exactly one target', () => {
  test('nothing picked: one sentence saying how to pick something, the same in the footer, and no list of items', async () => {
    render(<App />)
    await say('hello', [])
    const how = 'Nothing picked: tick the box in a container’s header, or click an issue, MR, PR or a place in a paper.'
    await waitFor(() => expect(document.querySelector('[data-none="picked"]')?.textContent).toBe(how))
    expect(document.querySelectorAll('[data-section]')).toHaveLength(0)
    await waitFor(() => expect(readout()?.startsWith('Nothing picked')).toBe(true))
  })

  test('nothing picked: the most recently selected item alone, never a union, and the footer says why', async () => {
    render(<App />)
    await say('hello', ['!7'])
    await waitFor(() => expect(sections()).toEqual([['!7', 'What a review owes']]))
    await waitFor(() => expect(readout()).toBe('For !7 (selected last)'))
    /* Another click: that one alone. */
    await say('context', ['!7', 'gh#105'])
    await waitFor(() => expect(sections()).toEqual([['gh#105', 'What an issue owes']]))
    await waitFor(() => expect(readout()).toBe('For gh#105 (selected last)'))
  })

  test('a container picked as the target wins: References’ picked item, not the paper in view beside it', async () => {
    render(<App />)
    const canvas: Canvas = {
      epic: 'thesis',
      passage: { path: 'chapters/intro.tex', from: 0, to: 10 },
      containers: [
        { module: 'kehikot.paper', selected: false, documents: ['chapters/intro.tex'] },
        { module: 'kehikot.references', selected: true, refs: ['!7'] },
      ],
    }
    await say('hello', [], canvas)
    await waitFor(() => expect(sections()).toEqual([['!7', 'What a review owes']]))
    await waitFor(() => expect(readout()).toBe('For !7 (picked in References)'))
    /* Paper picked too, later: Paper's paper is the one target now — and !7 is not drawn beside it. */
    await say('context', [], { ...canvas, containers: [{ ...canvas.containers![0]!, selected: true }, canvas.containers![1]!] })
    await waitFor(() => expect(readout()).toBe('For intro.tex (picked in Paper)'))
    expect(document.querySelector('[data-section="ref:!7"]')).toBeNull()
  })
})

describe('one checklist per type of item', () => {
  test('the header’s Checklist menu chooses the one a type uses, for the project', async () => {
    render(<App />)
    await say('hello', ['!7'])
    await waitFor(() => expect(sections()).toEqual([['!7', 'What a review owes']]))
    const header = () => posted.filter((one) => one.type === 'kehikot.header').at(-1) as { items: { id: string; value?: string; checked?: boolean }[] }
    await waitFor(() => expect(header().items.find((one) => one.id === 'choose:mr')?.value).toBe(ids['What a review owes']))
    await press('choose:mr', ids['What every change owes']!)
    await waitFor(() => expect(sections()).toEqual([['!7', 'What every change owes']]))
    /* Kept for the project: the file says so. */
    const listed = door('GET', '/api/checklists', new URLSearchParams({ project: dir }), null, null)?.body as { lists: { id: string; chosen?: string[] }[] }
    expect(listed.lists.find((one) => one.id === ids['What every change owes'])!.chosen).toEqual(['mr'])
    /* None: nothing in front, and the way to pick one. */
    await press('choose:mr', 'none')
    await waitFor(() =>
      expect(document.querySelector('[data-none="applies"]')?.textContent).toBe(
        'No checklist is chosen for merge requests. Pick a checklist for merge requests in the header’s Checklist menu.',
      ),
    )
  })

  test('this kehikko’s own choice, kept by the host for the container, wins over the project’s', async () => {
    render(<App />)
    await say('hello', ['!7'], { kept: JSON.stringify({ choices: { mr: ids['Before asking for review'], kept: 'yes' } }) })
    await waitFor(() => expect(sections()).toEqual([['!7', 'Before asking for review']]))
    const header = posted.filter((one) => one.type === 'kehikot.header').at(-1) as { items: { id: string; value?: string; checked?: boolean }[] }
    expect(header.items.find((one) => one.id === 'choose-here')?.checked).toBe(true)
    expect(header.items.find((one) => one.id === 'choose:mr')?.value).toBe(ids['Before asking for review'])
    /* A choice made while it is on is kept with the host, not written to the project. */
    await press('choose:mr', ids['What every change owes']!)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    const kept = posted.filter((one) => one.type === MESSAGE.REQUEST && one.method === 'state.set').at(-1) as { params: { state: string } } | undefined
    expect(kept && JSON.parse(unwrapKept(kept.params.state).state ?? '{}').choices.mr).toBe(ids['What every change owes'])
    const listed = door('GET', '/api/checklists', new URLSearchParams({ project: dir }), null, null)?.body as { lists: { id: string; chosen?: string[] }[] }
    expect(listed.lists.find((one) => one.id === ids['What a review owes'])!.chosen).toEqual(['mr', 'pr'])
  })

  test('no choice for a type: never assigned by itself; its starter is one press, and then it is the type’s', async () => {
    write({ op: 'choose', type: 'issue', id: null })
    render(<App />)
    await say('hello', ['gh#105'])
    await waitFor(() => expect(document.querySelector('[data-none="applies"]')?.textContent).toBe(
      'No checklist is chosen for issues. Pick a checklist for issues in the header’s Checklist menu.',
    ))
    const use = document.querySelector('[data-use-starter="issue:issues"]') as HTMLElement
    expect(use.textContent).toBe('Use “Issue standards”')
    await act(async () => {
      fireEvent.click(use)
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    await waitFor(() => expect(sections()).toEqual([['gh#105', 'Issue standards']]))
  })
})

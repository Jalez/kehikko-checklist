import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'
import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { TICKET, answerAt as door } from '../doors.ts'

/**
 * The checklists for the item somebody picked, from the angle they want — the
 * whole page, against the real doors and the real wire, with a host that
 * answers what the page asks it: the tracker's reading of the picked refs
 * (their type, and the person's roles on each, `myRoles`) and the filter
 * choice the angle is remembered by.
 *
 * `test/app.test.tsx` replaces the wire hook by name, process-wide; this file
 * puts the real one back and imports a page of its own, as
 * `test/follows.test.tsx` does.
 */
// @ts-expect-error a query string, so this is the real module and never app.test.tsx's stand-in
const hook = (await import('../src/wire/use-kehikot.ts?real')) as typeof import('../src/wire/use-kehikot.ts')
mock.module('../src/wire/use-kehikot.ts', () => ({ ...hook }))
// @ts-expect-error a query string again: a page of this file's own
const { App } = (await import('../src/app.tsx?angle')) as typeof import('../src/app.tsx')

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

const context = (selection: string[]) => ({
  project: 'harbour',
  projectPath: dir,
  epic: null,
  theme: 'light',
  kehikko: null,
  selection,
  passage: null,
  filters: chosen,
})
const say = async (type: 'hello' | 'context', selection: string[]) => {
  await act(async () => {
    deliver(
      type === 'hello'
        ? { type: MESSAGE.HELLO, protocol: PROTOCOL, session: 'angle', state: null, header: true, context: context(selection) }
        : { type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context(selection) },
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

/** What is drawn: each item's angle line, and the names of its lists. */
const sections = () =>
  [...document.querySelectorAll('[data-section]')].map((one) => [
    one.querySelector('[data-angle] span')?.textContent ?? one.querySelector('[data-angle]')?.textContent,
    ...[...one.querySelectorAll('[data-instance] h2')].map((name) => name.textContent),
  ])

beforeEach(() => {
  resetServerStanding()
  mailbox.forget?.()
  posted = []
  chosen = {}
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'checklist-angle-')))
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

describe('the checklists for the picked item, from the angle', () => {
  test('nothing picked: one sentence, the way to manage the checklists, and no list of items', async () => {
    render(<App />)
    await say('hello', [])
    await waitFor(() => expect(document.querySelector('[data-none="picked"]')?.textContent).toBe('Pick an issue, MR, PR or paper to see its checklists.'))
    expect(document.querySelectorAll('[data-section]')).toHaveLength(0)
    expect(document.querySelector('[data-all]')?.textContent).toBe('Manage checklists')
  })

  test('automatic: the person’s role from the host’s myRoles — reviewer on !7, author on gh#200 — one section each', async () => {
    render(<App />)
    await say('hello', ['!7', 'gh#200', 'gh#105'])
    await waitFor(() =>
      expect(sections()).toEqual([
        ['As reviewer on !7', 'What a review owes', 'What every change owes'],
        ['As author on gh#200', 'Before asking for review', 'What every change owes'],
        ['Any role on gh#105', 'What an issue owes'],
      ]),
    )
    /* The header declares the angle, on automatic, and the host is offered it to remember. */
    const header = posted.filter((one) => one.type === 'kehikot.header').at(-1) as { items: { id: string; value?: string; options?: { id: string }[] }[] }
    const angle = header.items.find((one) => one.id === 'angle')!
    expect(angle.value).toBe('auto')
    expect(angle.options!.map((one) => one.id)).toEqual(['auto', 'assignee', 'reviewer', 'author', 'any'])
    const offer = posted.filter((one) => one.type === MESSAGE.FILTERS).at(-1) as { groups: { id: string }[] }
    expect(offer.groups.map((one) => one.id)).toContain('angle')
    /* !7 has a list for its author too: one press reads from there. */
    expect(document.querySelector('[data-section="ref:!7"] [data-angle-to="author"]')).toBeTruthy()
  })

  test('the header’s Angle switch reads every item from that role, and the host remembers it for this container', async () => {
    render(<App />)
    await say('hello', ['!7'])
    await waitFor(() => expect(sections()[0]?.[0]).toBe('As reviewer on !7'))
    await act(async () => {
      deliver({ type: 'kehikot.press', protocol: PROTOCOL, id: 'press-1', item: 'angle', value: 'author' })
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    const asked = posted.find((one) => one.type === MESSAGE.REQUEST && one.method === 'filters.set') as { params: unknown }
    expect(asked.params).toEqual({ filters: { angle: 'author' } })
    await waitFor(() => expect(sections()).toEqual([['As author on !7', 'Before asking for review', 'What every change owes']]))
    /* The host's next context carries the choice, and a reload of the frame comes back on it. */
    await say('context', ['!7'])
    expect(sections()[0]?.[0]).toBe('As author on !7')
    cleanup()
    render(<App />)
    await say('hello', ['!7'])
    await waitFor(() => expect(sections()[0]?.[0]).toBe('As author on !7'))
    /* Any role: only the lists for any role, and the others are said to be there. */
    await act(async () => {
      deliver({ type: 'kehikot.press', protocol: PROTOCOL, id: 'press-2', item: 'angle', value: 'any' })
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    await waitFor(() => expect(sections()).toEqual([['Any role on !7', 'What every change owes']]))
    expect(document.querySelector('[data-section="ref:!7"] [data-elsewhere]')?.getAttribute('data-elsewhere')).toBe('reviewer author')
  })

  test('nothing applies: said from the angle, and a line just for the item can be added there, kept on its own', async () => {
    write({ op: 'applies', id: ids['What an issue owes'], rules: [] })
    render(<App />)
    await say('hello', ['gh#105'])
    await waitFor(() => expect(document.querySelector('[data-none="applies"]')?.textContent).toBe('No checklist applies to gh#105 for any role.'))
    expect(document.querySelector('[data-new-for="issue:any"]')?.textContent).toBe('Add a checklist for issues for any role')
    fireEvent.click(document.querySelector('[data-add-for="ref:gh#105"]') as HTMLElement)
    const box = document.querySelector('textarea[aria-label="A line just for gh#105"]') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Ask Sam about the flaky test' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    await waitFor(() => expect(sections()).toEqual([['Any role on gh#105', 'Only for gh#105']]))
    /* Ticked like any line, with the item's ticks. */
    await act(async () => {
      fireEvent.click(document.querySelector('[data-instance] li[data-item] button') as HTMLElement)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    await waitFor(() => expect(document.querySelector('[data-instance] [data-count]')?.textContent).toBe('1/1'))
  })

  test('“Add a checklist for merge requests as reviewer” makes it, with its rule, and opens it to write its first line', async () => {
    for (const name of ['What a review owes', 'What every change owes']) write({ op: 'applies', id: ids[name], rules: [] })
    render(<App />)
    await say('hello', ['!7'])
    const offer = await waitFor(() => {
      const found = document.querySelector('[data-new-for="mr:reviewer"]') as HTMLElement
      expect(found?.textContent).toBe('Add a checklist for merge requests as reviewer')
      return found
    })
    await act(async () => {
      fireEvent.click(offer)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    await waitFor(() => expect(document.querySelector('[data-page="edit"] h2')?.textContent).toBe('Merge requests as reviewer'))
    const rule = document.querySelector('[data-rule="0"]')!
    expect([...rule.querySelectorAll('[data-chosen="yes"]')].map((one) => one.textContent)).toEqual(['Merge request', 'Reviewer'])
  })
})

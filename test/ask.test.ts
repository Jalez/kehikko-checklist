import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AskFailed, resetServerStanding, serverStanding } from 'kehikot-module-protocol/client'

import { TICKET, answer } from '../doors.ts'
import { edit, everyChecklist, openChecklist, unanswered, whatIsHere } from '../src/store/ask.ts'

/* The page's store against the real doors, with `fetch` as the only thing faked. */

const realFetch = globalThis.fetch
let dir = ''
let down = false
let forged: string | undefined
let carried: { method: string; path: string; ticket: string | null }[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-ask-'))
  down = false
  forged = undefined
  carried = []
  resetServerStanding()
  const island = document.createElement('script')
  island.id = 'ticket'
  island.type = 'application/json'
  island.textContent = JSON.stringify(TICKET)
  document.body.appendChild(island)
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    if (down) throw new TypeError('Load failed')
    const url = new URL(String(input), 'http://127.0.0.1')
    const method = (init.method ?? 'GET').toUpperCase()
    const ticket = (init.headers as Record<string, string> | undefined)?.['x-module-ticket'] ?? null
    carried.push({ method, path: url.pathname, ticket })
    const said = answer(method, url.pathname, url.searchParams, init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, forged ?? ticket)
    return new Response(JSON.stringify(said?.body ?? null), { status: said?.status ?? 404 })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  document.getElementById('ticket')?.remove()
  rmSync(dir, { recursive: true, force: true })
})

describe('a write from the page', () => {
  test('carries the page’s ticket in the shared header, which the doors accept', async () => {
    const made = await edit({ op: 'create', name: 'What a change owes' }, dir)
    expect(made.ok).toBe(true)
    expect(carried).toEqual([{ method: 'POST', path: '/api/checklist', ticket: TICKET }])
    expect((await everyChecklist(dir)).lists.map((one) => one.name)).toEqual(['What a change owes'])
    expect(serverStanding()).toBe('up')
  })

  test('the server refusing for its own reasons is its own sentence, and the page is not called stale', async () => {
    await edit({ op: 'create', name: 'What a change owes' }, dir)
    const again = await edit({ op: 'create', name: 'What a change owes' }, dir)
    expect(again.ok).toBe(false)
    expect(again.ok ? '' : again.error).toContain('already')
    expect(serverStanding()).toBe('up')
  })

  test('from a page older than its server is refused, marked, and nothing is written', async () => {
    forged = 'a-ticket-from-before-the-restart'
    expect(await edit({ op: 'create', name: 'Never made' }, dir)).toEqual({ ok: false, error: 'This page is older than its server — reloading…' })
    expect(serverStanding()).toBe('stale')
    forged = undefined
    expect((await everyChecklist(dir)).lists).toEqual([])
  })

  test('with nothing answering is one sentence, not a rejection', async () => {
    down = true
    expect(await edit({ op: 'create', name: 'Never made' }, dir)).toEqual({ ok: false, error: 'This app’s own server is not answering.' })
    expect(serverStanding()).toBe('down')
  })
})

describe('a read', () => {
  test('carries no ticket; no project is "nowhere", said in the body rather than as a failure', async () => {
    const none = await everyChecklist(null)
    expect(none.nowhere).toBe(true)
    expect(carried).toEqual([{ method: 'GET', path: '/api/checklists', ticket: null }])
  })

  test('a checklist that is not there is the server’s own answer, read out of a refusal', async () => {
    const gone = await openChecklist('no-such-list', dir)
    expect('error' in gone).toBe(true)
    expect(serverStanding()).toBe('up')
  })

  test('with nothing answering is thrown — where it used to be swallowed and the page said "Reading." forever', async () => {
    down = true
    const failed = await whatIsHere(dir, 'thesis', [], ['gh#7']).catch((caught: unknown) => caught)
    expect(failed).toBeInstanceOf(AskFailed)
    expect((failed as AskFailed).kind).toBe('down')
    expect(unanswered(failed)).toBe(true)
    expect(unanswered(new Error('something else'))).toBe(false)
    expect(serverStanding()).toBe('down')
    down = false
    await whatIsHere(dir, 'thesis', [], ['gh#7'])
    expect(serverStanding()).toBe('up')
  })

  test('several documents are still several `doc` parameters', async () => {
    await whatIsHere(dir, 'thesis', [{ path: '/p/a.tex', from: null, to: null }, { path: '/p/b.tex', from: 1, to: 9 }], [])
    expect(carried.at(-1)?.path).toBe('/api/here')
  })
})

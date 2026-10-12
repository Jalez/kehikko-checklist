import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'
import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { TICKET, answer as door } from '../doors.ts'

/**
 * The whole page against the real doors and the real wire, walked through the
 * picks a person makes in the host's bar: no part, one, another, two, none
 * again — with the paper beside it saying what a paper really says while that
 * happens. With nothing picked that is every file it has; with a part picked
 * it is that part's files; and once somebody else has walked it to a passage,
 * or it is folded away, it may be saying a chapter nobody is on any more.
 *
 * Found in a real project. A list held against the paper was never narrowed
 * to the picked parts, under a sentence saying it was "shown as before: parts
 * name references, not sections"; which of the paper's lists were in front
 * came from the passage and whatever each container last said it showed, so a
 * neighbour's stale file put its list under any pick; and a list held against
 * a SECTION of a picked part was not there at all, because nothing with a
 * range named it.
 *
 * And the thing a checklist must never do because the picks moved: every tick
 * belongs to a checklist, an item and a target together, so the file is read
 * before and after each walk and is byte for byte the same.
 *
 * `test/app.test.tsx` replaces the wire hook by name, process-wide, for its
 * own cases. This file puts the real one back under that name and then
 * imports a page of its own (the query on the path), so `App` here is the
 * page a host frames whichever file ran first.
 */
// @ts-expect-error a query string, so this is the real module and never app.test.tsx's stand-in
const hook = (await import('../src/wire/use-kehikot.ts?real')) as typeof import('../src/wire/use-kehikot.ts')
mock.module('../src/wire/use-kehikot.ts', () => ({ ...hook }))
// @ts-expect-error a query string again: a page of this file's own, imported after the real hook is back
const { App } = (await import('../src/app.tsx?follows')) as typeof import('../src/app.tsx')

const realFetch = globalThis.fetch
const EPIC = 'thesis'
const PAPER = `.kehikot/paper/${EPIC}`
const AT = `.kehikot:paper:${EPIC}`
let dir = ''
let store = ''
const ids: Record<string, string> = {}

/** One list, held against one target, with one line — ticked there when `ticked`. */
function aList(name: string, target: Record<string, string>, ticked = false) {
  const write = (body: Record<string, unknown>) =>
    door('POST', '/api/checklist', new URLSearchParams(), { ...body, project: dir }, TICKET)?.body as { id: string; held?: { rows: { item: { id: string } }[] } }
  const id = write({ op: 'create', name }).id
  write({ op: 'add', id, text: `${name}: the one line` })
  write({ op: 'hold', id, ...target })
  if (ticked) {
    const opened = door('GET', '/api/checklist', new URLSearchParams({ id, project: dir }), null, null)?.body as { held: { rows: { item: { id: string } }[] } }
    write({ op: 'tick', id, item: opened.held.rows[0]!.item.id, ...target, done: true })
  }
  ids[name] = id
}

beforeEach(() => {
  resetServerStanding()
  mailbox.forget?.()
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'checklist-follows-')))
  mkdirSync(join(dir, PAPER, 'chapters'), { recursive: true })
  writeFileSync(join(dir, PAPER, 'main.tex'), '\\include{chapters/3_methods}\n\\include{chapters/4_results}\n')
  writeFileSync(join(dir, PAPER, 'chapters', '3_methods.tex'), '\\section{Research design}\\label{sec:meth-design}\n\nWords.\n')
  writeFileSync(join(dir, PAPER, 'chapters', '4_results.tex'), '\\section{Satisfaction}\\label{sec:res-satisfaction}\n\nWords.\n')
  aList('Methods', { epic: EPIC, section: `${AT}:chapters:3_methods` }, true)
  aList('Design', { epic: EPIC, section: `${AT}:chapters:3_methods#sec:meth-design` })
  aList('Results', { epic: EPIC, section: `${AT}:chapters:4_results` })
  aList('Main', { epic: EPIC, section: `${AT}:main` })
  aList('Thesis', { epic: EPIC })
  aList('Change', { ref: 'gh#105' }, true)
  store = readFileSync(join(dir, '.kehikot', 'checklist', 'checklists.json'), 'utf8')

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
  /* Whatever was walked, nothing was ticked, unticked, moved, held, released or dropped. */
  expect(readFileSync(join(dir, '.kehikot', 'checklist', 'checklists.json'), 'utf8')).toBe(store)
  cleanup()
  mailbox.forget?.()
  globalThis.fetch = realFetch
  document.getElementById('ticket')?.remove()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * The two ways a host says what a part has. One from before protocol 1.2.0
 * (app 0.1.16) sends only `files`, relative to the paper's folder; one from
 * 0.1.17 sends `documents`, relative to the project, and goes on filling
 * `files` beside them. Every walk below is made under both.
 */
const SHAPES = ['files', 'documents'] as const
let shape: (typeof SHAPES)[number] = 'files'
const has = (file: string) => (shape === 'files' ? { files: [file] } : { documents: [`${PAPER}/${file}`], files: [file] })
const parts = (picked: string[], refs: Record<string, string[]> = {}): Record<string, unknown>[] => [
  { id: 'methods', heading: 'Methods', refs: refs.methods ?? [], picked: picked.includes('methods'), ...has('chapters/3_methods.tex') },
  { id: 'results', heading: 'Results', refs: refs.results ?? [], picked: picked.includes('results'), ...has('chapters/4_results.tex') },
]
const place = (name: string) => ({ path: `${dir}/${PAPER}/${name}`, page: null, from: null, to: null, quoted: '' })
/** A canvas with a paper on it: its caret in `caret`, saying it shows `shown`, and these parts picked. */
const canvas = (
  caret: string,
  shown: string[],
  picked: string[],
  more: { selected?: boolean; selection?: string[]; refs?: Record<string, string[]> } = {},
) => ({
  project: 'thesis',
  projectPath: dir,
  epic: EPIC,
  theme: 'dark',
  kehikko: null,
  selection: more.selection ?? [],
  parts: parts(picked, more.refs),
  passage: place(caret),
  containers: [
    { module: 'kehikot.paper', selected: more.selected === true, showing: { refs: [], documents: shown.map(place) } },
    { module: 'kehikot.checklist', selected: false, showing: { refs: [], documents: [] } },
  ],
})
const EVERY = ['main.tex', 'chapters/3_methods.tex', 'chapters/4_results.tex']

/* One window for the whole conversation: the bridge binds to whoever greeted it. */
const HOST = { postMessage: () => {} }
const say = async (type: 'hello' | 'context', context: Record<string, unknown>) => {
  await act(async () => {
    const data =
      type === 'hello'
        ? { type: MESSAGE.HELLO, protocol: PROTOCOL, session: 'follows', state: null, context }
        : { type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context }
    const event = new MessageEvent('message', { data, origin: 'http://localhost:7777' })
    Object.defineProperty(event, 'source', { value: HOST })
    window.dispatchEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

/** What is drawn: each list by the name it was made under, `+` open or `-` folded, with its count. */
const drawn = () =>
  [...document.querySelectorAll('[data-instance]')].map((one) => {
    const name = Object.keys(ids).find((key) => ids[key] === one.getAttribute('data-instance'))
    return `${one.getAttribute('data-open') === 'yes' ? '+' : '-'}${name} ${one.querySelector('[data-count]')?.textContent}`
  })
/** The one muted line under each name, saying which target the ticks belong to. */
const labels = () => [...document.querySelectorAll('[data-label]')].map((one) => one.textContent)
/** Anything on the page that talks about the picked parts while a list is drawn: there is to be none. */
const notice = () => document.querySelector('[data-focus]') !== null || /outside the|picked part|host’s bar/.test(document.body.textContent ?? '')

for (const sent of SHAPES) describe(`the checklists follow the picked parts, whatever the paper beside them last said — a host that sends ${sent}`, () => {
  beforeEach(() => {
    shape = sent
  })

  test('no part, one, another, two, none: each pick is that part’s lists, and no line says what was put aside', async () => {
    render(<App />)
    /* Nothing picked, and the paper says it is showing every file it has. All of them are in front
       — but only the reader's own file and the whole paper are open; the rest are one line each. */
    await say('hello', canvas('main.tex', EVERY, []))
    await waitFor(() => expect(drawn()).toEqual(['+Main 0/1', '+Thesis 0/1', '-Methods 1/1', '-Results 0/1']))
    expect(notice()).toBe(false)
    expect(labels()).toEqual(['main.tex', 'the whole paper', '3_methods.tex', '4_results.tex'])

    /* Methods: the chapter's list AND the list held against a section of it, which no passage named. */
    await say('context', canvas('chapters/3_methods.tex', ['chapters/3_methods.tex'], ['methods']))
    await waitFor(() => expect(drawn()).toEqual(['+Design 0/1', '+Methods 1/1', '+Thesis 0/1']))
    expect(notice()).toBe(false)
    /* Each row still says which target its ticks belong to, by the file's own name. */
    expect(labels()).toEqual(['sec:meth-design', '3_methods.tex', 'the whole paper'])

    /* The pick moves and the paper has not said anything new — somebody else walked it to a
       passage, or it is folded away. The old chapter's lists go; they are not "shown as before". */
    await say('context', canvas('chapters/3_methods.tex', ['chapters/3_methods.tex'], ['results']))
    await waitFor(() => expect(drawn()).toEqual(['+Results 0/1', '+Thesis 0/1']))
    expect(notice()).toBe(false)

    /* Two parts, and the paper's caret is in one of them. */
    await say('context', canvas('chapters/4_results.tex', ['chapters/4_results.tex'], ['methods', 'results']))
    await waitFor(() => expect(drawn()).toEqual(['+Design 0/1', '+Methods 1/1', '+Results 0/1', '+Thesis 0/1']))
    expect(notice()).toBe(false)

    /* Nothing picked again: back to what the canvas shows, and no line. And never, on the way
       there, the answer to the question just left read under no parts at all — every list of the
       paper, all open, until the new answer landed. */
    const seen: string[][] = []
    const watch = new MutationObserver(() => seen.push(drawn()))
    watch.observe(document.body, { childList: true, subtree: true, attributes: true })
    await say('context', canvas('chapters/4_results.tex', ['chapters/4_results.tex'], []))
    await waitFor(() => expect(drawn()).toEqual(['+Results 0/1', '+Thesis 0/1']))
    watch.disconnect()
    expect(notice()).toBe(false)
    expect(seen.flat().filter((one) => one.includes('Main') || one.includes('Design') || one.includes('Methods'))).toEqual([])
  })

  test('a neighbour still showing a file outside the picked part does not put that file’s list in front', async () => {
    render(<App />)
    const stale = canvas('chapters/3_methods.tex', ['chapters/3_methods.tex'], ['methods'])
    stale.containers.push({ module: 'kehikot.notes', selected: false, showing: { refs: [], documents: [place('main.tex')] } })
    await say('hello', stale)
    await waitFor(() => expect(drawn()).toEqual(['+Design 0/1', '+Methods 1/1', '+Thesis 0/1']))
    expect(notice()).toBe(false)
  })

  test('a container somebody picked out still narrows, and the parts are applied to what it shows', async () => {
    render(<App />)
    await say('hello', canvas('chapters/4_results.tex', ['chapters/4_results.tex'], ['methods', 'results'], { selected: true }))
    await waitFor(() => expect(drawn()).toEqual(['+Results 0/1', '+Thesis 0/1']))
    expect(notice()).toBe(false)

    /* And when what it shows is outside the pick, the chapter's list is put aside. */
    await say('context', canvas('chapters/4_results.tex', ['chapters/4_results.tex'], ['methods'], { selected: true }))
    await waitFor(() => expect(drawn()).toEqual(['+Thesis 0/1']))
    expect(notice()).toBe(false)
  })

  test('a list held against a reference follows the parts as it did: in front when a picked part lists it, put aside when none does', async () => {
    render(<App />)
    const refs = { methods: ['gh#105'] }
    await say('hello', canvas('main.tex', EVERY, [], { selection: ['gh#105'], refs }))
    await waitFor(() => expect(drawn()[0]).toBe('+Change 1/1'))

    await say('context', canvas('chapters/3_methods.tex', ['chapters/3_methods.tex'], ['methods'], { selection: ['gh#105'], refs }))
    await waitFor(() => expect(drawn()).toEqual(['+Change 1/1', '+Design 0/1', '+Methods 1/1', '+Thesis 0/1']))
    expect(notice()).toBe(false)

    await say('context', canvas('chapters/4_results.tex', ['chapters/4_results.tex'], ['results'], { selection: ['gh#105'], refs }))
    await waitFor(() => expect(drawn()).toEqual(['+Results 0/1', '+Thesis 0/1']))
    expect(notice()).toBe(false)
  })

  test('a part that owns nothing a list is held against says so, rather than showing the last part’s lists', async () => {
    /* No whole-paper list in this project, so the pick leaves nothing. */
    door('POST', '/api/checklist', new URLSearchParams(), { op: 'release', id: ids.Thesis, epic: EPIC, project: dir }, TICKET)
    store = readFileSync(join(dir, '.kehikot', 'checklist', 'checklists.json'), 'utf8')
    render(<App />)
    const empty = canvas('main.tex', ['main.tex'], ['methods'])
    empty.parts = [{ id: 'appendices', heading: 'Appendices', refs: [], picked: true, ...has('chapters/appendix.tex') }]
    await say('hello', empty)
    await waitFor(() => expect(document.querySelector('[data-none="narrowed"]')?.textContent).toBe('No checklist is in the picked part.'))
    /* The one sentence, in the empty place, and no row above it. */
    expect(document.querySelector('[data-focus]')).toBeNull()
    expect(document.body.textContent).not.toContain('outside the')
    expect(drawn()).toEqual([])
  })

  test('words typed on a list’s edit page and not sent are still there after the picks move', async () => {
    render(<App />)
    await say('hello', canvas('chapters/3_methods.tex', ['chapters/3_methods.tex'], ['methods']))
    await waitFor(() => expect(drawn()).toEqual(['+Design 0/1', '+Methods 1/1', '+Thesis 0/1']))
    fireEvent.click(document.querySelector(`[data-edit="${ids.Methods}"]`) as HTMLElement)
    const box = await waitFor(() => {
      const found = document.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input:not([type="checkbox"])')
      expect(found).toBeTruthy()
      return found!
    })
    fireEvent.change(box, { target: { value: 'half an item, typed and not sent' } })

    /* The pick leaves Methods — the list being edited is no longer in front on the reading page. */
    await say('context', canvas('chapters/4_results.tex', ['chapters/4_results.tex'], ['results']))
    await say('context', canvas('main.tex', EVERY, []))
    expect(document.contains(box)).toBe(true)
    expect(box.value).toBe('half an item, typed and not sent')
  })
})

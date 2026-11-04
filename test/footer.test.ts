import { describe, expect, test } from 'bun:test'
import { footerItemsSchema, headerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import { footerItems, tallyOf, tallySaid, type FooterState } from '../src/wire/footer.ts'
import { COPY, headerFor, pressed } from '../src/wire/header.ts'

/**
 * The footer the host draws: what is going on now, as readouts. The header is how the module is
 * set up, so nothing pressable is declared down here.
 */

const tally = { lists: 2, passed: 3, failed: 0, na: 1, total: 7 }
const base: FooterState = { view: 'here', trouble: null, tally, lists: 4, editing: null, aside: null, troubleInBar: true }
const parsed = (state: Partial<FooterState>): FooterItem[] => footerItemsSchema.parse(footerItems({ ...base, ...state }))
const byId = (items: FooterItem[], id: string) => items.find((one) => one.id === id)

describe('the footer declared', () => {
  test('the reading page says how far the lists in front have got, at the end of the row', () => {
    expect(byId(parsed({}), 'count')).toMatchObject({ kind: 'text', text: '2 checklists · 3/7 passed · 1 n/a', align: 'end', level: 'normal' })
  })

  test('a failure raises the count to warn, and a finished set says done', () => {
    expect(byId(parsed({ tally: { ...tally, failed: 2 } }), 'count')).toMatchObject({ level: 'warn', text: '2 checklists · 3/7 passed · 2 failed · 1 n/a' })
    expect((byId(parsed({ tally: { lists: 1, passed: 2, failed: 0, na: 1, total: 3 } }), 'count') as { text: string }).text).toEndWith('· done')
  })

  test('what was put aside rides in the count’s tooltip', () => {
    expect(byId(parsed({ aside: 'Two lists are put aside.' }), 'count')).toMatchObject({ tooltip: '2 checklists · 3/7 passed · 1 n/a. Two lists are put aside.' })
  })

  test('nothing is counted before the first answer', () => {
    expect(parsed({ tally: null })).toEqual([])
  })

  test('what went wrong stands first, in words and at critical', () => {
    const items = parsed({ trouble: 'The server did not answer.' })
    expect(items[0]).toMatchObject({ kind: 'text', id: 'trouble', level: 'critical', text: 'The server did not answer.' })
    expect(items.map((one) => one.id)).toEqual(['trouble', 'count'])
  })

  test('the manager counts the project’s checklists, and says trouble in its bar only as an overlay', () => {
    expect(parsed({ view: 'all' })).toMatchObject([{ id: 'count', text: '4 checklists in this project' }])
    expect(parsed({ view: 'all', lists: 1 })[0]).toMatchObject({ text: '1 checklist in this project' })
    expect(parsed({ view: 'all', trouble: 'No.' }).map((one) => one.id)).toEqual(['trouble', 'count'])
    expect(parsed({ view: 'all', trouble: 'No.', troubleInBar: false }).map((one) => one.id)).toEqual(['count'])
  })

  test('the edit page names the list open on it; Storage keeps its own rows', () => {
    expect(parsed({ view: 'edit', editing: 'Release', trouble: 'x' })).toMatchObject([{ id: 'editing', text: 'Editing Release' }])
    expect(parsed({ view: 'edit', editing: null })).toEqual([])
    expect(footerItems({ ...base, view: 'storage', trouble: 'x' })).toEqual([])
  })

  test('nothing in the footer can be pressed', () => {
    for (const view of ['here', 'all', 'edit'] as const) {
      for (const one of parsed({ view, editing: 'A', trouble: 'x' })) expect(one.kind).toBe('text')
    }
  })

  test('a long sentence is cut to the protocol’s limit', () => {
    const items = parsed({ trouble: 'x'.repeat(500) })
    expect((byId(items, 'trouble') as { text: string }).text.length).toBeLessThanOrEqual(120)
  })
})

describe('the tally', () => {
  test('adds every row of every list the way each list counts its own', () => {
    const rows = (...states: (null | 'passed' | 'failed' | 'na')[]) => states.map((state) => ({ done: state === null ? null : state === 'passed' ? {} : { state } }))
    const got = tallyOf([
      { rows: rows('passed', null, 'na'), total: 3 },
      { rows: rows('failed', 'passed'), total: 2 },
    ])
    expect(got).toEqual({ lists: 2, passed: 2, failed: 1, na: 1, total: 5 })
    expect(tallySaid({ lists: 0, passed: 0, failed: 0, na: 0, total: 0 })).toBe('0 checklists')
  })
})

describe('the header carries the copy', () => {
  test('on the manager only, as a Run item that says when it is choosing', () => {
    expect(headerFor('here').some((one) => one.id === COPY)).toBe(false)
    const items = headerItemsSchema.parse(headerFor('all'))
    expect(items.find((one) => one.id === COPY)).toMatchObject({ kind: 'run', label: 'Copy from another project', state: 'idle' })
    expect(headerFor('all', 'auto', { importing: true, busy: false }).find((one) => one.id === COPY)).toMatchObject({ label: 'Choosing…', state: 'busy' })
    expect(headerFor('all', 'auto', { importing: false, busy: true }).find((one) => one.id === COPY)).toMatchObject({ disabled: 'Working on something else.' })
  })

  test('a press of it asks for the copy', () => {
    expect(pressed({ item: COPY })).toEqual({ copy: true })
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { headerItemsSchema } from 'kehikot-module-protocol'

import type { Held } from '../list/checklists.ts'
import {
  failing,
  failingSaid,
  historyOf,
  levelOf,
  progressOf,
  progressOver,
  progressSaid,
  workingOn,
  workingSaid,
  type GlanceList,
} from '../list/glance.ts'
import { standingOf } from '../list/standing.ts'
import { STARTERS } from '../list/starters.ts'
import type { Target } from '../list/targets.ts'
import type { Here } from '../src/store/ask.ts'
import { concernsSaid } from '../src/components/glance.tsx'
import { HereView } from '../src/view/here.tsx'
import { room } from '../src/view/room.ts'
import { headerFor, pressed } from '../src/wire/header.ts'

/**
 * The glance: which item, its progress, what failed or is blocked, what is being worked on — and
 * how much more is drawn as the container grows. happy-dom performs no layout, so what FITS at
 * 200, 280 and 380 px is a container-query question for a real browser; what is asserted here is
 * which level each size gets and which words each level draws.
 */
afterEach(cleanup)

const REF: Target = { kind: 'ref', ref: 'gh#105' }
const tick = (state: string, at: string, note?: string) => ({ state, at, by: 'claude', viaMcp: true, ...(note ? { note } : {}) }) as never

function list(): GlanceList {
  return {
    checklist: { id: 'l1', name: 'PR standards' },
    rows: [
      { item: { id: 'a', text: 'Tests added' }, done: tick('passed', '2026-11-01T10:00:00Z') },
      { item: { id: 'b', text: 'No secrets' }, done: tick('na', '2026-11-02T10:00:00Z') },
      { item: { id: 'c', text: 'Follows patterns' }, done: tick('working', '2026-11-03T10:00:00Z') },
      { item: { id: 'd', text: 'Says why' }, done: tick('failed', '2026-11-03T11:00:00Z', 'no description') },
      { item: { id: 'e', text: 'One change' }, done: tick('blocked', '2026-11-03T12:00:00Z', 'waiting on review') },
      { item: { id: 'f', text: 'Docs updated' }, done: null },
    ],
  }
}

describe('the glance, pure', () => {
  test('levels follow the container: glance when short, items, full at 560 × 560', () => {
    expect(levelOf(200, 200)).toBe('glance')
    expect(levelOf(380, 239)).toBe('glance')
    for (const width of [200, 280, 380]) expect(levelOf(width, 400)).toBe('items')
    expect(levelOf(560, 560)).toBe('full')
    expect(levelOf(900, 500)).toBe('items')
    /* Not measured: the items, as before there were levels. */
    expect(levelOf(0, 0)).toBe('items')
    expect(room(200, 200).level).toBe('glance')
  })

  test('one or two rows tall is one line; a one-column container goes to lines sooner, as its tiles stack', () => {
    for (const height of [24, 40, 68, 149]) expect(levelOf(200, height)).toBe('line')
    expect(levelOf(200, 150)).toBe('glance')
    expect(levelOf(280, 120)).toBe('line')
    expect(levelOf(380, 95)).toBe('line')
    expect(levelOf(380, 96)).toBe('glance')
    expect(levelOf(380, 120)).toBe('glance')
    expect(room(200, 40).level).toBe('line')
  })

  test('progress counts every state; answered is passed and not applicable', () => {
    expect(progressOf([list()])).toEqual({ total: 6, answered: 2, passed: 1, na: 1, failed: 1, blocked: 1, working: 1, unchecked: 1 })
  })

  test('the answers come in over time, from the ticks there are', () => {
    const steps = progressOver([list()], Date.parse('2026-11-04T00:00:00Z'))
    expect(steps.map((one) => one.answered)).toEqual([0, 1, 2, 2])
    expect(steps.at(-1)!.at).toBe(Date.parse('2026-11-04T00:00:00Z'))
    expect(progressOver([{ checklist: { id: 'x', name: 'x' }, rows: [] }], 0)).toEqual([])
  })

  test('what is being worked on and what failed are named, the latest first, with their words', () => {
    expect(workingOn([list()]).map((one) => one.text)).toEqual(['Follows patterns'])
    expect(failing([list()]).map((one) => one.text)).toEqual(['One change', 'Says why'])
    expect(workingSaid(workingOn([list()]))).toBe('Being worked on: “Follows patterns”.')
    expect(failingSaid(progressOf([list()]), failing([list()]))).toBe('1 failed, 1 blocked. Latest: “One change” blocked — waiting on review.')
    expect(progressSaid(progressOf([list()]), progressOver([list()], 0))).toContain('2 of 6 answered (1 passed, 1 not applicable).')
    expect(historyOf([list()])).toHaveLength(5)
  })

  test('the line saying which item', () => {
    expect(concernsSaid({ kind: 'Pull request', name: 'gh#105', title: 'Fix the login race' })).toBe('Pull request gh#105 · Fix the login race')
    expect(concernsSaid({ kind: null, name: 'thesis', title: null })).toBe('thesis')
  })
})

function held(): Held {
  const rows = list().rows.map((row) => ({ item: { ...row.item, at: '2026-11-01T00:00:00Z', by: 'the owner' }, done: row.done }))
  return {
    checklist: { id: 'l1', name: 'PR standards', at: '', by: 'the owner', origin: null, items: rows.map((row) => row.item), holds: 0, next: 0, applies: [{ types: ['pr'], roles: ['any'], since: '' }] },
    target: REF,
    through: [{ kind: 'rule', types: ['pr'], roles: ['any'], epic: null }],
    as: ['any'],
    rows,
    done: 1,
    counts: { passed: 1, failed: 1, na: 1, working: 1, blocked: 1, unchecked: 1 },
    total: 6,
  } as Held
}
const here = (): Here => ({ placed: null, positions: [], instances: [held()], items: [{ target: REF, type: 'pr', as: ['any'], elsewhere: [] }], trouble: null, nowhere: false, whole: false, undecided: [] }) as Here

function page(width: number, height: number) {
  const sent: unknown[] = []
  const drawn = render(
    <HereView here={here()} items={here().items} onEdit={(one) => sent.push(one)} onOpen={() => {}} onAll={() => {}} trouble={null} busy={false} room={room(width, height)} />,
  )
  return { ...drawn, sent }
}

describe('the reading page, by level', () => {
  test('a short container draws each item at a glance, and no lines', () => {
    for (const width of [200, 280, 380]) {
      const { container, unmount } = page(width, 200)
      expect(container.querySelector('[data-level="glance"]')).not.toBeNull()
      expect(container.querySelector('[data-glance="gh#105"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="tile-progress-value"]')?.textContent).toBe('2/6')
      expect(container.querySelector('[data-testid="tile-failing-value"]')?.textContent).toBe('1 failing · 1 blocked')
      expect(container.querySelector('[data-testid="tile-working-value"]')?.textContent).toBe('1 underway')
      expect(container.querySelector('[data-testid="tile-working"]')?.textContent).toContain('Follows patterns')
      expect(container.querySelector('[data-concerns]')?.textContent).toBe('Pull request gh#105')
      expect(container.querySelector('[data-item]')).toBeNull()
      /* Every chart has its sentence. */
      for (const chart of container.querySelectorAll('[role="img"]')) expect(chart.getAttribute('aria-label')?.length).toBeGreaterThan(10)
      unmount()
    }
  })

  test('a bigger one draws the glance and the lines with their states; the standing list is called standard', () => {
    const { container } = page(380, 400)
    expect(container.querySelector('[data-glance="gh#105"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-item]')).toHaveLength(6)
    expect(container.querySelector('[data-item="c"]')?.getAttribute('data-state')).toBe('working')
    expect(container.querySelector('[data-item="e"]')?.getAttribute('data-state')).toBe('blocked')
    expect(container.querySelector('[data-standing]')?.textContent).toBe('Standard')
    expect(container.querySelector('[data-count-more]')?.textContent).toBe('1 failed · 1 blocked · 1 working · 1 n/a')
    expect(container.querySelector('[data-history]')).toBeNull()
  })

  test('the largest draws the history: who answered what, and how they know', () => {
    const { container } = page(900, 700)
    const history = container.querySelector('[data-history]')
    expect(history?.textContent).toContain('History · 5 answers')
    expect(history?.textContent).toContain('Blocked · One change')
    expect(history?.textContent).toContain('claude')
    expect(history?.textContent).toContain('waiting on review')
  })

  test('a row sets working and blocked, and a second press takes it back', () => {
    const { container, sent } = page(380, 400)
    fireEvent.click(container.querySelector('[data-item="f"] [data-set="working"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-item="c"] [data-set="working"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-item="f"] [data-set="blocked"]') as HTMLElement)
    const at = (item: string) => ({ op: 'tick', id: 'l1', item, target: REF })
    expect(sent).toEqual([
      { ...at('f'), done: true, state: 'working' },
      { ...at('c'), done: false },
      { ...at('f'), done: true, state: 'blocked' },
    ])
  })
})

describe('standing and one-off', () => {
  test('a list that applies to a kind is standard; held by hand, or one item’s own lines, is one-off', () => {
    expect(standingOf({ applies: [{}] })).toBe('standard')
    expect(standingOf({ applies: [] })).toBe('one-off')
    expect(standingOf({})).toBe('one-off')
    expect(standingOf({ applies: [{}], only: 'ref:gh#1' })).toBe('one-off')
  })

  test('the starters are standing checklists with lines, each for a kind', () => {
    for (const one of STARTERS) {
      expect(one.items.length).toBeGreaterThan(2)
      expect(one.types.length).toBeGreaterThan(0)
    }
    expect(STARTERS.map((one) => one.id)).toEqual(['changes', 'issues', 'papers'])
  })
})

describe('the header: which checklist, manage, create', () => {
  const starters = STARTERS.map((one) => ({ id: one.id, name: one.name, adopted: one.id === 'issues' }))
  test('declares the screens, a checklist switch when more than one is in front, the angle, and the Create menu', () => {
    const items = headerItemsSchema.parse(
      headerFor('here', 'auto', { lists: [{ id: 'a', name: 'PR standards' }, { id: 'b', name: 'Only for gh#105' }], picked: 'b', starters }),
    )
    expect(items.map((one) => one.id)).toEqual(['view', 'list', 'angle', 'new', 'adopt:changes', 'adopt:issues', 'adopt:papers', 'copy'])
    expect(items.find((one) => one.id === 'list')).toMatchObject({ kind: 'switch', value: 'b' })
    expect(items.find((one) => one.id === 'adopt:issues')).toMatchObject({ disabled: 'Adopted already: edit it under Manage checklists.' })
    /* One list in front, or the manager: no checklist switch. */
    expect(headerFor('here', 'auto', { lists: [{ id: 'a', name: 'x' }] }).map((one) => one.id)).not.toContain('list')
    expect(headerFor('all', 'auto', { lists: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }] }).map((one) => one.id)).not.toContain('list')
    /* A pick of a list not in front is every list. */
    expect(headerFor('here', 'auto', { lists: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }], picked: 'gone' }).find((one) => one.id === 'list')).toMatchObject({ value: 'all' })
  })

  test('a press says what it asks for', () => {
    expect(pressed({ item: 'list', value: 'all' })).toEqual({ pick: null })
    expect(pressed({ item: 'list', value: 'a' })).toEqual({ pick: 'a' })
    expect(pressed({ item: 'new' })).toEqual({ make: 'new' })
    expect(pressed({ item: 'copy' })).toEqual({ make: 'copy' })
    expect(pressed({ item: 'adopt:changes' })).toEqual({ adopt: 'changes' })
    expect(pressed({ item: 'view', value: 'all' })).toEqual({ view: 'all' })
    expect(typeof pressed({ item: 'nope' })).toBe('string')
  })
})

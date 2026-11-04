import { describe, expect, test } from 'bun:test'
import { footerItemsSchema, footerLayout, type FooterItem } from 'kehikot-module-protocol'

import { footerItems, footerPressed, type FooterState } from '../src/wire/footer.ts'
import type { Progress } from '../list/glance.ts'

/**
 * The footer the host draws: what is going on now, by the person's rule — the item the lists
 * concern, its progress, what failed or is blocked, what is being worked on. Nothing pressable:
 * Manage, Storage and Copy are the header's.
 */

const progress = (over: Partial<Progress> = {}): Progress => ({ total: 8, answered: 3, passed: 2, na: 1, failed: 0, blocked: 0, working: 0, unchecked: 5, ...over })
const base: FooterState = {
  view: 'here',
  trouble: null,
  troubleInBar: true,
  concerns: { said: 'Pull request gh#105 · Fix the login race', more: 0 },
  progress: progress(),
  working: [],
  standing: { standards: 2, oneOff: 1 },
  aside: null,
}
const parsed = (state: Partial<FooterState>): FooterItem[] => footerItemsSchema.parse(footerItems({ ...base, ...state }))
const byId = (items: FooterItem[], id: string) => items.find((one) => one.id === id)

describe('the footer declared', () => {
  test('the reading page says which item, and its progress as a meter', () => {
    const items = parsed({})
    expect(items.map((one) => one.id)).toEqual(['concerns', 'progress'])
    expect(byId(items, 'concerns')).toMatchObject({ kind: 'text', text: 'Pull request gh#105 · Fix the login race' })
    expect(byId(items, 'progress')).toMatchObject({ kind: 'meter', value: 3 / 8, text: '3/8', level: 'normal' })
  })

  test('failed and blocked are said in words, at critical or warn, and the meter says it too', () => {
    const items = parsed({ progress: progress({ failed: 2, blocked: 1 }) })
    expect(byId(items, 'failing')).toMatchObject({ kind: 'text', text: '2 failing · 1 blocked', level: 'critical' })
    expect(byId(items, 'progress')).toMatchObject({ level: 'critical' })
    expect(byId(parsed({ progress: progress({ blocked: 1 }) }), 'failing')).toMatchObject({ text: '1 blocked', level: 'warn' })
  })

  test('what is being worked on is said, and is the first to go when the row is narrow', () => {
    const items = parsed({ working: ['Tests added', 'No secrets'] })
    expect(byId(items, 'working')).toMatchObject({ text: 'Working: Tests added +1', optional: true })
    const drawn = (width: number) => {
      const laid = footerLayout(items, width)
      return [...laid.start, ...laid.center, ...laid.end].map((one) => one.id)
    }
    expect(drawn(380)).toContain('working')
    expect(drawn(280)).not.toContain('working')
    /* At 200 the first text stays: which item. */
    expect(drawn(200)).toContain('concerns')
  })

  test('with its ref given, the row names the ref and the tooltip the whole item: the glance’s one line, kept at 200 px', () => {
    const items = parsed({ concerns: { said: 'Pull request gh#105 · Fix the login race', short: 'gh#105', more: 0 }, progress: progress({ total: 12, answered: 7, failed: 2, blocked: 1 }) })
    expect(byId(items, 'concerns')).toMatchObject({ text: 'gh#105' })
    expect((byId(items, 'concerns') as { tooltip: string }).tooltip).toContain('Fix the login race')
    expect(byId(items, 'progress')).toMatchObject({ text: '7/12' })
    expect((byId(items, 'progress') as { tooltip: string }).tooltip).toContain('7/12 done · 2 failing · 1 blocked')
    expect(byId(items, 'failing')).toMatchObject({ text: '2 failing · 1 blocked' })
    const drawn = (width: number) => {
      const laid = footerLayout(items, width)
      return [...laid.start, ...laid.center, ...laid.end].map((one) => one.id)
    }
    expect(drawn(280)).toEqual(['concerns', 'progress', 'failing'])
    expect(drawn(200)).toContain('concerns')
    expect(drawn(200)).toContain('progress')
  })

  test('several items picked: the first is named, with how many more', () => {
    expect(byId(parsed({ concerns: { said: 'Issue #4', more: 2 } }), 'concerns')).toMatchObject({ text: 'Issue #4 +2' })
  })

  test('nothing picked says so; no meter for an item with no lines', () => {
    expect(parsed({ concerns: null }).map((one) => one.id)).toEqual(['concerns'])
    expect(parsed({ progress: progress({ total: 0, answered: 0 }) }).map((one) => one.id)).toEqual(['concerns'])
  })

  test('what went wrong stands first, in words and at critical', () => {
    const items = parsed({ trouble: 'The server did not answer.' })
    expect(items[0]).toMatchObject({ kind: 'text', id: 'trouble', level: 'critical', text: 'The server did not answer.' })
  })

  test('the manager counts standing and one-off checklists; trouble in its bar only where it composes as an overlay', () => {
    expect(byId(parsed({ view: 'all' }), 'standing')).toMatchObject({ text: '2 standing · 1 one-off' })
    expect(parsed({ view: 'all', trouble: 'No.' }).map((one) => one.id)).toEqual(['trouble', 'standing'])
    expect(parsed({ view: 'all', trouble: 'No.', troubleInBar: false }).map((one) => one.id)).toEqual(['standing'])
  })

  test('nothing in the footer is pressable: managing and creating are the header’s', () => {
    for (const state of [{}, { view: 'all' as const }, { working: ['x'], progress: progress({ failed: 1 }) }]) {
      expect(parsed(state).every((one) => one.kind === 'text' || one.kind === 'meter')).toBe(true)
    }
    expect(footerPressed('progress')).toContain('is a readout')
  })

  test('the edit page, the import screen and Storage keep their own rows', () => {
    for (const view of ['edit', 'storage'] as const) expect(footerItems({ ...base, view, trouble: 'x' })).toEqual([])
  })

  test('a long sentence is cut to the protocol’s limit', () => {
    const items = parsed({ trouble: 'x'.repeat(500), concerns: { said: 'y'.repeat(500), more: 0 } })
    expect((byId(items, 'trouble') as { text: string }).text.length).toBeLessThanOrEqual(120)
    expect((byId(items, 'concerns') as { text: string }).text.length).toBeLessThanOrEqual(120)
  })
})

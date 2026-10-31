import { describe, expect, test } from 'bun:test'
import { footerItemsSchema, footerLayout, type FooterItem } from 'kehikot-module-protocol'

import { FOOT, footerItems, footerPressed, type FooterState } from '../src/wire/footer.ts'

/** The footer the host draws: the items declared for each screen's bar. */

const base: FooterState = { view: 'here', trouble: null, busy: false, importing: false, canStorage: true, aside: null, troubleInBar: true }
const parsed = (state: Partial<FooterState>): FooterItem[] => footerItemsSchema.parse(footerItems({ ...base, ...state }))
const byId = (items: FooterItem[], id: string) => items.find((one) => one.id === id)

describe('the footer declared', () => {
  test('the reading page ends in Manage checklists, with what was put aside as its hint', () => {
    expect(parsed({}).map((one) => one.id)).toEqual(['manage'])
    expect(byId(parsed({ aside: 'Two lists are put aside.' }), 'manage')).toMatchObject({ kind: 'run', label: 'Manage checklists', tooltip: 'Two lists are put aside.', align: 'end' })
  })

  test('what went wrong stands first, in words and at critical', () => {
    const items = parsed({ trouble: 'The server did not answer.' })
    expect(items[0]).toMatchObject({ kind: 'text', id: 'trouble', level: 'critical', text: 'The server did not answer.' })
    expect(items.map((one) => one.id)).toEqual(['trouble', 'manage'])
  })

  test('the manager: Copy from another project, and Storage, which goes first when the row is narrow', () => {
    const items = parsed({ view: 'all' })
    expect(items.map((one) => one.id)).toEqual(['import', 'storage'])
    expect(byId(items, 'import')).toMatchObject({ label: 'Copy from another project', disabled: null })
    expect(byId(items, 'storage')).toMatchObject({ optional: true })
    expect(footerLayout(items, 200).overflow.map((one) => one.id)).toContain('storage')
    expect(byId(parsed({ view: 'all', importing: true }), 'import')).toMatchObject({ label: 'Choosing…', disabled: 'Choosing a project already.' })
    expect(byId(parsed({ view: 'all', busy: true }), 'import')).toMatchObject({ disabled: 'Working on something else.' })
    expect(parsed({ view: 'all', canStorage: false }).map((one) => one.id)).toEqual(['import'])
  })

  test('the manager says trouble in its bar only where the page composes as an overlay; flowing, the form says it', () => {
    expect(parsed({ view: 'all', trouble: 'No.' }).map((one) => one.id)).toEqual(['trouble', 'import', 'storage'])
    expect(parsed({ view: 'all', trouble: 'No.', troubleInBar: false }).map((one) => one.id)).toEqual(['import', 'storage'])
  })

  test('the edit page, the import screen and Storage keep their own rows', () => {
    for (const view of ['edit', 'storage'] as const) expect(footerItems({ ...base, view, trouble: 'x' })).toEqual([])
  })

  test('a long sentence is cut to the protocol’s limit', () => {
    const items = parsed({ trouble: 'x'.repeat(500) })
    expect((byId(items, 'trouble') as { text: string }).text.length).toBeLessThanOrEqual(120)
  })
})

describe('a press in the footer', () => {
  test('is judged against the screen on show', () => {
    expect(footerPressed(FOOT.MANAGE, base)).toBe('manage')
    expect(footerPressed(FOOT.MANAGE, { ...base, view: 'all' })).toBe('That is not here now.')
    expect(footerPressed(FOOT.IMPORT, { ...base, view: 'all' })).toBe('import')
    expect(footerPressed(FOOT.IMPORT, { ...base, view: 'all', importing: true })).toBe('Choosing a project already.')
    expect(footerPressed(FOOT.IMPORT, { ...base, view: 'all', busy: true })).toBe('Working on something else.')
    expect(footerPressed(FOOT.IMPORT, base)).toBe('That is not here now.')
    expect(footerPressed(FOOT.STORAGE, { ...base, view: 'all' })).toBe('storage')
    expect(footerPressed('trouble', base)).toBe('That is not something here.')
  })
})

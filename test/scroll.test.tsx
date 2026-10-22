import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'

import type { Held } from '../list/checklists.ts'
import type { Target } from '../list/targets.ts'
import { AllView } from '../src/view/all.tsx'
import { HereView } from '../src/view/here.tsx'
import { Importing } from '../src/view/importing.tsx'
import { room } from '../src/view/room.ts'
import type { Here } from '../src/store/ask.ts'

/**
 * A snapping scroller's first snap area is the first thing in it
 * (Jalez/kehikko-checklist#16).
 *
 * The reading page's scroller snapped to its item rows and to nothing else, so
 * its first snap position was the first row of the first list — under that
 * list's name, label and Edit press. WebKit drew the scroller there and would
 * not let it rest any higher: `scrollTop` was 48 at rest, after `scrollTo(0)`
 * and after a wheel up, and the header could not be reached.
 *
 * happy-dom has no layout and no scrolling, so where a scroller rests is
 * `dev/scroll.probe.mjs`, in WebKit. What can be said here is the structure
 * that caused it: in a scroller that snaps, nothing drawn comes before the
 * first snap area — and, on the reading page, every list's header is one too,
 * so the second list and the ninth have a place to rest with their name at
 * the top edge.
 */
afterEach(cleanup)

const TIGHT = room(220, 300)
const ROOMY = room(900, 700)
const noop = () => {}

/**
 * Whether the scroller's content starts with a snap area: its own `::before`
 * is one, or, walking down first children from the scroller, one of them
 * snaps. Anything else means there is content above every snap position.
 */
function leadsWithSnap(scroller: Element): boolean {
  if (scroller.classList.contains('before:snap-start')) return true
  for (let at = scroller.firstElementChild; at; at = at.firstElementChild) {
    if (at.classList.contains('snap-start')) return true
  }
  return false
}

function held(id: string, target: Target): Held {
  const rows = [
    { item: { id: `${id}-a`, text: 'First', at: '2026-01-01T00:00:00Z', by: 'the owner' }, done: null },
    { item: { id: `${id}-b`, text: 'Second', at: '2026-01-01T00:00:00Z', by: 'the owner' }, done: null },
  ]
  return {
    checklist: {
      id,
      name: `List ${id}`,
      at: '2026-01-01T00:00:00Z',
      by: 'the owner',
      origin: null,
      items: rows.map((row) => row.item),
      holds: 0,
      next: 0,
    },
    target,
    rows,
    done: 0,
    total: 2,
  } as Held
}

const TWO: Here = {
  placed: null,
  positions: [],
  instances: [
    held('one', { kind: 'paper', epic: 'thesis', section: null }),
    held('two', { kind: 'ref', ref: 'gh#105' }),
  ],
  trouble: null,
  nowhere: false,
  whole: false,
}

function reading(here: Here, size = TIGHT) {
  return render(
    <HereView here={here} onEdit={noop} onOpen={noop} onAll={noop} trouble={null} busy={false} room={size} />,
  ).container
}

describe('a snapping scroller can rest at its top', () => {
  test('the reading page: the scroller starts with a snap area of its own, with several lists and with one', () => {
    for (const here of [TWO, { ...TWO, instances: TWO.instances.slice(0, 1) }]) {
      const scroller = reading(here).querySelector('[data-scroller="instances"]') as HTMLElement
      expect(scroller.className).toContain('snap-y')
      expect(leadsWithSnap(scroller)).toBe(true)
      /* The scroller's own, and not the first list's header: a list that
         arrives above the first one is then drawn at the top, where a snap
         held by the header would follow the header down past it. */
      for (const name of ['before:snap-start', 'before:block', 'before:h-0']) {
        expect(scroller.classList.contains(name)).toBe(true)
      }
      /* Nothing was put in the scroller to do it: the items' sections are still its only children, and each one's
         first line — the angle — is a place to rest too. */
      expect([...scroller.children].every((one) => one.hasAttribute('data-section'))).toBe(true)
      expect([...scroller.querySelectorAll('[data-angle]')].every((one) => one.classList.contains('snap-start'))).toBe(true)
      cleanup()
    }
  })

  test('the reading page: every list’s header snaps, folded or open', () => {
    const container = reading(TWO)
    const lists = [...container.querySelectorAll('[data-instance]')]
    expect(lists.length).toBe(2)
    for (const list of lists) {
      expect(list.firstElementChild?.classList.contains('snap-start')).toBe(true)
      expect(list.firstElementChild?.querySelector('[data-edit]')).toBeTruthy()
    }
  })

  test('the other two snapping scrollers lead with a snap area too', () => {
    const lists = [
      { id: 'one', name: 'One', at: '', by: 'a test', items: 3, targets: 0, held: [] },
      { id: 'two', name: 'Two', at: '', by: 'a test', items: 1, targets: 0, held: [] },
    ]
    const all = render(
      <AllView
        lists={lists}
        onOpen={noop}
        onCreate={noop}
        onImport={noop}
        onBack={noop}
        importing={false}
        trouble={null}
        busy={false}
        said={null}
        room={TIGHT}
      />,
    ).container.querySelector('[data-scroller="lists"]') as HTMLElement
    expect(all.className).toContain('snap-y')
    expect(leadsWithSnap(all)).toBe(true)
    cleanup()

    const importable = render(
      <Importing
        from="another"
        lists={lists}
        onImport={noop}
        onCancel={noop}
        trouble={null}
        busy={false}
        reading={false}
        room={TIGHT}
      />,
    ).container.querySelector('[data-scroller="importable"]') as HTMLElement
    expect(importable.className).toContain('snap-y')
    expect(leadsWithSnap(importable)).toBe(true)
  })

  test('with room to flow nothing snaps, so there is nothing to lead', () => {
    const container = reading(TWO, ROOMY)
    expect(container.querySelector('[data-scroller]')).toBeNull()
    expect(container.querySelector('.snap-start')).toBeNull()
  })
})

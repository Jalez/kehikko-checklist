import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

import type { Held } from '../list/checklists.ts'
import { failing, progressOf, progressOver, workingOn, type GlanceList, type Progress } from '../list/glance.ts'
import type { Target } from '../list/targets.ts'
import type { Here } from '../src/store/ask.ts'
import {
  AXES_FROM,
  glanceLayout,
  glanceLine,
  ringArcs,
  segmentAt,
  segmentTip,
  stepAt,
  stepped,
  stepTip,
  summaryTip,
  tipAlign,
  troubleSaid,
} from '../src/components/glance-layout.ts'
import { TOUCH_MS, resetTips } from '../src/lib/one-tip.ts'
import { HereView } from '../src/view/here.tsx'
import { room } from '../src/view/room.ts'

/**
 * The glance in its smallest containers: what each width and height draws, and what each tooltip
 * says. happy-dom performs no layout, so what FITS is the layout function's claim (held here at the
 * widths it was written for); what is asserted on the page is which of those claims it obeys and
 * which words it draws.
 */
afterEach(cleanup)
beforeEach(resetTips)

const REF: Target = { kind: 'ref', ref: 'gh#105' }
const tick = (state: string, at: string, note?: string) => ({ state, at, by: 'claude', viaMcp: true, ...(note ? { note } : {}) }) as never
const p = (over: Partial<Progress> = {}): Progress => ({ total: 12, answered: 7, passed: 6, na: 1, failed: 2, blocked: 1, working: 1, unchecked: 1, ...over })

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

describe('the layout at each width', () => {
  test('one column under 360, three from it; axes only on a tile of 260 px or more', () => {
    expect(glanceLayout(200)).toEqual({ columns: 1, tile: 184, axes: false, plot: 24, ring: 24 })
    expect(glanceLayout(260).axes).toBe(false)
    expect(glanceLayout(280)).toMatchObject({ columns: 1, tile: 264, axes: true, plot: 64, ring: 48 })
    expect(glanceLayout(380)).toMatchObject({ columns: 3, tile: 117, axes: false, plot: 24 })
    expect(glanceLayout(900)).toMatchObject({ columns: 3, axes: true })
    /* Not measured: the smallest, never a guess at roomy. */
    expect(glanceLayout(0)).toEqual({ columns: 1, tile: null, axes: false, plot: 24, ring: 24 })
    for (const width of [200, 240, 259 + 16]) expect(glanceLayout(width).tile! < AXES_FROM).toBe(true)
    expect(room(200, 200).glance.columns).toBe(1)
  })
})

describe('what is said', () => {
  test('the summary, the one line, and the trouble words', () => {
    expect(summaryTip(p())).toBe('7/12 done · 2 failing · 1 blocked · 1 working')
    expect(summaryTip(p({ failed: 0, blocked: 0, working: 0 }))).toBe('7/12 done')
    expect(summaryTip(p({ total: 0 }))).toBe('No lines yet')
    expect(glanceLine('gh#123', p())).toBe('gh#123 · 7/12 · 2 failing · 1 blocked')
    expect(glanceLine('gh#123', p({ blocked: 0 }))).toBe('gh#123 · 7/12 · 2 failing')
    expect(glanceLine('gh#123', p({ failed: 0, blocked: 0 }))).toBe('gh#123 · 7/12')
    expect(glanceLine('gh#123', p({ total: 0 }))).toBe('gh#123 · no lines')
    expect(troubleSaid(p({ failed: 0 }))).toBe('1 blocked')
  })

  test('a point of the progress chart: when it was ticked, the day when not today, and now at the end', () => {
    const at = (h: number, m: number, d = 4) => new Date(2026, 10, d, h, m).getTime()
    const steps = [{ at: at(9, 10) - 1, answered: 0 }, { at: at(9, 10), answered: 1 }, { at: at(14, 2), answered: 3 }, { at: at(16, 0), answered: 3 }]
    const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    expect(stepTip(steps, 2, 12, at(16, 0))).toBe(`3 ticked at ${clock(at(14, 2))}`)
    expect(stepTip(steps, 0, 12, at(16, 0))).toBe(`None ticked before ${clock(at(9, 10))}`)
    expect(stepTip(steps, 3, 12, at(16, 0))).toBe('3/12 now')
    const day = new Date(at(14, 2)).toLocaleDateString([], { month: 'short', day: 'numeric' })
    expect(stepTip(steps, 2, 12, at(10, 0, 6))).toBe(`3 ticked at ${clock(at(14, 2))}, ${day}`)
    expect(stepTip(steps, 9, 12, 0)).toBe('')
  })

  test('a segment of the stacked bar names its count and the latest line in that state', () => {
    const lists = [list()]
    const rows = [...failing(lists), ...workingOn(lists)]
    const progress = progressOf(lists)
    expect(segmentTip('failed', progress, rows)).toBe('1 failing of 6 · “Says why”')
    expect(segmentTip('blocked', progress, rows)).toBe('1 blocked of 6 · “One change”')
    expect(segmentTip('working', progress, rows)).toBe('1 working of 6 · “Follows patterns”')
    expect(segmentTip('unchecked', progress, rows)).toBe('1 open of 6')
    expect(segmentTip('na', progress, rows)).toBe('1 not applicable of 6')
  })

  test('the ring: answered, then failing, then blocked, as shares from twelve o’clock', () => {
    expect(ringArcs(p())).toEqual([
      { key: 'answered', from: 0, share: 7 / 12 },
      { key: 'failed', from: 7 / 12, share: 2 / 12 },
      { key: 'blocked', from: 9 / 12, share: 1 / 12 },
    ])
    expect(ringArcs(p({ total: 0 }))).toEqual([])
  })
})

describe('pointing and keys', () => {
  test('a pointer across the progress chart is on the step it is over; across the bar, on its segment', () => {
    const steps = [{ at: 0, answered: 0 }, { at: 10, answered: 1 }, { at: 50, answered: 2 }, { at: 100, answered: 2 }]
    expect(stepAt(steps, 0)).toBe(0)
    expect(stepAt(steps, 0.2)).toBe(1)
    expect(stepAt(steps, 0.6)).toBe(2)
    expect(stepAt(steps, 1)).toBe(3)
    expect(stepAt([], 0.5)).toBeNull()
    /* passed 2, na 0, failed 2: the empty segment is never pointed at. */
    expect(segmentAt([2, 0, 2], 0.1)).toBe(0)
    expect(segmentAt([2, 0, 2], 0.6)).toBe(2)
    expect(segmentAt([2, 0, 2], 1)).toBe(2)
    expect(segmentAt([0, 0], 0.5)).toBeNull()
  })

  test('arrows move among the points there are, Home and End jump, Escape closes, other keys are not ours', () => {
    const usable = (i: number) => i !== 1
    expect(stepped('ArrowRight', null, 3, usable)).toBe(0)
    expect(stepped('ArrowRight', 0, 3, usable)).toBe(2)
    expect(stepped('ArrowLeft', 2, 3, usable)).toBe(0)
    expect(stepped('ArrowLeft', null, 3)).toBe(2)
    expect(stepped('End', null, 3)).toBe(2)
    expect(stepped('Home', 2, 3)).toBe(0)
    expect(stepped('Escape', 1, 3)).toBeNull()
    expect(stepped('Escape', null, 0)).toBeNull()
    expect(stepped('a', 1, 3)).toBeUndefined()
    expect(stepped('ArrowRight', null, 0)).toBeUndefined()
  })

  test('a tooltip stays inside its plot', () => {
    expect(tipAlign(0, 10)).toBe('start')
    expect(tipAlign(5, 10)).toBe('center')
    expect(tipAlign(9, 10)).toBe('end')
    expect(tipAlign(null, 10)).toBe('start')
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
const page = (width: number, height: number) =>
  render(<HereView here={here()} items={here().items} onEdit={() => {}} onOpen={() => {}} onAll={() => {}} trouble={null} busy={false} room={room(width, height)} />)
const tip = (root: ParentNode) => root.querySelector('[role="tooltip"]')?.textContent ?? null

describe('the page at its smallest', () => {
  test('one or two rows tall: one line with a tiny ring, no tiles, no lines', () => {
    for (const [width, height] of [[200, 40], [280, 68], [380, 60]] as const) {
      const { container, unmount } = page(width, height)
      expect(container.querySelector('[data-level="line"]')).not.toBeNull()
      expect(container.querySelector('[data-line-text]')?.textContent).toBe('gh#105 · 2/6 · 1 failing · 1 blocked')
      expect(container.querySelector('[data-glance-line] svg[data-ring="14"]')).not.toBeNull()
      expect(container.querySelector('[data-testid^="tile-"]')).toBeNull()
      expect(container.querySelector('[data-item]')).toBeNull()
      unmount()
    }
  })

  test('the line’s tooltip says the whole item, on focus and on hover, and Escape closes it', () => {
    const { container } = page(200, 40)
    const line = container.querySelector('[data-testid="glance-line"]') as HTMLElement
    expect(line.getAttribute('aria-label')).toBe('Pull request gh#105: 2/6 done · 1 failing · 1 blocked · 1 working.')
    expect(tip(container)).toBeNull()
    fireEvent.focus(line)
    expect(tip(container)).toBe('Pull request gh#105 · 2/6 done · 1 failing · 1 blocked · 1 working')
    expect(line.getAttribute('aria-describedby')).toBe(container.querySelector('[role="tooltip"]')!.id)
    fireEvent.keyDown(line, { key: 'Escape' })
    expect(tip(container)).toBeNull()
    fireEvent.blur(line)
    fireEvent.pointerEnter(line)
    expect(tip(container)).toContain('2/6 done')
    fireEvent.pointerLeave(line)
    expect(tip(container)).toBeNull()
  })

  test('200 px and short: tiles stacked, title and number in a row above a sparkline with no axes', () => {
    const { container } = page(200, 200)
    const glance = container.querySelector('[data-glance]') as HTMLElement
    expect(glance.getAttribute('data-columns')).toBe('1')
    expect(glance.hasAttribute('data-axes')).toBe(false)
    const progress = container.querySelector('[data-testid="tile-progress"]') as HTMLElement
    /* The number is in the title's row, and the plot is a sibling below it — never inside it. */
    const row = progress.querySelector('[data-testid="tile-progress-value"]')!.parentElement!
    expect(row.querySelector('h3')?.textContent).toBe('Progress')
    expect(row.querySelector('[data-testid="plot-progress"]')).toBeNull()
    expect(progress.querySelector('[data-testid="plot-progress"] svg[data-ring="24"]')).not.toBeNull()
    expect(progress.querySelector('[data-sparkline]')).not.toBeNull()
  })

  test('wide tiles get axes and gridlines; 380 is three narrow tiles', () => {
    const wide = page(900, 200)
    expect(wide.container.querySelector('[data-glance]')?.getAttribute('data-columns')).toBe('3')
    expect(wide.container.querySelector('[data-glance]')?.hasAttribute('data-axes')).toBe(true)
    expect(wide.container.querySelector('[data-testid="plot-progress"] svg[data-ring="48"] text')?.textContent).toBe('2/6')
    expect(wide.container.querySelector('[data-sparkline]')).toBeNull()
    wide.unmount()
    const three = page(380, 200)
    expect(three.container.querySelector('[data-glance]')?.getAttribute('data-columns')).toBe('3')
    expect(three.container.querySelector('[data-glance]')?.hasAttribute('data-axes')).toBe(false)
  })

  test('the progress plot: the summary on focus, each point by the arrows, now at the end', () => {
    const { container } = page(200, 200)
    const plot = container.querySelector('[data-testid="plot-progress"]') as HTMLElement
    fireEvent.focus(plot)
    expect(tip(plot)).toBe('2/6 done · 1 failing · 1 blocked · 1 working')
    fireEvent.keyDown(plot, { key: 'End' })
    expect(tip(plot)).toBe('2/6 now')
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(tip(plot)).toMatch(/^2 ticked at \d\d:\d\d/)
    fireEvent.keyDown(plot, { key: 'Home' })
    expect(tip(plot)).toMatch(/^None ticked before /)
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(tip(plot)).toBeNull()
  })

  test('the stacked bar: a tooltip per segment, empty states skipped, by keys and by pointer', () => {
    const steps = progressOver([list()], 0)
    expect(steps.length).toBeGreaterThan(1)
    const { container } = page(200, 200)
    const bar = container.querySelector('[data-testid="plot-states"]') as HTMLElement
    expect([...bar.querySelectorAll('[data-segment]')].map((one) => one.getAttribute('data-segment'))).toEqual(['passed', 'na', 'working', 'blocked', 'failed', 'unchecked'])
    fireEvent.focus(bar)
    expect(tip(bar)).toBe('2/6 done · 1 failing · 1 blocked · 1 working')
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(tip(bar)).toBe('1 passed of 6')
    fireEvent.keyDown(bar, { key: 'End' })
    expect(tip(bar)).toBe('1 open of 6')
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(tip(bar)).toBe('1 failing of 6 · “Says why”')
    fireEvent.blur(bar)
    /* happy-dom measures nothing, so a pointer is at the bar's left edge: the first segment. */
    fireEvent.pointerMove(bar, { clientX: 0 })
    expect(tip(bar)).toBe('1 passed of 6')
  })

  test('every chart has its sentence: a label on the plot and the same words for a screen reader', () => {
    for (const [width, height] of [[200, 40], [200, 200], [380, 200], [900, 700]] as const) {
      const { container, unmount } = page(width, height)
      const plots = container.querySelectorAll('[role="img"]')
      expect(plots.length).toBeGreaterThan(0)
      for (const plot of plots) {
        expect(plot.getAttribute('aria-label')?.length).toBeGreaterThan(10)
        expect(plot.getAttribute('tabindex')).toBe('0')
      }
      unmount()
    }
  })

  test('the item’s name is truncated with its full sentence as a tooltip; the working line too', () => {
    const { container } = page(200, 200)
    expect(container.querySelector('[data-concerns]')?.getAttribute('title')).toBe('Pull request gh#105')
    expect(container.querySelector('[data-working-first]')?.getAttribute('title')).toBe('Being worked on: “Follows patterns”.')
  })
})

describe('one chart tooltip, and only while it is wanted (2.13.1)', () => {
  const tips = (root: ParentNode) => [...root.querySelectorAll('[role="tooltip"]')].map((one) => one.textContent)
  const plots = (root: ParentNode) => ({
    progress: root.querySelector('[data-testid="plot-progress"]') as HTMLElement,
    states: root.querySelector('[data-testid="plot-states"]') as HTMLElement,
  })
  const hover = (el: HTMLElement) => fireEvent.pointerMove(el, { pointerType: 'mouse', clientX: 0 })

  test('leaving the plot hides it', () => {
    const { container } = page(200, 200)
    const { states } = plots(container)
    hover(states)
    expect(tip(states)).toBe('1 passed of 6')
    fireEvent.pointerLeave(states, { pointerType: 'mouse' })
    expect(tip(states)).toBeNull()
  })

  test('the pointer leaving the page (the module) hides it', () => {
    const { container } = page(200, 200)
    const { states } = plots(container)
    hover(states)
    act(() => void document.documentElement.dispatchEvent(new MouseEvent('mouseleave')))
    expect(tip(states)).toBeNull()
    hover(states)
    expect(tip(states)).not.toBeNull()
    act(() => void document.dispatchEvent(new PointerEvent('pointerout', { pointerType: 'mouse', relatedTarget: null })))
    expect(tip(states)).toBeNull()
  })

  test('the window losing focus, a scroll, a resize and Escape each hide it', () => {
    const { container } = page(200, 200)
    const { states } = plots(container)
    const aways = [
      () => window.dispatchEvent(new Event('blur')),
      () => window.dispatchEvent(new Event('scroll')),
      () => window.dispatchEvent(new Event('resize')),
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ]
    for (const away of aways) {
      hover(states)
      expect(tip(states)).not.toBeNull()
      act(() => void away())
      expect(tip(states)).toBeNull()
    }
  })

  test('showing a second hides the first', () => {
    const { container } = page(200, 200)
    const { progress, states } = plots(container)
    hover(progress)
    expect(tip(progress)).not.toBeNull()
    hover(states)
    expect(tips(container)).toEqual(['1 passed of 6'])
    fireEvent.keyDown(document.body, { key: 'Tab' })
    fireEvent.focus(progress)
    expect(tips(container)).toEqual(['2/6 done · 1 failing · 1 blocked · 1 working'])
  })

  test('a click that focuses a chart leaves no tooltip once the pointer goes', () => {
    const { container } = page(200, 200)
    const { states } = plots(container)
    fireEvent.pointerDown(states, { pointerType: 'mouse', clientX: 0 })
    fireEvent.focus(states)
    expect(tip(states)).not.toBeNull()
    fireEvent.pointerLeave(states, { pointerType: 'mouse' })
    expect(tip(states)).toBeNull()
    fireEvent.blur(states)
    fireEvent.focus(states)
    expect(tip(states)).toBeNull()
  })

  test('keyboard focus still shows it, and blur hides it', () => {
    const { container } = page(200, 200)
    const { progress } = plots(container)
    fireEvent.pointerDown(document.body, { pointerType: 'mouse' })
    fireEvent.keyDown(document.body, { key: 'Tab' })
    fireEvent.focus(progress)
    expect(tip(progress)).toBe('2/6 done · 1 failing · 1 blocked · 1 working')
    fireEvent.keyDown(progress, { key: 'End' })
    expect(tip(progress)).toBe('2/6 now')
    fireEvent.blur(progress)
    expect(tip(progress)).toBeNull()
  })

  test('a tap shows it; a tap elsewhere or the time hides it', () => {
    jest.useFakeTimers()
    try {
      const { container } = page(200, 200)
      const { states } = plots(container)
      fireEvent.pointerDown(states, { pointerType: 'touch', clientX: 0 })
      fireEvent.pointerLeave(states, { pointerType: 'touch' })
      expect(tip(states)).not.toBeNull()
      fireEvent.pointerDown(document.body, { pointerType: 'touch' })
      expect(tip(states)).toBeNull()
      fireEvent.pointerDown(states, { pointerType: 'touch', clientX: 0 })
      expect(tip(states)).not.toBeNull()
      act(() => void jest.advanceTimersByTime(TOUCH_MS + 1))
      expect(tip(states)).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})

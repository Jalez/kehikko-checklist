import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'

import type { RunItem } from '../list/runs.ts'
import { HereView, RunItems } from '../src/view/here.tsx'
import { room } from '../src/view/room.ts'
import type { Here } from '../src/store/ask.ts'

/** The automatic "Tests pass" items, drawn for real. */
afterEach(cleanup)

const item = (over: Partial<RunItem> & { label: string }): RunItem => ({
  state: 'passed',
  passed: over.state ? over.state === 'passed' : true,
  kind: 'verify',
  from: 'some-runner',
  queuedAt: 1,
  startedAt: 2,
  finishedAt: 3,
  exit: 0,
  hidden: false,
  ...over,
})

describe('an automatic item', () => {
  test('says it is from a test run, shows its state in words, and has no box to tick', () => {
    const { container } = render(
      <RunItems refName="!44" runs={[item({ label: 'bun test' }), item({ label: 'typecheck', state: 'failed', exit: 1 })]} busy={false} onHide={() => {}} />,
    )
    const rows = [...container.querySelectorAll('[data-run]')]
    expect(rows.map((one) => one.textContent?.includes('from a test run'))).toEqual([true, true])
    expect(rows[0]!.textContent).toContain('Tests pass: bun test')
    expect(rows[0]!.getAttribute('data-done')).toBe('yes')
    expect(rows[0]!.querySelector('[data-state-word]')!.textContent).toBe('Passed')
    expect(rows[1]!.getAttribute('data-done')).toBe('no')
    expect(rows[1]!.querySelector('[data-state-word]')!.textContent).toBe('Failed')
    /* No checkbox and nothing pressable but Hide: a person cannot tick it. */
    expect(container.querySelectorAll('input[type="checkbox"], [aria-pressed]').length).toBe(0)
    for (const row of rows) {
      expect([...row.querySelectorAll('button')].map((one) => one.textContent)).toEqual(['Hide'])
    }
  })

  test('cancelled reads cancelled and is not ticked; a label is drawn as text, never markup', () => {
    const { container } = render(<RunItems refName="!44" runs={[item({ label: '<b>e2e</b>', state: 'cancelled', exit: null })]} busy={false} />)
    const row = container.querySelector('[data-run]')!
    expect(row.getAttribute('data-done')).toBe('no')
    expect(row.querySelector('[data-state-word]')!.textContent).toBe('Cancelled')
    expect(row.querySelector('b')).toBeNull()
    expect(row.textContent).toContain('Tests pass: <b>e2e</b>')
  })

  test('Hide asks to hide that (ref, label); a hidden one is left out, and "Show 1 hidden" brings it back with Show', () => {
    const asked: [string, string, boolean][] = []
    const onHide = (ref: string, label: string, hide: boolean) => asked.push([ref, label, hide])
    const first = render(<RunItems refName="!44" runs={[item({ label: 'bun test' })]} busy={false} onHide={onHide} />)
    fireEvent.click(first.container.querySelector('[data-hide-run="bun test"]')!)
    expect(asked).toEqual([['!44', 'bun test', true]])
    first.unmount()

    const { container } = render(
      <RunItems refName="!44" runs={[item({ label: 'bun test', hidden: true }), item({ label: 'typecheck' })]} busy={false} onHide={onHide} />,
    )
    expect([...container.querySelectorAll('[data-run]')].map((one) => one.getAttribute('data-run'))).toEqual(['typecheck'])
    const more = container.querySelector('[data-show-hidden]')!
    expect(more.textContent).toBe('Show 1 hidden')
    fireEvent.click(more)
    expect([...container.querySelectorAll('[data-run]')].map((one) => one.getAttribute('data-run'))).toEqual(['bun test', 'typecheck'])
    fireEvent.click(container.querySelector('[data-hide-run="bun test"]')!)
    expect(asked.at(-1)).toEqual(['!44', 'bun test', false])
  })
})

describe('on the reading page', () => {
  test('the items are drawn in the picked ref’s section, beside the lists people wrote', () => {
    const here: Here = { placed: null, positions: [], instances: [], items: [], undecided: [], trouble: null, nowhere: false, whole: false } as unknown as Here
    const { container } = render(
      <HereView
        here={here}
        items={[{ target: { kind: 'ref', ref: '!44' }, type: 'mr', as: ['any'], elsewhere: [] }]}
        runs={{ '!44': [item({ label: 'bun test', state: 'running', passed: false, exit: null })] }}
        onHideRun={() => {}}
        onEdit={() => {}}
        onOpen={() => {}}
        onAll={() => {}}
        trouble={null}
        busy={false}
        room={room(900, 700)}
      />,
    )
    const section = container.querySelector('[data-section="ref:!44"]')!
    const run = section.querySelector('[data-runs="!44"] [data-run="bun test"]')!
    expect(run.getAttribute('data-state')).toBe('running')
    expect(run.textContent).toContain('Running')
    expect(run.textContent).toContain('from a test run')
  })
})

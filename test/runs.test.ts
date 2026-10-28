import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PublishedRun, RunResult } from 'kehikot-module-protocol'

import { answerAt, TICKET } from '../doors.ts'
import { runItemsOf, runsFor, setHidden } from '../list/runs.ts'

/**
 * "Tests pass" items, read off the protocol's run results. The publishers here are two made-up
 * folders: Checklist names no module, so neither may it be told one in a test.
 */

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-runs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

let clock = 1_000
function run(over: Partial<RunResult> & { label: string }): RunResult {
  clock += 1_000
  return {
    id: `r${clock}`,
    kind: 'verify',
    refs: ['!44'],
    epic: null,
    state: 'queued',
    queuedAt: clock,
    startedAt: null,
    finishedAt: null,
    exit: null,
    ...over,
  }
}
const from = (runs: RunResult[], folder = 'some-runner'): PublishedRun[] => runs.map((one) => ({ ...one, from: folder }))

/** Publish runs as a module would, in its own folder. */
function publish(folder: string, runs: RunResult[]): void {
  mkdirSync(join(dir, '.kehikot', folder), { recursive: true })
  writeFileSync(join(dir, '.kehikot', folder, 'runs.json'), JSON.stringify({ version: 1, runs }))
}

describe('the lifecycle of one label on one ref', () => {
  test('queued, then running, then passed: ticked only once it passed', () => {
    const queued = run({ label: 'bun test' })
    expect(runItemsOf(from([queued]), '!44', new Set())).toMatchObject([{ label: 'bun test', state: 'queued', passed: false }])
    const running = { ...queued, state: 'running' as const, startedAt: queued.queuedAt + 1 }
    expect(runItemsOf(from([running]), '!44', new Set())).toMatchObject([{ state: 'running', passed: false }])
    const passed = { ...running, state: 'passed' as const, finishedAt: running.queuedAt + 2, exit: 0 }
    expect(runItemsOf(from([passed]), '!44', new Set())).toMatchObject([{ state: 'passed', passed: true, exit: 0 }])
  })

  test('a newer run that failed unticks it, and one still going does too', () => {
    const pass = run({ label: 'bun test', state: 'passed', exit: 0 })
    const fail = run({ label: 'bun test', state: 'failed', exit: 1 })
    expect(runItemsOf(from([pass, fail]), '!44', new Set())).toMatchObject([{ state: 'failed', passed: false, exit: 1 }])
    const again = run({ label: 'bun test', state: 'running' })
    expect(runItemsOf(from([pass, again]), '!44', new Set())).toMatchObject([{ state: 'running', passed: false }])
  })

  test('cancelled reads cancelled, and unticked', () => {
    const pass = run({ label: 'bun test', state: 'passed', exit: 0 })
    const stop = run({ label: 'bun test', state: 'cancelled' })
    expect(runItemsOf(from([pass, stop]), '!44', new Set())).toMatchObject([{ state: 'cancelled', passed: false }])
  })

  test('a second label is its own item, and another ref’s runs are not here', () => {
    const items = runItemsOf(
      from([
        run({ label: 'bun test', state: 'passed', exit: 0 }),
        run({ label: 'typecheck', state: 'failed', exit: 2 }),
        run({ label: 'lint', refs: ['gh#7'], state: 'passed' }),
      ]),
      '!44',
      new Set(),
    )
    expect(items.map((one) => [one.label, one.state, one.passed])).toEqual([
      ['bun test', 'passed', true],
      ['typecheck', 'failed', false],
    ])
  })
})

describe('reading every publisher off the disk', () => {
  test('two publisher folders, read without naming either, each run saying its folder', () => {
    publish('runner-one', [run({ label: 'bun test', state: 'passed', exit: 0 })])
    publish('runner-two', [run({ label: 'typecheck', state: 'running' }), run({ label: 'e2e', refs: ['gh#9'], state: 'failed' })])
    const read = runsFor(dir, ['!44', 'gh#9', 'gh#1'])
    expect(read.nowhere).toBe(false)
    expect(read.runs['!44']!.map((one) => [one.label, one.state, one.from])).toEqual([
      ['bun test', 'passed', 'runner-one'],
      ['typecheck', 'running', 'runner-two'],
    ])
    expect(read.runs['gh#9']!.map((one) => one.label)).toEqual(['e2e'])
    expect(read.runs['gh#1']).toEqual([])
  })

  test('the same label from two folders is one check: the newer one is shown', () => {
    publish('runner-one', [run({ label: 'bun test', state: 'passed', exit: 0 })])
    publish('runner-two', [run({ label: 'bun test', state: 'failed', exit: 1 })])
    expect(runsFor(dir, ['!44']).runs['!44']).toMatchObject([{ label: 'bun test', state: 'failed', from: 'runner-two' }])
  })

  test('no project is nowhere; a read writes nothing', () => {
    expect(runsFor(null, ['!44']).nowhere).toBe(true)
    publish('runner-one', [run({ label: 'bun test' })])
    runsFor(dir, ['!44'])
    expect(existsSync(join(dir, '.kehikot', 'checklist'))).toBe(false)
  })
})

describe('hiding one', () => {
  test('a hide is kept in checklist’s own folder by ref and label, and survives a newer run', () => {
    publish('runner-one', [run({ label: 'bun test', state: 'passed', exit: 0 }), run({ label: 'typecheck', state: 'passed' })])
    expect(setHidden(dir, '!44', 'bun test', true)).toMatchObject({ ok: true })
    const file = join(dir, '.kehikot', 'checklist', 'runs-hidden.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, hidden: [{ ref: '!44', label: 'bun test' }] })

    publish('runner-one', [run({ label: 'bun test', state: 'failed', exit: 1 }), run({ label: 'typecheck', state: 'passed' })])
    const items = runsFor(dir, ['!44', 'gh#2']).runs['!44']!
    expect(items.map((one) => [one.label, one.state, one.hidden])).toEqual([
      ['bun test', 'failed', true],
      ['typecheck', 'passed', false],
    ])

    expect(setHidden(dir, '!44', 'bun test', false)).toMatchObject({ ok: true })
    expect(runsFor(dir, ['!44']).runs['!44']!.every((one) => !one.hidden)).toBe(true)
  })

  test('the same label on another ref is not hidden by it', () => {
    publish('runner-one', [run({ label: 'bun test', refs: ['!44', '!45'], state: 'passed' })])
    setHidden(dir, '!44', 'bun test', true)
    expect(runsFor(dir, ['!45']).runs['!45']).toMatchObject([{ hidden: false }])
  })
})

describe('the doors', () => {
  test('GET /api/runs reads the refs in the query; POST hides with the ticket and refuses without', () => {
    publish('runner-one', [run({ label: 'bun test', state: 'passed', exit: 0 })])
    const read = answerAt('GET', '/api/runs', new URLSearchParams({ project: dir, refs: '!44 gh#3' }), null, null)
    expect(read?.status).toBe(200)
    expect((read?.body as { runs: Record<string, unknown[]> }).runs['!44']).toMatchObject([{ label: 'bun test', state: 'passed', passed: true }])

    const stranger = answerAt('POST', '/api/runs', new URLSearchParams(), { project: dir, op: 'hide', ref: '!44', label: 'bun test' }, null)
    expect(stranger?.status).not.toBe(200)
    expect(existsSync(join(dir, '.kehikot', 'checklist', 'runs-hidden.json'))).toBe(false)

    const hid = answerAt('POST', '/api/runs', new URLSearchParams(), { project: dir, op: 'hide', ref: '!44', label: 'bun test' }, TICKET)
    expect(hid?.status).toBe(200)
    expect((hid?.body as { ok: boolean }).ok).toBe(true)
    const after = answerAt('GET', '/api/runs', new URLSearchParams({ project: dir, refs: '!44' }), null, null)
    expect((after?.body as { runs: Record<string, { hidden: boolean }[]> }).runs['!44']![0]!.hidden).toBe(true)

    const nonsense = answerAt('POST', '/api/runs', new URLSearchParams(), { project: dir, op: 'tick', ref: '!44', label: 'bun test' }, TICKET)
    expect((nonsense?.body as { ok: boolean }).ok).toBe(false)
  })
})

describe('the MCP door', () => {
  test('what applies to a ref lists its run items, marked automatic, hidden ones said as hidden', () => {
    publish('runner-one', [run({ label: 'bun test', state: 'passed', exit: 0 }), run({ label: 'typecheck', state: 'running' })])
    setHidden(dir, '!44', 'typecheck', true)
    const reply = answerAt(
      'POST',
      '/mcp',
      new URLSearchParams(),
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'checklists', arguments: { project: dir, ref: '!44' } } },
      null,
    )
    const text = (reply?.body as { result: { content: { text: string }[] } }).result.content[0]!.text
    expect(text).toContain('Automatic, from a test run')
    expect(text).toContain('[x] Tests pass: bun test — passed, exit 0 (automatic')
    expect(text).toContain('[ ] Tests pass: typecheck — running (automatic')
    expect(text).toContain('hidden on the page by a person')
  })
})

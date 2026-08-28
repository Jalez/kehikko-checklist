import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StandingRow } from '../derive/standing.ts'
import { Row } from '../src/view/row.tsx'

/**
 * Withdrawing the owner's agreement, which used to be impossible inside a frame
 * and had no symptom.
 *
 * The program this came from asked for a confirmation with `window.confirm`.
 * That is correct on its own page and is IGNORED in a host's frame — the sandbox
 * is `allow-scripts allow-forms allow-popups allow-same-origin`, with no
 * `allow-modals`, so the call returns `false` and the handler returns early. The
 * button did nothing, said nothing, and left a person to conclude the tick could
 * not be taken back.
 *
 * These tests exist so that fix cannot be undone by somebody reaching for a
 * dialog again: a modal cannot be asserted here, and a two-press arm can.
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-withdraw-'))
  process.env.CHECKLIST_DATA = dir
})

afterEach(() => {
  cleanup()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHECKLIST_DATA
})

const owner = (state: 'done' | 'todo'): StandingRow => ({
  id: 'agreed',
  label: 'The owner has seen the finished version and agrees it solves this',
  why: 'This is the owner’s tick and nothing else can make it.',
  kind: 'human',
  state,
  by: state === 'done' ? 'the owner, on this app’s own page' : 'you',
  at: state === 'done' ? '2026-01-01T00:00:00.000Z' : null,
  note: null,
  detail: null,
  read: null,
  exempt: null,
  orphan: false,
  list: 'issue',
})

describe('ticking', () => {
  test('takes one press, because agreeing is the considered act', () => {
    const pressed: string[] = []
    render(<Row row={owner('todo')} onTick={(r) => pressed.push(r.id)} />)
    fireEvent.click(screen.getByRole('button'))
    expect(pressed).toEqual(['agreed'])
  })
})

describe('withdrawing', () => {
  test('takes two presses, and the first one only arms it', () => {
    const pressed: string[] = []
    render(<Row row={owner('done')} onTick={(r) => pressed.push(r.id)} />)
    fireEvent.click(screen.getByRole('button'))
    /* Nothing has been written. What has happened is that the row now says what
       the next press will do — in the row, not in a modal a sandbox can silence. */
    expect(pressed).toEqual([])
    expect(screen.getByText(/Press it again to withdraw your agreement/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button'))
    expect(pressed).toEqual(['agreed'])
  })

  test('is abandoned by leaving the row, rather than by an invisible timer', () => {
    const pressed: string[] = []
    render(<Row row={owner('done')} onTick={(r) => pressed.push(r.id)} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.blur(button)
    expect(screen.queryByText(/Press it again to withdraw/)).toBeNull()
    /* And a press after abandoning starts the two-step over rather than falling
       straight through it. */
    fireEvent.click(button)
    expect(pressed).toEqual([])
  })
})

describe('every other row', () => {
  test('is not a control at all, whatever its state', () => {
    const derived: StandingRow = { ...owner('done'), id: 'pipeline', kind: 'derived', list: 'mr' }
    render(<Row row={derived} onTick={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('an exempt owner item is a thing to read, not a thing to press', () => {
    const exempt: StandingRow = { ...owner('todo'), exempt: 'It does not apply on this tracker, and here is why.' }
    render(<Row row={exempt} onTick={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/does not apply on this tracker/)).toBeTruthy()
  })
})

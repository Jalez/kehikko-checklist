import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { StandingCard } from '../src/view/standing-card.tsx'

/**
 * What the page actually says, rendered.
 *
 * The words are the material here — every `why` on the list was argued over on a
 * real merge request — so these tests assert sentences rather than structure. A
 * fake renderer would let a component say something different from what it says
 * in a browser, which is why the real components run against a real document.
 *
 * What is NOT asserted here is layout. happy-dom has no layout engine, so "does
 * this overflow at 220 pixels" is not a question it can answer, and a test that
 * pretended to would be worse than none. That measurement is taken in a real
 * browser instead; see the probes in the README.
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-render-'))
  process.env.CHECKLIST_DATA = dir
})

afterEach(() => {
  cleanup()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHECKLIST_DATA
})

async function standing(ref: string, shape: 'change' | 'work') {
  const { standingFor } = await import('../derive/standing.ts')
  return standingFor(ref, shape)
}

const inert = { open: true, onToggle: () => {}, onTick: () => {}, trouble: {} }

describe('a selected reference nothing has been read about', () => {
  test('says “not asked”, and never says the tracker had nothing to say', async () => {
    render(<StandingCard standing={await standing('!1848', 'change')} {...inert} />)
    /* The distinction the whole module turns on. `unasked` is a program that has
       not looked; `no answer` is a tracker that was read and was silent. */
    expect(screen.getAllByText('not asked').length).toBeGreaterThan(0)
    expect(screen.queryByText('no answer')).toBeNull()
    expect(screen.getByText(/Nothing has ever shown this app/)).toBeTruthy()
  })

  test('draws the reference and the tracker’s own word for it', async () => {
    render(<StandingCard standing={await standing('!1848', 'change')} {...inert} />)
    expect(screen.getByText('!1848')).toBeTruthy()
    expect(screen.getByText('merge request')).toBeTruthy()
  })
})

describe('the owner’s item', () => {
  test('is the one row on either list that is a control', async () => {
    render(<StandingCard standing={await standing('gh#131', 'work')} {...inert} />)
    /* Every other row reports something that happened elsewhere. This one is a
       press, and it is a press because this app can prove a person at this
       machine made it. */
    const rows = document.querySelectorAll('li[data-kind]')
    const own = document.querySelector('li[data-item="agreed"] button')
    expect(rows.length).toBeGreaterThan(1)
    expect(own).toBeTruthy()
    expect(document.querySelectorAll('li[data-kind] button').length).toBe(1)
    expect(own?.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('every reason', () => {
  test('is in the document rather than behind a tooltip', async () => {
    /* A `<details>` is open text in the DOM: reachable by keyboard, by a screen
       reader, by find-in-page, and on a touch device that can never hover. A
       tooltip is none of those, and these sentences are the reason an agent reads
       the list a second time instead of skimming it. */
    render(<StandingCard standing={await standing('!1848', 'change')} {...inert} />)
    expect(screen.getByText(/Undo the change: if the test still passes it proves nothing/)).toBeTruthy()
    expect(screen.getAllByText('why this is on the list').length).toBeGreaterThan(10)
  })
})

describe('a reference whose kind nobody has settled', () => {
  test('shows both lists and says why, rather than picking one and keeping quiet', async () => {
    const { standingFor } = await import('../derive/standing.ts')
    render(<StandingCard standing={standingFor('gh#105')} {...inert} />)
    expect(screen.getByText(/GitHub numbers both in one sequence/)).toBeTruthy()
    /* The owner's own item lives on the issue list. Guessing "change" would have
       quietly removed the one gate on either list. */
    expect(document.querySelector('li[data-item="agreed"]')).toBeTruthy()
    expect(document.querySelector('li[data-item="pipeline"]')).toBeTruthy()
  })
})

describe('a tick against an item no longer on the list', () => {
  test('is drawn, named, and explained rather than dropped', async () => {
    const { setTick } = await import('../list/ticks.ts')
    setTick({ ref: '!1848', item: 'a-thing-nobody-lists', done: true, agent: 'an agent' })
    render(<StandingCard standing={await standing('!1848', 'change')} {...inert} />)
    expect(screen.getByText(/no longer on the list/)).toBeTruthy()
    expect(screen.getByText(/The tick is kept rather than deleted/)).toBeTruthy()
  })
})

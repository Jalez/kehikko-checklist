import { describe, expect, test } from 'bun:test'

import type { Place, Shown } from '../list/aim.ts'
import { HOW_TO_PICK, NO_RECENT, oneInFront, saidOf, type Recent } from '../list/one.ts'

/**
 * EXACTLY ONE target (`list/one.ts`): the picked container's subject; with nothing picked, the most
 * recently picked or selected thing; with neither, nothing and how to pick something. Never a union.
 */

const at = (path: string): Place => ({ path, from: null, to: null })
const PAPER: Shown = { module: 'kehikot.paper', selected: false, refs: [], documents: [at('paper/main.tex'), at('paper/intro.tex')] }
const REFERENCES: Shown = { module: 'kehikot.references', selected: false, refs: ['!4233'], documents: [] }
const pick = (one: Shown): Shown => ({ ...one, selected: true })

/** Walk several contexts in order, carrying the page's memory, and answer the last. */
function walk(steps: { passage?: Place | null; selection?: string[]; containers?: Shown[]; follow?: boolean }[]) {
  let recent: Recent = NO_RECENT
  let got = oneInFront(recent, { passage: null, selection: [], containers: [], follow: true })
  for (const step of steps) {
    got = oneInFront(recent, { passage: step.passage ?? null, selection: step.selection ?? [], containers: step.containers ?? [], follow: step.follow ?? true })
    recent = got.recent
  }
  return got
}

describe('a container picked as the target', () => {
  test('References picked: its picked item, and not the paper in view beside it — the reported case', () => {
    const got = walk([{ passage: at('paper/main.tex'), selection: ['!4233'], containers: [PAPER, pick(REFERENCES)] }])
    expect(got.one).toMatchObject({ kind: 'ref', ref: '!4233', from: { by: 'picked', module: 'kehikot.references' } })
    expect(got.said).toBe('For !4233 (picked in References)')
  })

  test('Paper picked: its paper, every place it shows, and no ref beside it', () => {
    const got = walk([{ passage: null, selection: ['!4233'], containers: [pick(PAPER), REFERENCES] }])
    expect(got.one).toMatchObject({ kind: 'place', place: at('paper/main.tex'), places: [at('paper/main.tex'), at('paper/intro.tex')] })
    expect(got.said).toBe('For main.tex (picked in Paper)')
  })

  test('several picked: the one picked most recently, whatever the canvas order', () => {
    const got = walk([
      { containers: [pick(PAPER), REFERENCES] },
      { containers: [pick(PAPER), pick(REFERENCES)] },
    ])
    expect(got.said).toBe('For !4233 (picked in References)')
    /* Unpicking it falls back to the one still picked. */
    const back = walk([
      { containers: [PAPER, pick(REFERENCES)] },
      { containers: [pick(PAPER), pick(REFERENCES)] },
      { containers: [pick(PAPER), REFERENCES] },
    ])
    expect(back.said).toBe('For main.tex (picked in Paper)')
  })

  test('a picked container that shows nothing: no target, and no falling back to another', () => {
    const quiet: Shown = { module: 'kehikot.journeys', selected: true, refs: [], documents: [] }
    const got = walk([{ passage: at('paper/main.tex'), selection: ['!4233'], containers: [PAPER, quiet] }])
    expect(got.one).toBeNull()
    expect(got.quiet).toBe('kehikot.journeys')
    expect(got.said).toBe('Journeys is picked and shows nothing a checklist is for. Pick an item in it, or untick its box.')
  })

  test('following the picks turned off: the picks do not decide, the most recent thing does', () => {
    const got = walk([{ selection: ['!7'], containers: [pick(PAPER)], follow: false }])
    expect(got.said).toBe('For !7 (selected last)')
  })
})

describe('nothing picked: the most recent thing', () => {
  test('a click, then the reader moving: the paper; then another click: that ref', () => {
    const steps = [
      { selection: ['!7'], containers: [PAPER] },
      { selection: ['!7'], passage: at('paper/intro.tex'), containers: [PAPER] },
    ]
    const reading = walk(steps)
    expect(reading.one).toMatchObject({ kind: 'place', place: at('paper/intro.tex'), from: { by: 'reading', module: 'kehikot.paper' } })
    expect(reading.said).toBe('For intro.tex (in view in Paper)')
    expect(reading.one?.kind === 'place' && reading.one.places).toEqual([at('paper/intro.tex'), at('paper/main.tex')])
    const clicked = walk([...steps, { selection: ['!7', 'gh#9'], passage: at('paper/intro.tex'), containers: [PAPER] }])
    expect(clicked.said).toBe('For gh#9 (selected last)')
  })

  test('a click and a move in the same context: the click', () => {
    expect(walk([{ selection: ['!7'], passage: at('paper/main.tex') }]).said).toBe('For !7 (selected last)')
  })

  test('the thing named goes away: the other one, if there is one', () => {
    const got = walk([
      { passage: at('paper/main.tex') },
      { selection: ['!7'], passage: at('paper/main.tex') },
      { selection: [], passage: at('paper/main.tex') },
    ])
    expect(got.said).toBe('For main.tex (where you are reading)')
  })

  test('the same canvas again gives the same answer: a repeated context moves nothing', () => {
    const step = { selection: ['!7'], passage: at('paper/main.tex'), containers: [PAPER, pick(REFERENCES)] }
    expect(walk([step, step, step]).said).toBe(walk([step]).said)
  })
})

describe('neither', () => {
  test('nothing at all: no target, and the sentence says how to pick something', () => {
    const got = walk([{}])
    expect(got.one).toBeNull()
    expect(got.said).toBe(HOW_TO_PICK)
    expect(HOW_TO_PICK).toContain('tick the box in a container’s header')
  })

  test('saidOf names the thing and the reason', () => {
    expect(saidOf({ kind: 'ref', ref: '!1', from: { by: 'selected' } })).toBe('For !1 (selected last)')
  })
})

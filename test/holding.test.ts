import { describe, expect, test } from 'bun:test'

import { holdingAt, type Holding } from '../list/holding.ts'
import { ladderKey, rungsOf, scopeOf, type Grain, type Placed } from '../list/scope.ts'
import { targetKey, type Target } from '../list/targets.ts'

/**
 * Which pairing is in front of a reader, as a table of cases.
 *
 * ## Why the fixture is a paper with several chapters and not one section
 *
 * Because the bug this file exists to prevent cannot happen in a paper with one
 * section in it. The report was about MOVEMENT — *"if you scroll around it
 * changes manually to another one"* — so every case below is a position in a
 * document that has somewhere else to be, and the case that matters most is a
 * reader walking out of the chapter their list is about and back into it.
 *
 * A fixture where the reader has nowhere to go would pass under the old model
 * and under the new one, and would say nothing about either. That has shipped in
 * this workspace before.
 *
 * The document is the shape of the owner's own thesis, reduced to what the
 * ladder can tell apart: two chapters, one of them with two labelled headings in
 * it, and one file with none at all.
 */

const EPIC = 'thesis'

/** Where the reader is, as the server resolves a passage. */
const AT: Record<string, Placed | null> = {
  /* Nothing broadcast a passage. The bare paper, which is what every load starts
     at and what a container with no document under it stays at. */
  nowhere: null,
  /* `main.tex` has no labelled heading, so there is a file rung and no section. */
  main: { file: 'main.tex', section: null, title: null },
  litReview: { file: 'chapters/2_literature_review.tex', section: null, title: null },
  litEarly: {
    file: 'chapters/2_literature_review.tex',
    section: 'chapters:2_literature_review#sec:lit-early',
    title: 'Early work',
  },
  litGaps: {
    file: 'chapters/2_literature_review.tex',
    section: 'chapters:2_literature_review#sec:lit-gaps',
    title: 'What nobody has done',
  },
  methods: {
    file: 'chapters/3_methods.tex',
    section: 'chapters:3_methods#sec:meth-design',
    title: 'Research design',
  },
}

/**
 * `nowhere` is a paper with no passage under it — one rung — and `unepiced` is
 * no ladder at all, which is a container with no epic open. They look alike and
 * are not: one is a place a list can be held against and the other is not a
 * place.
 */
const where = (at: keyof typeof AT | 'unepiced') =>
  at === 'unepiced' ? '' : ladderKey(rungsOf(scopeOf(EPIC, AT[at]!)))

const paper = (section: string | null = null): Target => ({ kind: 'paper', epic: EPIC, section })
const ref = (name: string): Target => ({ kind: 'ref', ref: name })

/** The pairings a list has, as the keys `holdingAt` reads. */
const pairings = (...targets: Target[]) => targets.map(targetKey)

function held(over: {
  at?: keyof typeof AT | 'unepiced'
  grain?: Grain | null
  has?: string[]
  picked?: Target | null
  selection?: string[]
}): Holding {
  return holdingAt({
    ladder: where(over.at ?? 'nowhere'),
    grain: over.grain ?? null,
    pairings: over.has ?? [],
    picked: over.picked ?? null,
    selection: over.selection ?? [],
  })
}

/* The list the owner described: held against one chapter, and nothing else. */
const ABOUT_LIT = pairings(paper('chapters:2_literature_review'))

describe('a reader walking through a paper a list is held against one chapter of', () => {
  test('shows the pairing when they are standing in it', () => {
    expect(held({ at: 'litEarly', has: ABOUT_LIT })).toEqual({
      target: paper('chapters:2_literature_review'),
      /* One rung wider than where they stand, so the server must not re-derive
         the target from the path — the same rule the old `widenedTarget`
         carried. */
      decided: true,
      standing: 'held',
      grounded: true,
    })
  })

  test('shows it in a different section of the same chapter, because the file contains them', () => {
    expect(held({ at: 'litGaps', has: ABOUT_LIT }).standing).toBe('held')
    expect(held({ at: 'litReview', has: ABOUT_LIT })).toEqual({
      target: paper('chapters:2_literature_review'),
      /* Standing in the file itself, this IS the narrowest rung, so the server
         may go on resolving the passage. */
      decided: false,
      standing: 'held',
      grounded: true,
    })
  })

  test('does NOT show it four chapters away, and does not re-aim the list', () => {
    /* The report, as a case. Under the old model this answered
       `{ kind: 'paper', epic, section: 'chapters:3_methods#sec:meth-design' }`
       and the container said the list was held against Research design. */
    const away = held({ at: 'methods', has: ABOUT_LIT })
    expect(away.standing).toBe('unheld')
    expect(away.target).not.toEqual(paper('chapters:2_literature_review'))
    /* What it offers instead is where the reader is, so the press that WOULD
       make a pairing names the rung the row is printing. */
    expect(away.target).toEqual(paper('chapters:3_methods#sec:meth-design'))
  })

  test('shows it again when they walk back, with nothing remembered in between', () => {
    /* The other half of "the view follows the reader": leaving must be
       reversible by arriving, and nothing here is stateful, so it is. */
    const walk = (['litEarly', 'methods', 'main', 'litGaps'] as const).map(
      (at) => held({ at, has: ABOUT_LIT }).standing,
    )
    expect(walk).toEqual(['held', 'unheld', 'unheld', 'held'])
  })
})

describe('which rung of the ladder wins', () => {
  test('the narrowest pairing the reader is standing on', () => {
    /* A list held against the section, the file AND the paper is making three
       claims, and the one the reader walked into is the closest. */
    const has = pairings(paper(), paper('chapters:2_literature_review'), paper('chapters:2_literature_review#sec:lit-early'))
    expect(held({ at: 'litEarly', has })).toEqual({
      target: paper('chapters:2_literature_review#sec:lit-early'),
      decided: false,
      standing: 'held',
      grounded: true,
    })
  })

  test('a pairing against the whole paper is shown everywhere in the paper', () => {
    /* "The paper owes an abstract" is a claim about everywhere in it, so the
       search walks outward rather than stopping at equality. */
    const has = pairings(paper())
    for (const at of ['main', 'litGaps', 'methods'] as const) {
      expect(held({ at, has }).standing).toBe('held')
      expect(held({ at, has }).target).toEqual(paper())
    }
  })

  test('nothing at all, on a ladder with no pairing anywhere on it', () => {
    const answer = held({ at: 'litEarly', has: pairings(ref('gh#105')) })
    expect(answer.standing).toBe('unheld')
    expect(answer.target).toEqual(paper('chapters:2_literature_review#sec:lit-early'))
  })
})

describe('the grain trims the ladder from below, and never from above', () => {
  test('a reader working file by file is not shown one section’s ticks', () => {
    const has = pairings(paper('chapters:2_literature_review#sec:lit-early'))
    expect(held({ at: 'litEarly', grain: 'file', has }).standing).toBe('unheld')
    /* And what a press would make is the FILE, which is the rung they asked for. */
    expect(held({ at: 'litEarly', grain: 'file', has }).target).toEqual(paper('chapters:2_literature_review'))
  })

  test('and is still shown a pairing against the whole paper, wherever they stand', () => {
    const has = pairings(paper())
    expect(held({ at: 'litEarly', grain: 'file', has }).standing).toBe('held')
    expect(held({ at: 'litEarly', grain: 'section', has }).standing).toBe('held')
  })

  test('the paper grain considers the paper and nothing under it', () => {
    const has = pairings(paper('chapters:2_literature_review'))
    expect(held({ at: 'litEarly', grain: 'paper', has }).standing).toBe('unheld')
    expect(held({ at: 'litEarly', grain: 'paper', has }).target).toEqual(paper())
    expect(held({ at: 'litEarly', grain: 'paper', has }).decided).toBe(true)
  })

  test('a grain this ladder does not have trims nothing', () => {
    /* `main.tex` has no labelled heading, so `section` is not on its ladder.
       `grainAt` has already fallen back for the same reason; this is the second
       half of the same defence, and it must not narrow by nothing. */
    const has = pairings(paper('chapters:2_literature_review'))
    expect(held({ at: 'litReview', grain: 'section', has }).standing).toBe('held')
  })
})

describe('a reference, which has no passage and must not become unreachable', () => {
  test('a selected reference the list is held against is shown ahead of the paper', () => {
    const has = pairings(ref('gh#105'), paper())
    expect(held({ at: 'litEarly', has, selection: ['gh#105'] })).toEqual({
      target: ref('gh#105'),
      decided: true,
      standing: 'held',
      /* A reference is not a rung and never will be, so the grain control in the
         container header is withdrawn while one is in front. */
      grounded: false,
    })
  })

  test('a selected reference the list is NOT held against does not re-aim it', () => {
    /* The same complaint in its other form. Clicking an issue on the canvas
       while reading a chapter this list IS about used to point the list at the
       issue; now the chapter goes on being what is in front. */
    expect(held({ at: 'litEarly', has: ABOUT_LIT, selection: ['gh#900'] })).toEqual({
      target: paper('chapters:2_literature_review'),
      decided: true,
      standing: 'held',
      grounded: true,
    })
  })

  test('with no paper under the reader, an unheld selection is what a press would hold it against', () => {
    expect(held({ at: 'unepiced', has: [], selection: ['gh#900'] })).toEqual({
      target: ref('gh#900'),
      decided: true,
      standing: 'unheld',
      grounded: false,
    })
  })

  test('the first of several selected references that the list is actually held against', () => {
    const has = pairings(ref('!44'))
    expect(held({ at: 'unepiced', has, selection: ['gh#900', '!44'] }).target).toEqual(ref('!44'))
  })

  test('a ref-held list with nothing selected and no paper says so rather than claiming a target', () => {
    /* Not a dead end: `targets` still lists every pairing in the switcher, with
       its count, and the box under it still takes a reference typed by hand.
       What this refuses to do is invent one. */
    expect(held({ at: 'unepiced', has: pairings(ref('gh#105')) })).toEqual({
      target: null,
      decided: false,
      standing: 'nothing',
      grounded: false,
    })
  })
})

describe('a target pointed at by hand', () => {
  test('outranks the reader’s position, and is a decision', () => {
    const picked = paper('chapters:3_methods#sec:meth-design')
    expect(held({ at: 'litEarly', has: ABOUT_LIT, picked })).toEqual({
      target: picked,
      decided: true,
      standing: 'picked',
      /* Another chapter's section. The grain control would be a lie over it —
         press `This file` and either nothing happens or the pick is thrown away
         — so the offer is withdrawn until the pick is. */
      grounded: false,
    })
  })

  test('a pick that lands ON the ladder keeps the grain control, which a withdrawal would spend', () => {
    /* `Hold it against here` is a pick, and it is an ordinary press now rather
       than a rare one. Its target is a rung by construction, so the header's
       grain control is still telling the truth about it — and a withdrawal is a
       claim this host answers by pruning the grain it has remembered for the
       container. A rule that withdrew on every pick would cost the reader their
       stored preference every time they held a list against what they were
       reading. See the essay on `ladder` in `src/app.tsx`. */
    const hereAndNow = paper('chapters:2_literature_review#sec:lit-early')
    expect(held({ at: 'litEarly', picked: hereAndNow })).toEqual({
      target: hereAndNow,
      decided: true,
      standing: 'picked',
      grounded: true,
    })
  })

  test('and outranks a selected reference too', () => {
    expect(held({ at: 'unepiced', picked: ref('gh#1'), selection: ['gh#105'], has: pairings(ref('gh#105')) }).standing).toBe('picked')
  })
})

describe('before anything has been read', () => {
  test('the bare paper, undecided, so the server resolves the passage', () => {
    /* The first fetch of every load. No `placed` yet, so one rung; no pairings
       yet, because they arrive in the same answer. `decided: false` is what lets
       the server read the path and hand back the rest of the ladder — the page
       would otherwise pin the whole paper and never learn where the reader is. */
    expect(held({ at: 'nowhere' })).toEqual({
      target: paper(),
      decided: false,
      standing: 'unheld',
      grounded: true,
    })
  })

  test('and nothing at all when there is no epic either', () => {
    expect(holdingAt({ ladder: '', grain: null, pairings: [], picked: null, selection: [] })).toEqual({
      target: null,
      decided: false,
      standing: 'nothing',
      grounded: false,
    })
  })
})

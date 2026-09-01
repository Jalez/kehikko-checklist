import { describe, expect, test } from 'bun:test'

import { heldTargets, showing, type Instance } from '../list/holding.ts'
import { ladderKey, rungsOf, scopeOf, type Placed } from '../list/scope.ts'
import { targetKey, type Target } from '../list/targets.ts'

/**
 * Which checklists are in front of a reader, as a table of cases.
 *
 * ## Why the fixture is a paper with several chapters and several lists
 *
 * Because the bug this file exists to prevent cannot happen in a paper with one
 * section and one list. The report was about MOVEMENT and about ASSIGNMENT —
 * *"when I am scrolling in a paper i want to see the checklist(s) that I have
 * assigned for that section/file … I dont want to see it swapping its mind"* —
 * so every case below is a position in a document that has somewhere else to
 * be, against lists that are held against different parts of it, and the case
 * that matters most is a reader walking out of the chapter a list is about and
 * back into it.
 *
 * The document is the shape of the owner's own thesis, reduced to what the
 * ladder can tell apart: two chapters, one of them with two labelled headings in
 * it, and one file with none at all. The lists are the shape of the owner's own
 * store: one per chapter, and one for the whole thing.
 */

const EPIC = 'thesis'

/** Where the reader is, as the server resolves a passage. */
const AT: Record<string, Placed | null> = {
  nowhere: null,
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

/** `nowhere` is a paper with no passage — one rung; `unepiced` is no ladder at all. */
const where = (at: keyof typeof AT | 'unepiced') =>
  at === 'unepiced' ? '' : ladderKey(rungsOf(scopeOf(EPIC, AT[at]!)))

const paper = (section: string | null = null): Target => ({ kind: 'paper', epic: EPIC, section })
const ref = (name: string): Target => ({ kind: 'ref', ref: name })

/** A checklist, held against these targets — which is what a person set on its edit page. */
const list = (id: string, ...targets: Target[]) => ({ id, targets: targets.map(targetKey) })

/** Instances as `list@target`, so a case reads as one line. */
const shown = (out: Instance[]) => out.map((one) => `${one.id}@${targetKey(one.target)}`)

const LIT = list('lit', paper('chapters:2_literature_review'))
const METHODS = list('methods', paper('chapters:3_methods'))
const WHOLE = list('whole', paper())
const NOWHERE = list('unheld')
const LISTS = [LIT, METHODS, WHOLE, NOWHERE]

describe('a reader walking through a paper with a list per chapter', () => {
  test('in chapter 2 sees chapter 2’s list and the whole paper’s, and not chapter 3’s', () => {
    expect(shown(showing({ ladder: where('litEarly'), selection: [], lists: LISTS }))).toEqual([
      'lit@paper:thesis/chapters:2_literature_review',
      'whole@paper:thesis',
    ])
  })

  test('in chapter 3 sees chapter 3’s and the whole paper’s', () => {
    expect(shown(showing({ ladder: where('methods'), selection: [], lists: LISTS }))).toEqual([
      'methods@paper:thesis/chapters:3_methods',
      'whole@paper:thesis',
    ])
  })

  test('in main.tex, which no chapter list is about, sees only the whole paper’s', () => {
    expect(shown(showing({ ladder: where('main'), selection: [], lists: LISTS }))).toEqual(['whole@paper:thesis'])
  })

  test('with no passage sees the whole paper’s list, because the paper is open', () => {
    expect(shown(showing({ ladder: where('nowhere'), selection: [], lists: LISTS }))).toEqual(['whole@paper:thesis'])
  })

  test('with no paper open sees nothing at all', () => {
    expect(showing({ ladder: where('unepiced'), selection: [], lists: LISTS })).toEqual([])
  })

  test('walking out and back changes nothing about the lists, only what is in front', () => {
    /* The other half of "the view follows the reader": leaving must be
       reversible by arriving, and nothing here is stateful, so it is. */
    const walk = (['litEarly', 'methods', 'main', 'litGaps'] as const).map((at) =>
      shown(showing({ ladder: where(at), selection: [], lists: [LIT] })),
    )
    expect(walk).toEqual([['lit@paper:thesis/chapters:2_literature_review'], [], [], ['lit@paper:thesis/chapters:2_literature_review']])
  })

  test('a list held against a file is in front in every section of it', () => {
    for (const at of ['litReview', 'litEarly', 'litGaps'] as const) {
      expect(shown(showing({ ladder: where(at), selection: [], lists: [LIT] }))).toEqual([
        'lit@paper:thesis/chapters:2_literature_review',
      ])
    }
  })
})

describe('which of its targets a list is shown against', () => {
  test('the narrowest rung the reader is standing on, when it is held against several', () => {
    /* A list held against the section, the file AND the paper is making three
       claims, and the one the reader walked into is the closest. One instance,
       not three: the rungs contain one another. */
    const many = list('many', paper(), paper('chapters:2_literature_review'), paper('chapters:2_literature_review#sec:lit-early'))
    expect(shown(showing({ ladder: where('litEarly'), selection: [], lists: [many] }))).toEqual([
      'many@paper:thesis/chapters:2_literature_review#sec:lit-early',
    ])
    expect(shown(showing({ ladder: where('litGaps'), selection: [], lists: [many] }))).toEqual([
      'many@paper:thesis/chapters:2_literature_review',
    ])
    expect(shown(showing({ ladder: where('main'), selection: [], lists: [many] }))).toEqual(['many@paper:thesis'])
  })

  test('never a rung it is not held against, however close the reader is', () => {
    /* Held against one heading of chapter 2. A reader in the OTHER heading of
       chapter 2 is not in front of it, and the old model's "narrow to the
       nearest thing with ticks" is exactly what must not happen here. */
    const early = list('early', paper('chapters:2_literature_review#sec:lit-early'))
    expect(showing({ ladder: where('litGaps'), selection: [], lists: [early] })).toEqual([])
    expect(showing({ ladder: where('litReview'), selection: [], lists: [early] })).toEqual([])
    expect(shown(showing({ ladder: where('litEarly'), selection: [], lists: [early] }))).toEqual([
      'early@paper:thesis/chapters:2_literature_review#sec:lit-early',
    ])
  })
})

describe('a selected reference, which has no passage and is where the reader is standing', () => {
  const change = list('change', ref('gh#105'))
  const both = list('both', ref('gh#105'), paper('chapters:2_literature_review'))

  test('puts every list held against it in front, ahead of the paper’s', () => {
    expect(shown(showing({ ladder: where('litEarly'), selection: ['gh#105'], lists: [WHOLE, change] }))).toEqual([
      'change@ref:gh#105',
      'whole@paper:thesis',
    ])
  })

  test('shows one list twice when it is held against the reference AND the chapter', () => {
    /* Two pieces of work with two sets of ticks, and collapsing them would be
       this program picking. */
    expect(shown(showing({ ladder: where('litEarly'), selection: ['gh#105'], lists: [both] }))).toEqual([
      'both@ref:gh#105',
      'both@paper:thesis/chapters:2_literature_review',
    ])
  })

  test('a selected reference nothing is held against adds nothing and moves nothing', () => {
    /* The complaint in its other form: clicking an issue while reading a
       chapter used to re-aim the list at the issue. */
    expect(shown(showing({ ladder: where('litEarly'), selection: ['gh#900'], lists: LISTS }))).toEqual([
      'lit@paper:thesis/chapters:2_literature_review',
      'whole@paper:thesis',
    ])
  })

  test('follows the canvas’s order for several references', () => {
    const mr = list('mr', ref('!44'))
    expect(shown(showing({ ladder: where('unepiced'), selection: ['!44', 'gh#105'], lists: [change, mr] }))).toEqual([
      'mr@ref:!44',
      'change@ref:gh#105',
    ])
  })

  test('with nothing selected and no paper, a ref-held list is in front of nobody', () => {
    expect(showing({ ladder: where('unepiced'), selection: [], lists: [change] })).toEqual([])
  })
})

describe('nothing is invented', () => {
  test('a list held against nothing is shown nowhere, wherever the reader is', () => {
    for (const at of ['nowhere', 'main', 'litEarly', 'methods', 'unepiced'] as const) {
      expect(showing({ ladder: where(at), selection: ['gh#105'], lists: [NOWHERE] })).toEqual([])
    }
  })

  test('a list about another paper is not in front of a reader in this one', () => {
    const other = list('other', { kind: 'paper', epic: 'other-thesis', section: null })
    expect(showing({ ladder: where('litEarly'), selection: [], lists: [other] })).toEqual([])
  })

  test('the keys of a list come back as targets, and a key this version cannot read is left out', () => {
    expect(heldTargets(['ref:gh#105', 'nonsense', 'paper:thesis/chapters:3_methods'])).toEqual([
      ref('gh#105'),
      paper('chapters:3_methods'),
    ])
  })
})

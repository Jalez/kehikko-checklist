import { describe, expect, test } from 'bun:test'

import {
  briefOf,
  fileId,
  fileOf,
  labelOf,
  ladderKey,
  rungsFrom,
  rungsOf,
  saidOf,
  scopeOf,
  scopeOfTarget,
  sectionId,
  targetOf,
  widen,
  type Scope,
} from '../list/scope.ts'
import { targetKey, type Target } from '../list/targets.ts'

/**
 * The ladder, as a table of cases.
 *
 * It is pure, which is the whole reason it can be one — see the essay at the top
 * of `list/scope.ts` for the rungs and for why there is no passage rung. This is
 * the same separation `test/room.test.ts` keeps for the thresholds: a decision
 * lives in a function, and a function with a table beside it is a decision
 * somebody can put a case to.
 *
 * What the ladder DECIDES is smaller than it was: which rungs a reader is
 * standing on, and what each is called. Which lists are shown against them is
 * `list/holding.ts`, with its own table.
 */

const paper = (epic: string, section: string | null = null): Target => ({ kind: 'paper', epic, section })

describe('the ids a target is spelled with', () => {
  test('a file is its path without the extension, with the slashes made safe', () => {
    expect(fileId('chapters/3_methods.tex')).toBe('chapters:3_methods')
    expect(fileId('main.tex')).toBe('main')
    /* The owner's paper lives under the paper module's own folder. */
    expect(fileId('.kehikot/paper/thesis/chapters/3_methods.tex')).toBe('.kehikot:paper:thesis:chapters:3_methods')
  })

  test('keeps the directory, so two files with one stem are two targets', () => {
    expect(fileId('a/intro.tex')).not.toBe(fileId('b/intro.tex'))
  })

  test('a section prefers the label the author chose over the words they wrote', () => {
    expect(sectionId('chapters:3_methods', 'sec:meth-design', 'Research design'))
      .toBe('chapters:3_methods#sec:meth-design')
  })

  test('falls back to the heading, which is the weaker case and is documented as one', () => {
    expect(sectionId('chapters:3_methods', null, 'Architecture overview'))
      .toBe('chapters:3_methods#Architecture-overview')
  })

  test('refuses to narrow at all rather than truncate an id that will not fit', () => {
    expect(sectionId('chapters:3_methods', null, 'x'.repeat(200))).toBe(null)
  })
})

describe('which rung a reader is on', () => {
  test('is nowhere at all when no epic is open', () => {
    expect(scopeOf(null, { file: 'main.tex', section: null, title: null })).toEqual({ kind: 'elsewhere' })
  })

  test('is the whole paper when no document is open', () => {
    expect(scopeOf('thesis', null)).toEqual({ kind: 'paper', epic: 'thesis' })
  })

  test('is the file when a document is open and no heading is above the reader', () => {
    expect(scopeOf('thesis', { file: 'chapters/1_introduction.tex', section: null, title: null })).toEqual({
      kind: 'file',
      epic: 'thesis',
      file: 'chapters/1_introduction.tex',
      id: 'chapters:1_introduction',
    })
  })

  test('is the section when the reader is standing inside one', () => {
    expect(scopeOf('thesis', {
      file: 'chapters/3_methods.tex',
      section: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    })).toEqual({
      kind: 'section',
      epic: 'thesis',
      file: 'chapters/3_methods.tex',
      id: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    })
  })

  test('falls back to the file when the section id arrived unspellable', () => {
    expect(scopeOf('thesis', { file: 'main.tex', section: 'not a name', title: 'x' }).kind).toBe('file')
  })
})

describe('the target each rung is held against', () => {
  test('is the paper itself at the top', () => {
    expect(targetOf({ kind: 'paper', epic: 'thesis' })).toEqual(paper('thesis'))
  })

  test('is a section of that paper on the two rungs below it', () => {
    expect(targetOf({ kind: 'file', epic: 'thesis', file: 'main.tex', id: 'main' })).toEqual(paper('thesis', 'main'))
  })

  test('is nothing at all off the ladder', () => {
    expect(targetOf({ kind: 'elsewhere' })).toBe(null)
  })

  test('are all different targets, so the ticks on them are separate sets', () => {
    const keys = [
      targetKey(paper('thesis')),
      targetKey(paper('thesis', 'chapters:3_methods')),
      targetKey(paper('thesis', 'chapters:3_methods#sec:meth-design')),
    ]
    expect(new Set(keys).size).toBe(3)
  })
})

describe('climbing out', () => {
  test('a section widens to its own file, not straight to the paper', () => {
    const scope: Scope = {
      kind: 'section',
      epic: 'thesis',
      file: 'chapters/3_methods.tex',
      id: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    }
    expect(widen(scope)).toEqual({ kind: 'file', epic: 'thesis', file: 'chapters/3_methods.tex', id: 'chapters:3_methods' })
  })

  test('a file widens to the paper', () => {
    expect(widen({ kind: 'file', epic: 'thesis', file: 'main.tex', id: 'main' })).toEqual({ kind: 'paper', epic: 'thesis' })
  })

  test('the paper is the top, and off the ladder there is nowhere to climb', () => {
    expect(widen({ kind: 'paper', epic: 'thesis' })).toBe(null)
    expect(widen({ kind: 'elsewhere' })).toBe(null)
  })
})

describe('the ladder as one string', () => {
  const inSection = scopeOf('thesis', {
    file: 'chapters/3_methods.tex',
    section: 'chapters:3_methods#sec:meth-design',
    title: 'Research design',
  })
  const inFile = scopeOf('thesis', { file: 'main.tex', section: null, title: null })

  test('has every rung that exists, narrowest first', () => {
    expect(rungsOf(inSection).map((rung) => rung.depth)).toEqual(['section', 'file', 'paper'])
    expect(rungsOf(inFile).map((rung) => rung.depth)).toEqual(['file', 'paper'])
    expect(rungsOf({ kind: 'paper', epic: 'thesis' }).map((rung) => rung.depth)).toEqual(['paper'])
    expect(rungsOf({ kind: 'elsewhere' })).toEqual([])
  })

  test('survives the round trip through its key, which is what React depends on', () => {
    const rungs = rungsOf(inSection)
    expect(rungsFrom(ladderKey(rungs))).toEqual(rungs)
    expect(rungsFrom('')).toEqual([])
    expect(rungsFrom('nonsense\tx')).toEqual([])
  })
})

describe('what a target is called on a row', () => {
  const placed = {
    file: 'chapters/3_methods.tex',
    section: 'chapters:3_methods#sec:meth-design',
    title: 'Research design',
  }
  const outline = {
    files: [
      { id: 'main', name: 'main.tex', sections: [] },
      {
        id: 'chapters:3_methods',
        name: '3_methods.tex',
        sections: [{ id: 'chapters:3_methods#sec:meth-models', title: 'Model selection' }],
      },
    ],
  }

  test('a reference is its reference', () => {
    expect(labelOf({ kind: 'ref', ref: 'gh#105' }, placed, outline)).toBe('gh#105')
  })

  test('the whole paper says so', () => {
    expect(labelOf(paper('thesis'), placed, outline)).toBe('the whole paper')
  })

  test('takes the words from the outline first, so the row and the button cannot disagree', () => {
    expect(labelOf(paper('thesis', 'chapters:3_methods'), null, outline)).toBe('3_methods.tex')
    expect(labelOf(paper('thesis', 'chapters:3_methods#sec:meth-models'), null, outline)).toBe('Model selection')
  })

  test('then the reader’s own position, where the section’s real words are known', () => {
    expect(labelOf(paper('thesis', placed.section), placed, null)).toBe('Research design')
    expect(labelOf(paper('thesis', 'chapters:3_methods'), placed, null)).toBe('3_methods.tex')
  })

  test('and the id, honestly, when it has nothing better', () => {
    /* A target from another paper, or one whose heading has been renamed
       since: never invented. */
    expect(labelOf(paper('thesis', 'chapters:9_gone#sec:vanished'), placed, outline)).toBe('sec:vanished')
    /* A file the reader is not in, with no outline: the chapter's own name
       out of the id, not the whole address. */
    expect(labelOf(paper('thesis', 'chapters:1_introduction'), placed, null)).toBe('1_introduction')
    expect(fileOf('chapters:1_introduction')).toBe('1_introduction')
    expect(fileOf('chapters/1_introduction.tex')).toBe('1_introduction.tex')
  })

  test('the rung a target sits on takes the real heading words only where the reader is in it', () => {
    expect(scopeOfTarget(paper('thesis', placed.section), placed)).toMatchObject({ kind: 'section', title: 'Research design' })
    expect(scopeOfTarget(paper('thesis', 'chapters:3_methods'), placed)).toMatchObject({ kind: 'file', id: 'chapters:3_methods' })
    expect(scopeOfTarget(paper('thesis', 'chapters:9_other#sec:x'), placed)).toMatchObject({ kind: 'section', title: 'sec:x' })
    expect(scopeOfTarget({ kind: 'ref', ref: 'gh#105' }, placed)).toEqual({ kind: 'elsewhere' })
    expect(scopeOfTarget(null, placed)).toEqual({ kind: 'elsewhere' })
  })

  test('the screen gets the words and an agent gets the address', () => {
    const scope = scopeOf('thesis', placed)
    expect(briefOf(scope)).toBe('Research design')
    expect(briefOf({ kind: 'paper', epic: 'thesis' })).toBe('the whole paper')
    expect(saidOf(scope)).toContain('chapters/3_methods.tex')
    expect(saidOf(scope)).toContain('Research design')
    expect(saidOf({ kind: 'elsewhere' })).toContain('not held against a paper')
  })
})

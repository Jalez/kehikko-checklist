import { describe, expect, test } from 'bun:test'

import { flattenParts, focusOn, paperFileId, partsOf, targetInFocus, whyUnfocused } from '../list/focus.ts'
import type { Target } from '../list/targets.ts'

/**
 * The parts focus, as a table of what is in front.
 *
 * Two failures, and the second is the one the field was designed against. A
 * focus must put aside the lists held against a reference, a file or a
 * section outside the picked parts — and it must never do it without the
 * number being there to print. A list held against the WHOLE paper is left
 * shown, because every part is a part of it. With nothing picked every answer
 * is the one it was before.
 */

const part = (id: string, refs: string[], picked = false, heading = `The ${id}`, files?: string[]) => ({
  id,
  heading,
  refs,
  picked,
  ...(files ? { files } : {}),
})
const seam = (picked: boolean) => part('seam', ['gh#10', 'gh#11'], picked)
const tests = (picked: boolean) => part('tests', ['gh#7'], picked)
const methods = (picked: boolean) => part('methods', [], picked, 'Methods', ['chapters/3_methods.tex'])
const results = (picked: boolean) => part('results', [], picked, 'Results', ['chapters/4_results.tex'])

const ref = (name: string): { id: string; target: Target } => ({ id: name, target: { kind: 'ref', ref: name } })
/* A file and a section of it, spelled as the server spells a place inside `.kehikot/paper/<epic>/`. */
const at = (id: string, section: string): { id: string; target: Target } => ({
  id,
  target: { kind: 'paper', epic: 'thesis', section: `.kehikot:paper:thesis:${section}` },
})
const SECTION = at('section', 'chapters:3_methods')
const DESIGN = at('design', 'chapters:3_methods#sec:meth-design')
const FOUND = at('found', 'chapters:4_results#sec:res-satisfaction')
const MAIN = at('main', 'main')
const PAPER = { id: 'paper', target: { kind: 'paper', epic: 'thesis', section: null } as Target }

const FRONT = [ref('gh#10'), ref('gh#7'), ref('gh#99'), SECTION, PAPER]
const CHAPTERS = [SECTION, DESIGN, FOUND, MAIN, PAPER]
const ids = (instances: readonly { id: string }[]) => instances.map((one) => one.id)

describe('nothing picked out is the whole epic', () => {
  test('no parts, and parts with none picked, hand back the very same instances and say nothing', () => {
    expect(focusOn(FRONT, [])).toEqual({ instances: FRONT, focus: null })
    const rested = focusOn(FRONT, [seam(false), tests(false)])
    expect(rested.instances).toBe(FRONT)
    expect(rested.focus).toBeNull()
  })
})

describe('a picked part narrows the lists held against references', () => {
  test('to the refs it lists, and counts the rest', () => {
    const { instances, focus } = focusOn(FRONT, [seam(true), tests(false)])
    /* The chapter's list goes too: the seam owns no file. The whole paper's stays. */
    expect(ids(instances)).toEqual(['gh#10', 'paper'])
    expect(focus).toEqual({ picked: ['The seam'], outside: 3 })
  })

  test('several picked parts are a union, and a ref in no part is outside every focus', () => {
    const { instances, focus } = focusOn(FRONT, [seam(true), tests(true)])
    expect(ids(instances)).toEqual(['gh#10', 'gh#7', 'paper'])
    /* `gh#99` is in neither part, and nor is the chapter: counted, not shown. */
    expect(focus).toMatchObject({ picked: ['The seam', 'The tests'], outside: 2 })
  })

  test('nothing is lost between what is shown and what is counted', () => {
    const { instances, focus } = focusOn(FRONT, [tests(true)])
    expect(instances.length + focus!.outside).toBe(FRONT.length)
  })

  test('a part with no heading is named by its id', () => {
    expect(focusOn(FRONT, [part('seam', ['gh#10'], true, '')]).focus?.picked).toEqual(['seam'])
  })
})

describe('a picked part narrows the lists held against its files', () => {
  test('a file is spelled as the server spells the same file inside the project', () => {
    expect(paperFileId('thesis', 'chapters/3_methods.tex')).toBe('.kehikot:paper:thesis:chapters:3_methods')
    expect(paperFileId('thesis', 'main.tex')).toBe('.kehikot:paper:thesis:main')
  })

  test('to the file a part owns and the sections in it, and counts the rest', () => {
    const { instances, focus } = focusOn(CHAPTERS, [methods(true), results(false)])
    expect(ids(instances)).toEqual(['section', 'design', 'paper'])
    expect(focus).toEqual({ picked: ['Methods'], outside: 2 })
  })

  test('another part is another file: the first part’s lists are put aside, not kept', () => {
    const { instances, focus } = focusOn(CHAPTERS, [methods(false), results(true)])
    expect(ids(instances)).toEqual(['found', 'paper'])
    expect(focus).toMatchObject({ picked: ['Results'], outside: 3 })
  })

  test('two parts are both files, and a file no part owns is outside every focus', () => {
    const { instances, focus } = focusOn(CHAPTERS, [methods(true), results(true)])
    expect(ids(instances)).toEqual(['section', 'design', 'found', 'paper'])
    /* `main.tex` is nobody's. */
    expect(focus).toEqual({ picked: ['Methods', 'Results'], outside: 1 })
  })

  test('the whole paper is in front under any focus, and a part that owns no file has no file’s lists', () => {
    const parts = [part('elsewhere', ['gl#404'], true)]
    expect(targetInFocus(parts, PAPER.target)).toBe(true)
    expect(targetInFocus(parts, SECTION.target)).toBe(false)
    expect(targetInFocus(parts, { kind: 'ref', ref: 'gh#10' })).toBe(false)
    expect(targetInFocus(parts, { kind: 'ref', ref: 'gl#404' })).toBe(true)
    const { instances, focus } = focusOn(FRONT, parts)
    expect(ids(instances)).toEqual(['paper'])
    expect(focus).toMatchObject({ outside: 4 })
  })

  test('a file of another epic’s paper, or one outside the paper’s folder, is not a part’s file', () => {
    const parts = [methods(true)]
    expect(targetInFocus(parts, { kind: 'paper', epic: 'other', section: '.kehikot:paper:thesis:chapters:3_methods' })).toBe(false)
    expect(targetInFocus(parts, { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods' })).toBe(false)
  })

  test('nothing picked: every target is in front, whatever it is held against', () => {
    for (const one of CHAPTERS) expect(targetInFocus([methods(false)], one.target)).toBe(true)
  })
})

describe('the words', () => {
  test('there is no sentence about what was put aside: the focus is its parts and a number nobody prints', () => {
    expect(Object.keys(focusOn([ref('gh#10'), ref('gh#7'), ref('gh#99')], [seam(true)]).focus!).sort()).toEqual(['outside', 'picked'])
  })

  test('an empty page says the focus emptied it only when it did', () => {
    const focus = { picked: ['The seam'], outside: 2 }
    /* A picked-out container decided what was asked: one short sentence, and no count. */
    expect(whyUnfocused(focus, 0)).toBe('No checklist in front of you is in the picked part.')
    expect(whyUnfocused({ ...focus, outside: 1, picked: ['a', 'b'] }, 0)).toBe('No checklist in front of you is in the picked parts.')
    /* The parts decided what was asked: every list of the epic's paper, so none left is none held. */
    expect(whyUnfocused(focus, 0, true)).toBe('No checklist is held against anything in the picked part.')
    expect(whyUnfocused({ ...focus, picked: ['a', 'b'] }, 0, true)).toBe(
      'No checklist is held against anything in the picked parts.',
    )
    /* Something is left, or nothing was put aside, or there is no focus. */
    expect(whyUnfocused(focus, 1)).toBeNull()
    expect(whyUnfocused({ ...focus, outside: 0 }, 0, true)).toBeNull()
    expect(whyUnfocused(null, 0)).toBeNull()
  })
})

describe('across the wire hook, as one string', () => {
  test('the host’s parts survive the round trip, defaults filled in', () => {
    const flat = flattenParts([seam(true), { id: 'bare' }])
    expect(partsOf(flat)).toEqual([seam(true), { id: 'bare', heading: '', refs: [], picked: false }])
  })

  test('nothing, and anything that is not parts, is no focus at all', () => {
    expect(flattenParts(undefined)).toBe('')
    expect(flattenParts([])).toBe('')
    expect(flattenParts('seam')).toBe('')
    expect(partsOf('')).toEqual([])
    expect(partsOf('{')).toEqual([])
    /* One part the schema refuses is the whole list refused: a doubtful field
       must never be the reason a list is hidden. */
    expect(partsOf(flattenParts([seam(true), { id: 'Not An Id', picked: true }]))).toEqual([])
  })

  test('the same parts are the same string, so a repeated context sets nothing', () => {
    expect(flattenParts([seam(true)])).toBe(flattenParts([seam(true)]))
    expect(flattenParts([seam(true)])).not.toBe(flattenParts([seam(false)]))
  })
})

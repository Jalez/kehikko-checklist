import { describe, expect, test } from 'bun:test'

import { flattenParts, focusLine, focusOn, focusTold, partsOf, targetInFocus, whyUnfocused } from '../list/focus.ts'
import type { Target } from '../list/targets.ts'

/**
 * The parts focus, as a table of what is in front.
 *
 * Two failures, and the second is the one the field was designed against. A
 * focus must put aside the lists held against references outside the picked
 * parts — and it must never do it without the number being there to print.
 * And one decision that is this module's own: a list held against the paper
 * is left shown, because a part names references and says nothing about a
 * section. With nothing picked every answer is the one it was before.
 */

const part = (id: string, refs: string[], picked = false, heading = `The ${id}`) => ({ id, heading, refs, picked })
const seam = (picked: boolean) => part('seam', ['gh#10', 'gh#11'], picked)
const tests = (picked: boolean) => part('tests', ['gh#7'], picked)

const ref = (name: string): { id: string; target: Target } => ({ id: name, target: { kind: 'ref', ref: name } })
const SECTION = { id: 'section', target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods' } as Target }
const PAPER = { id: 'paper', target: { kind: 'paper', epic: 'thesis', section: null } as Target }

const FRONT = [ref('gh#10'), ref('gh#7'), ref('gh#99'), SECTION, PAPER]
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
    expect(ids(instances)).toEqual(['gh#10', 'section', 'paper'])
    expect(focus).toEqual({ picked: ['The seam'], of: 2, outside: 2, unnarrowed: 2 })
  })

  test('several picked parts are a union, and a ref in no part is outside every focus', () => {
    const { instances, focus } = focusOn(FRONT, [seam(true), tests(true)])
    expect(ids(instances)).toEqual(['gh#10', 'gh#7', 'section', 'paper'])
    /* `gh#99` is in neither part: counted, not shown. */
    expect(focus).toMatchObject({ picked: ['The seam', 'The tests'], outside: 1 })
  })

  test('nothing is lost between what is shown and what is counted', () => {
    const { instances, focus } = focusOn(FRONT, [tests(true)])
    expect(instances.length + focus!.outside).toBe(FRONT.length)
  })

  test('a part with no heading is named by its id', () => {
    expect(focusOn(FRONT, [part('seam', ['gh#10'], true, '')]).focus?.picked).toEqual(['seam'])
  })
})

describe('a list held against the paper is not narrowed', () => {
  test('a section, a file and the whole paper are in front under any focus', () => {
    const parts = [part('elsewhere', ['gl#404'], true)]
    expect(targetInFocus(parts, SECTION.target)).toBe(true)
    expect(targetInFocus(parts, PAPER.target)).toBe(true)
    expect(targetInFocus(parts, { kind: 'ref', ref: 'gh#10' })).toBe(false)
    expect(targetInFocus(parts, { kind: 'ref', ref: 'gl#404' })).toBe(true)
    const { instances, focus } = focusOn(FRONT, parts)
    expect(ids(instances)).toEqual(['section', 'paper'])
    expect(focus).toMatchObject({ outside: 3, unnarrowed: 2 })
  })
})

describe('the words', () => {
  test('how many are outside, which parts, and that the paper’s lists were left alone', () => {
    expect(focusLine({ picked: ['The seam'], of: 3, outside: 2, unnarrowed: 0 })).toBe(
      '2 checklists outside the picked part (The seam).',
    )
    expect(focusLine({ picked: ['The seam', 'The tests'], of: 3, outside: 1, unnarrowed: 1 })).toBe(
      '1 checklist outside the 2 picked parts (The seam, The tests). 1 list held against the paper is shown as before: parts name references, not sections.',
    )
    expect(focusLine({ picked: ['The seam'], of: 3, outside: 0, unnarrowed: 2 })).toBe(
      '0 checklists outside the picked part (The seam). 2 lists held against the paper are shown as before: parts name references, not sections.',
    )
  })

  test('the tooltip says where the control is, because it is not on this page', () => {
    const told = focusTold({ picked: ['The seam'], of: 3, outside: 2, unnarrowed: 0 })
    expect(told).toContain('3 parts; 1 is picked out in the host’s bar')
    expect(told).toContain('Unpick it there')
  })

  test('an empty page says the focus emptied it only when it did', () => {
    const focus = { picked: ['The seam'], of: 3, outside: 2, unnarrowed: 0 }
    expect(whyUnfocused(focus, 0)).toBe(
      'All 2 checklists in front of you are held against references outside the picked part.',
    )
    expect(whyUnfocused({ ...focus, outside: 1, picked: ['a', 'b'] }, 0)).toBe(
      'The one checklist in front of you is held against a reference outside the picked parts.',
    )
    /* Something is left, or nothing was put aside, or there is no focus. */
    expect(whyUnfocused(focus, 1)).toBeNull()
    expect(whyUnfocused({ ...focus, outside: 0 }, 0)).toBeNull()
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

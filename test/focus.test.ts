import { describe, expect, test } from 'bun:test'

import { narrowToFocus, type EpicPart } from 'kehikot-module-protocol'

import { NOUN, anchorOf, flattenParts, readParts } from '../list/focus.ts'
import type { Placed } from '../list/scope.ts'
import type { Target } from '../list/targets.ts'

/**
 * What ties a list to a part, as a table of what is in front.
 *
 * The rule is the protocol's and is called here exactly as the page calls it
 * (`narrowToFocus` is what `useFocus().narrow` runs); what this file holds is
 * this module's half — the anchor each list answers. A list held against a
 * reference follows the part that lists it; against a file or a section, the
 * part that has the document; against the WHOLE paper, every part. And every
 * case is asked of both shapes a host sends: `documents`, relative to the
 * project (app 0.1.17), and only `files`, relative to the paper's folder
 * (0.1.16).
 */

const PAPER = '.kehikot/paper/thesis'
type Shape = 'documents' | 'files'
const part = (id: string, refs: string[], picked = false, files: string[] = [], shape: Shape = 'documents'): EpicPart => ({
  id,
  heading: `The ${id}`,
  refs,
  picked,
  ...(files.length === 0
    ? {}
    : shape === 'documents'
      ? { documents: files.map((one) => `${PAPER}/${one}`), files }
      : { files }),
})
const seam = (picked: boolean) => part('seam', ['gh#10', 'gh#11'], picked)
const tests = (picked: boolean) => part('tests', ['gh#7'], picked)
const methods = (picked: boolean, shape: Shape = 'documents') => part('methods', [], picked, ['chapters/3_methods.tex'], shape)
const results = (picked: boolean, shape: Shape = 'documents') => part('results', [], picked, ['chapters/4_results.tex'], shape)

const ref = (name: string): { id: string; target: Target } => ({ id: name, target: { kind: 'ref', ref: name } })
/* A file and a section of it, as the server spells a place inside the project. */
const at = (id: string, section: string): { id: string; target: Target } => ({
  id,
  target: { kind: 'paper', epic: 'thesis', section: `.kehikot:paper:thesis:${section}` },
})
const SECTION = at('section', 'chapters:3_methods')
const DESIGN = at('design', 'chapters:3_methods#sec:meth-design')
const FOUND = at('found', 'chapters:4_results#sec:res-satisfaction')
const MAIN = at('main', 'main')
const PAPER_LIST = { id: 'paper', target: { kind: 'paper', epic: 'thesis', section: null } as Target }

/* The places the server answers beside the lists: the file each is held against. */
const place = (file: string): Placed => ({ file: `${PAPER}/${file}`, section: null, title: null })
const POSITIONS = [place('chapters/3_methods.tex'), place('chapters/4_results.tex'), place('main.tex')]

const FRONT = [ref('gh#10'), ref('gh#7'), ref('gh#99'), SECTION, PAPER_LIST]
const CHAPTERS = [SECTION, DESIGN, FOUND, MAIN, PAPER_LIST]

type Item = { id: string; target: Target | null }
const shown = (items: readonly Item[], parts: readonly EpicPart[], keep?: (one: Item) => boolean) =>
  narrowToFocus(parts, items, (one) => anchorOf(one, POSITIONS), { epic: 'thesis', projectPath: '/p', keep }).shown.map((one) => one.id)

describe('the anchor', () => {
  test('a reference, a file by its document, the whole paper as every part, and nothing for nothing', () => {
    expect(anchorOf(ref('gh#10'))).toEqual([{ ref: 'gh#10' }])
    expect(anchorOf(SECTION, POSITIONS)).toEqual([{ file: '.kehikot/paper/thesis/chapters/3_methods.tex' }])
    /* A section is anchored by the file it is in. */
    expect(anchorOf(DESIGN, POSITIONS)).toEqual([{ file: '.kehikot/paper/thesis/chapters/3_methods.tex' }])
    expect(anchorOf(PAPER_LIST, POSITIONS)).toEqual([{ whole: true }])
    expect(anchorOf({ target: null }, POSITIONS)).toEqual([])
  })

  test('two files that spell one id are both what the list is about', () => {
    const both = [place('chapters/3_methods.tex'), place('chapters/3_methods.bib')]
    expect(anchorOf(SECTION, both)).toEqual([
      { file: '.kehikot/paper/thesis/chapters/3_methods.tex' },
      { file: '.kehikot/paper/thesis/chapters/3_methods.bib' },
    ])
  })

  test('a file nobody resolved — gone from the disk — has no document, so no anchor: in no part, back when nothing is picked', () => {
    const gone = at('gone', 'chapters:9_gone')
    expect(anchorOf(gone, POSITIONS)).toEqual([])
    expect(shown([gone, PAPER_LIST], [methods(true)])).toEqual(['paper'])
    expect(shown([gone, PAPER_LIST], [methods(false)])).toEqual(['gone', 'paper'])
  })

  test('the noun of the one sentence', () => {
    expect(NOUN).toBe('checklist')
  })
})

describe('nothing picked out is the whole epic', () => {
  test('no parts, and parts with none picked, show every list', () => {
    expect(shown(FRONT, [])).toEqual(FRONT.map((one) => one.id))
    expect(shown(FRONT, [seam(false), tests(false)])).toEqual(FRONT.map((one) => one.id))
  })
})

describe('a picked part narrows the lists held against references', () => {
  test('to the refs it lists; the whole paper’s list stays', () => {
    /* The chapter's list goes too: the seam has no document. */
    expect(shown(FRONT, [seam(true), tests(false)])).toEqual(['gh#10', 'paper'])
  })

  test('several picked parts are a union, and a ref in no part is outside every pick', () => {
    expect(shown(FRONT, [seam(true), tests(true)])).toEqual(['gh#10', 'gh#7', 'paper'])
  })
})

for (const shape of ['documents', 'files'] as const) {
  describe(`a picked part narrows the lists held against its files — a host that sends ${shape === 'documents' ? '`documents`' : 'only `files`'}`, () => {
    test('to the file a part has and the sections in it', () => {
      expect(shown(CHAPTERS, [methods(true, shape), results(false, shape)])).toEqual(['section', 'design', 'paper'])
    })

    test('another part is another file: the first part’s lists are put aside, not kept', () => {
      expect(shown(CHAPTERS, [methods(false, shape), results(true, shape)])).toEqual(['found', 'paper'])
    })

    test('two parts are both files, and a file no part has is outside every pick', () => {
      /* `main.tex` is nobody's. */
      expect(shown(CHAPTERS, [methods(true, shape), results(true, shape)])).toEqual(['section', 'design', 'found', 'paper'])
    })

    test('nothing picked: every list is in front, whatever it is held against', () => {
      expect(shown(CHAPTERS, [methods(false, shape)])).toEqual(CHAPTERS.map((one) => one.id))
    })
  })
}

describe('the whole paper, and what is in hand', () => {
  test('the whole paper’s list is in front under any pick, and a part with no document has no file’s lists', () => {
    expect(shown(FRONT, [part('elsewhere', ['gl#404'], true)])).toEqual(['paper'])
  })

  test('the list being edited is kept though it is outside the pick, in its place', () => {
    expect(shown(CHAPTERS, [results(true)], (one) => one.id === 'section')).toEqual(['section', 'found', 'paper'])
  })
})

describe('across the wire hook, as one string', () => {
  test('the host’s parts survive the round trip, defaults filled in', () => {
    const flat = flattenParts([seam(true), { id: 'bare' }])
    expect(readParts(flat)).toEqual([seam(true), { id: 'bare', heading: '', refs: [], picked: false }])
  })

  test('a part’s documents come through with it', () => {
    expect(readParts(flattenParts([methods(true)]))[0]?.documents).toEqual(['.kehikot/paper/thesis/chapters/3_methods.tex'])
  })

  test('nothing, and anything that is not parts, is no focus at all', () => {
    expect(flattenParts(undefined)).toBe('')
    expect(flattenParts([])).toBe('')
    expect(flattenParts('seam')).toBe('')
    expect(readParts('')).toEqual([])
    expect(readParts('{')).toEqual([])
    /* One part the schema refuses is the whole list refused: a doubtful field
       must never be the reason a list is hidden. */
    expect(readParts(flattenParts([seam(true), { id: 'Not An Id', picked: true }]))).toEqual([])
  })

  test('the same parts are the same string, so a repeated context sets nothing', () => {
    expect(flattenParts([seam(true)])).toBe(flattenParts([seam(true)]))
    expect(flattenParts([seam(true)])).not.toBe(flattenParts([seam(false)]))
  })
})

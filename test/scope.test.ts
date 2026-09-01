import { describe, expect, test } from 'bun:test'

import {
  briefOf,
  fileId,
  grainAt,
  ladderKey,
  narrow,
  offerAt,
  rungsOf,
  saidOf,
  scopeOf,
  scopeOfTarget,
  sectionId,
  targetOf,
  widen,
  widenedTarget,
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
 * The block that matters most is the last one. Narrowing HIDES ticks, and a
 * container that hides somebody's record of their own work without saying so is
 * indistinguishable from one that has lost it.
 */

const paper = (epic: string, section: string | null = null): Target => ({ kind: 'paper', epic, section })
const ticks = (rows: [Target, number][]) => rows.map(([target, done]) => ({ target, done }))

describe('the ids a target is spelled with', () => {
  test('a file is its path without the extension, with the slashes made safe', () => {
    /* `/` is the target key's own delimiter, so a component holding one could
       shape a key rather than name something in it. `:` is allowed, is already
       in every `\\label{sec:…}` this thesis has, and reads as a separator. */
    expect(fileId('chapters/3_methods.tex')).toBe('chapters:3_methods')
    expect(fileId('main.tex')).toBe('main')
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
    /* A truncated id is worse than no id: two sections agreeing in their first
       eighty characters would become ONE target, and ticks made on one would
       appear on the other with nothing anywhere saying why. Null here makes the
       ladder fall back a rung, which is a coarser answer rather than a wrong
       one. */
    expect(sectionId('chapters:3_methods', null, 'x'.repeat(200))).toBe(null)
  })
})

describe('which rung a reader is on', () => {
  test('is nowhere at all when this list is not held against a paper', () => {
    /* Every ref target lives here permanently, which is the whole of "non-document
       targets keep working exactly as they do". */
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
    const scope = scopeOf('thesis', {
      file: 'chapters/3_methods.tex',
      section: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    })
    expect(scope).toEqual({
      kind: 'section',
      epic: 'thesis',
      file: 'chapters/3_methods.tex',
      id: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    })
  })

  test('falls back to the file when the section id arrived unspellable', () => {
    /* It travels over a socket. A component that is no longer a name is where a
       key nothing can read back would come from. */
    expect(scopeOf('thesis', { file: 'main.tex', section: 'not a name', title: 'x' }).kind).toBe('file')
  })
})

describe('the target each rung is held against', () => {
  test('is the paper itself at the top, which is what this module did before', () => {
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

describe('climbing back out', () => {
  test('a section widens to its own file, not straight to the paper', () => {
    /* Two different climbs. A reader moving between subsections of one chapter
       wants the chapter, and making them press twice to get it would be this
       app deciding for them that the file rung is not interesting. */
    const scope: Scope = {
      kind: 'section',
      epic: 'thesis',
      file: 'chapters/3_methods.tex',
      id: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    }
    expect(widen(scope)).toEqual({
      kind: 'file',
      epic: 'thesis',
      file: 'chapters/3_methods.tex',
      id: 'chapters:3_methods',
    })
  })

  test('a file widens to the paper', () => {
    expect(widen({ kind: 'file', epic: 'thesis', file: 'main.tex', id: 'main' }))
      .toEqual({ kind: 'paper', epic: 'thesis' })
  })

  test('the paper is the top, and off the ladder there is nowhere to climb', () => {
    expect(widen({ kind: 'paper', epic: 'thesis' })).toBe(null)
    expect(widen({ kind: 'elsewhere' })).toBe(null)
  })
})

describe('the rung a TARGET sits on, which is what the screen draws', () => {
  const placed = {
    file: 'chapters/3_methods.tex',
    section: 'chapters:3_methods#sec:meth-design',
    title: 'Research design',
  }

  test('takes the real heading words when the reader is in the section the target names', () => {
    expect(scopeOfTarget(paper('thesis', placed.section), placed)).toMatchObject({
      kind: 'section',
      title: 'Research design',
    })
  })

  test('follows the TARGET and not the reader after a widen', () => {
    /* The passage has not moved — this module never sets one — but the ticks in
       front of the reader now belong to the file. Drawing the heading from where
       the reader is standing would print the section's title over the file's
       ticks, which is the disagreement the widen control exists to make
       visible. */
    expect(scopeOfTarget(paper('thesis', 'chapters:3_methods'), placed)).toMatchObject({
      kind: 'file',
      id: 'chapters:3_methods',
    })
  })

  test('prints the id when it has no better words, rather than inventing any', () => {
    expect(scopeOfTarget(paper('thesis', 'chapters:9_other#sec:x'), placed)).toMatchObject({
      kind: 'section',
      title: 'sec:x',
    })
  })

  test('is off the ladder for a ref, which has no document and never will', () => {
    expect(scopeOfTarget({ kind: 'ref', ref: 'gh#105' }, placed)).toEqual({ kind: 'elsewhere' })
    expect(scopeOfTarget(null, placed)).toEqual({ kind: 'elsewhere' })
  })
})

describe('what a narrowed container is not showing', () => {
  const held = ticks([
    [paper('thesis'), 8],
    [paper('thesis', 'chapters:3_methods'), 3],
    [paper('thesis', 'chapters:3_methods#sec:meth-design'), 2],
    [paper('thesis', 'chapters:1_introduction'), 1],
    [{ kind: 'ref', ref: 'gh#105' }, 5],
    [paper('other-paper'), 4],
  ])

  test('counts every tick this paper holds outside the rung in front', () => {
    /* The failure this prevents, said as a number: a reader who ticked eight
       items against the paper walks into section 3 and sees 0/12. Without this
       count that is indistinguishable from the app having lost them. */
    const scope = scopeOf('thesis', {
      file: 'chapters/3_methods.tex',
      section: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    })
    expect(narrow(scope, held).elsewhere).toBe(8 + 3 + 1)
  })

  test('counts the sections when the rung is the file, because they are hidden too', () => {
    const scope = scopeOf('thesis', { file: 'chapters/3_methods.tex', section: null, title: null })
    expect(narrow(scope, held).elsewhere).toBe(8 + 2 + 1)
  })

  test('counts nothing at the top of the ladder, because nothing is being hidden', () => {
    /* And the widen control goes with it: a paper is the whole paper, and a row
       offering to widen it would be offering a press that does nothing. */
    const at = narrow({ kind: 'paper', epic: 'thesis' }, held)
    expect(at.elsewhere).toBe(0)
    expect(at.wider).toBe(null)
  })

  test('never counts a ref, or another paper — those were never being shown here', () => {
    const scope = scopeOf('thesis', { file: 'main.tex', section: null, title: null })
    const at = narrow(scope, held)
    /* 8 on the paper, 3 + 2 + 1 in its chapters. Not the 5 on gh#105, which is a
       different piece of work, and not the 4 on another paper. */
    expect(at.elsewhere).toBe(14)
  })

  test('offers a way out wherever it is hiding something', () => {
    const scope = scopeOf('thesis', { file: 'main.tex', section: null, title: null })
    expect(narrow(scope, held).wider).toEqual({ kind: 'paper', epic: 'thesis' })
  })

  test('does nothing at all to a list held against an issue', () => {
    const at = narrow({ kind: 'elsewhere' }, held)
    expect(at).toEqual({ scope: { kind: 'elsewhere' }, target: null, elsewhere: 0, wider: null })
  })
})

describe('what the container and the door say they are showing', () => {
  const scope = scopeOf('thesis', {
    file: 'chapters/3_methods.tex',
    section: 'chapters:3_methods#sec:meth-design',
    title: 'Research design',
  })

  test('the screen gets the words, because a path is ninety characters of what they already know', () => {
    expect(briefOf(scope)).toBe('Research design')
    expect(briefOf({ kind: 'file', epic: 'thesis', file: 'chapters/3_methods.tex', id: 'chapters:3_methods' }))
      .toBe('3_methods.tex')
    expect(briefOf({ kind: 'paper', epic: 'thesis' })).toBe('the whole paper')
  })

  test('an agent gets the address, because it may be standing anywhere', () => {
    expect(saidOf(scope)).toContain('chapters/3_methods.tex')
    expect(saidOf(scope)).toContain('Research design')
    expect(saidOf({ kind: 'elsewhere' })).toContain('not held against a paper')
  })
})

/**
 * The ladder as the host is offered it, which is the half that has to be a
 * CHOICE rather than a POSITION.
 *
 * The block that matters most is the third one. The host remembers a grain
 * against a container forever, so the case a reader will actually hit is
 * carrying `section` into a file that has none — and honouring that literally
 * would mean narrowing by a target nobody can see, choose or clear.
 */
describe('the ladder offered as a grain', () => {
  const inSection = scopeOf('thesis', {
    file: 'chapters/3_methods.tex',
    section: 'chapters:3_methods#sec:meth-design',
    title: 'Research design',
  })
  const inFile = scopeOf('thesis', { file: 'main.tex', section: null, title: null })
  const key = (at: Scope) => ladderKey(rungsOf(at))

  test('offers every rung that exists, narrowest first', () => {
    expect(rungsOf(inSection).map((rung) => rung.grain)).toEqual(['section', 'file', 'paper'])
    const group = offerAt(key(inSection))?.[0]
    expect(group?.id).toBe('grain')
    expect(group?.options.map((option) => option.id)).toEqual(['section', 'file', 'paper'])
    /* The resting state is following the reader, so the fallback is the
       narrowest rung and not the widest — see the essay on `offerAt`. */
    expect(group?.fallback).toBe('section')
  })

  test('offers no rung that does not exist', () => {
    /* `main.tex` has no labelled heading above the reader, so there is no
       section rung. An option that cannot be honoured is a control that looks
       broken when it is pressed. */
    expect(offerAt(key(inFile))?.[0]?.options.map((option) => option.id)).toEqual(['file', 'paper'])
  })

  test('withdraws the control where there is genuinely nothing to narrow', () => {
    /* A ref. `[]` is a real message — it takes the control away — and the host
       prunes the container's stored choice against it, which is right here
       because an issue has no document and never will. */
    expect(offerAt(key({ kind: 'elsewhere' }))).toEqual([])
  })

  test('says nothing at all rather than claiming there is nothing to narrow', () => {
    /* The bug this returns three answers for. A paper with no passage resolved
       under it is a ladder of one, and a one-option control does nothing — but
       answering `[]` tells the host to erase the reader's stored grain, and on a
       reload this module is framed before anything broadcasts a passage. So the
       filter worked perfectly and never survived a refresh. Null is "not yet",
       and `src/app.tsx` sends nothing when it sees one. */
    expect(offerAt(key({ kind: 'paper', epic: 'thesis' }))).toBe(null)
    /* And the third source of it: the page has not heard from its own server, so
       it does not know which of the two cases above it is in. */
    expect(offerAt(null)).toBe(null)
  })

  test('names no file and no section anywhere in the offer', () => {
    /* The whole of why this may be remembered per container forever. The offer
       is a grain; the place it applies to is derived from the passage every
       time and stored by nobody. */
    expect(JSON.stringify(offerAt(key(inSection)))).not.toContain('3_methods')
    expect(JSON.stringify(offerAt(key(inSection)))).not.toContain('meth-design')
  })

  test('falls back when a remembered rung is not available here', () => {
    /* The reader chose `section` in a chapter full of headings and then opened
       `main.tex`, which has none. Honouring it would build a target for a
       section that is not there. */
    expect(grainAt({ grain: 'section' }, key(inFile))).toBe('file')
    expect(widenedTarget(key(inFile), grainAt({ grain: 'section' }, key(inFile)))).toBe(null)
    /* And the same for a grain from a version of this module that no longer
       exists, which is what a greeting can carry before anything is offered. */
    expect(grainAt({ grain: 'passage' }, key(inSection))).toBe('section')
  })

  test('turns a chosen grain into the target that widening used to pick', () => {
    expect(widenedTarget(key(inSection), 'file')).toEqual({
      kind: 'paper',
      epic: 'thesis',
      section: 'chapters:3_methods',
    })
    expect(widenedTarget(key(inSection), 'paper')).toEqual({ kind: 'paper', epic: 'thesis', section: null })
  })

  test('decides nothing on the narrowest rung, so the server goes on resolving the passage', () => {
    /* Null and not a target, deliberately: sending one would make it a `pick`,
       and a pick stops the server reading the path. The untouched path has to
       stay byte-for-byte what it was before any of this existed. */
    expect(widenedTarget(key(inSection), 'section')).toBe(null)
    expect(widenedTarget(key(inFile), 'file')).toBe(null)
    expect(widenedTarget(key({ kind: 'elsewhere' }), null)).toBe(null)
  })
})

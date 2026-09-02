import { describe, expect, test } from 'bun:test'

import { AIM, aimOf, aimOffer, inFrontOf, nameOf, whyEmpty, type Shown } from '../list/aim.ts'

/**
 * What is in front of the reader once the kehikko can say what each container
 * shows and which are picked out, as a table of canvases.
 *
 * The fixture is the canvas the ask describes: a paper open at a chapter, a
 * journeys container holding a step's references, a references list with one
 * clicked, and two consumers — this one and notes — showing nothing anybody
 * files a list against. Every case is a way of ticking boxes on that canvas.
 */

const CHAPTER = { path: '/thesis/chapters/3_methods.tex', from: null, to: null }
const PARAGRAPH = { path: '/thesis/chapters/3_methods.tex', from: 4120, to: 4180 }
const INTRO = { path: '/thesis/chapters/1_introduction.tex', from: null, to: null }

function canvas(picked: string[] = []): Shown[] {
  const is = (id: string) => picked.includes(id)
  return [
    { module: 'roadmap.paper', selected: is('roadmap.paper'), refs: [], documents: [PARAGRAPH, CHAPTER] },
    { module: 'roadmap.journeys', selected: is('roadmap.journeys'), refs: ['gh#10', 'gh#11'], documents: [] },
    { module: 'roadmap.references', selected: is('roadmap.references'), refs: ['gh#7'], documents: [INTRO] },
    { module: 'roadmap.checklist', selected: is('roadmap.checklist'), refs: [], documents: [] },
    { module: 'roadmap.notes', selected: is('roadmap.notes'), refs: [], documents: [] },
  ]
}

describe('nothing picked out means everything on the kehikko', () => {
  test('the passage and the selection lead, and every container\'s showing follows', () => {
    const front = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(), aim: 'follow' })
    expect(front.narrowed).toBe(false)
    expect(front.paper).toBe(true)
    expect(front.picked).toEqual([])
    expect(front.refs).toEqual(['gh#7', 'gh#10', 'gh#11'])
    /* The reader's own passage first and once, though the paper says it too. */
    expect(front.documents).toEqual([PARAGRAPH, CHAPTER, INTRO])
  })

  test('an older host lists no containers, and the page is the page it was', () => {
    const front = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: [], aim: 'follow' })
    expect(front.refs).toEqual(['gh#7'])
    expect(front.documents).toEqual([PARAGRAPH])
    expect(front.narrowed).toBe(false)
    expect(whyEmpty(front)).toBeNull()
    expect(aimOffer([])).toEqual([])
  })
})

describe('some picked out means only what those show', () => {
  test('two providers picked: the union of what they show, and nothing from the rest', () => {
    const front = inFrontOf({
      passage: PARAGRAPH,
      selection: ['gh#7'],
      containers: canvas(['roadmap.paper', 'roadmap.journeys']),
      aim: 'follow',
    })
    expect(front.narrowed).toBe(true)
    expect(front.picked).toEqual(['roadmap.paper', 'roadmap.journeys'])
    expect(front.refs).toEqual(['gh#10', 'gh#11'])
    expect(front.documents).toEqual([PARAGRAPH, CHAPTER])
    expect(front.paper).toBe(true)
    expect(front.quiet).toEqual([])
    expect(whyEmpty(front)).toBe('paper and journeys are picked out; no checklist is held against what they show.')
  })

  test('the selection is put aside when its setter is not picked', () => {
    /* `gh#7` is the canvas's selection and References' showing; with Journeys
       alone picked out, neither reaches the page. That is the narrowing. */
    const front = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(['roadmap.journeys']), aim: 'follow' })
    expect(front.refs).toEqual(['gh#10', 'gh#11'])
    expect(front.documents).toEqual([])
    /* And the whole paper is not in front of a journeys pane. */
    expect(front.paper).toBe(false)
    expect(whyEmpty(front)).toBe('journeys is picked out; no checklist is held against what it shows.')
  })

  test('a picked container that shows nothing is named as showing nothing', () => {
    const front = inFrontOf({ passage: PARAGRAPH, selection: [], containers: canvas(['roadmap.notes']), aim: 'follow' })
    expect(front.refs).toEqual([])
    expect(front.documents).toEqual([])
    expect(front.quiet).toEqual(['roadmap.notes'])
    expect(whyEmpty(front)).toBe('notes is picked out and shows nothing a checklist can be held against.')
  })

  test('one of two picked shows nothing, and the sentence says which', () => {
    const front = inFrontOf({ passage: null, selection: [], containers: canvas(['roadmap.paper', 'roadmap.checklist']), aim: 'follow' })
    expect(front.documents).toEqual([PARAGRAPH, CHAPTER])
    expect(whyEmpty(front)).toBe(
      'paper and checklist are picked out; no checklist is held against what they show. checklist shows nothing.',
    )
  })

  test('the way out: "everything on this kehikko" ignores the picks and says nothing about them', () => {
    const front = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(['roadmap.journeys']), aim: 'all' })
    expect(front.narrowed).toBe(false)
    expect(front.picked).toEqual(['roadmap.journeys'])
    expect(front.refs).toEqual(['gh#7', 'gh#10', 'gh#11'])
    expect(whyEmpty(front)).toBeNull()
  })
})

describe('the control in the header', () => {
  test('one group, following by default, with the count in the label', () => {
    const [group] = aimOffer(canvas(['roadmap.paper', 'roadmap.journeys']))
    expect(group?.id).toBe(AIM)
    expect(group?.fallback).toBe('follow')
    expect(group?.options.map((o) => o.id)).toEqual(['follow', 'all'])
    expect(group?.options[0]?.label).toBe('follow what is picked out (2 of 5 picked out)')
    expect(aimOffer(canvas())[0]?.options[0]?.label).toBe('follow what is picked out (nothing picked out)')
  })

  test('the choice is read leniently, and anything unknown follows', () => {
    expect(aimOf({ [AIM]: 'all' })).toBe('all')
    expect(aimOf({ [AIM]: 'follow' })).toBe('follow')
    expect(aimOf({ [AIM]: 'grain' })).toBe('follow')
    expect(aimOf({})).toBe('follow')
    expect(aimOf(null)).toBe('follow')
    /* A stranger's key must not fall through to the prototype. */
    expect(aimOf({ constructor: 'all' } as Record<string, string>)).toBe('follow')
  })

  test('a module is named by the last word of its id, and an id with no dot by itself', () => {
    expect(nameOf('roadmap.journeys')).toBe('journeys')
    expect(nameOf('journeys')).toBe('journeys')
  })
})

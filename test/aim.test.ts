import { describe, expect, test } from 'bun:test'

import { AIM, aimOf, aimOffer, forPicked, inFrontOf, nameOf, whyEmpty, type Shown } from '../list/aim.ts'

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
    { module: 'kehikot.paper', selected: is('kehikot.paper'), refs: [], documents: [PARAGRAPH, CHAPTER] },
    { module: 'kehikot.journeys', selected: is('kehikot.journeys'), refs: ['gh#10', 'gh#11'], documents: [] },
    { module: 'kehikot.references', selected: is('kehikot.references'), refs: ['gh#7'], documents: [INTRO] },
    { module: 'kehikot.checklist', selected: is('kehikot.checklist'), refs: [], documents: [] },
    { module: 'kehikot.notes', selected: is('kehikot.notes'), refs: [], documents: [] },
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
      containers: canvas(['kehikot.paper', 'kehikot.journeys']),
      aim: 'follow',
    })
    expect(front.narrowed).toBe(true)
    expect(front.picked).toEqual(['kehikot.paper', 'kehikot.journeys'])
    expect(front.refs).toEqual(['gh#10', 'gh#11'])
    expect(front.documents).toEqual([PARAGRAPH, CHAPTER])
    expect(front.paper).toBe(true)
    expect(front.quiet).toEqual([])
    expect(whyEmpty(front)).toBe('paper and journeys are picked out; no checklist is held against what they show.')
  })

  test('the selection is put aside when its setter is not picked', () => {
    /* `gh#7` is the canvas's selection and References' showing; with Journeys
       alone picked out, neither reaches the page. That is the narrowing. */
    const front = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(['kehikot.journeys']), aim: 'follow' })
    expect(front.refs).toEqual(['gh#10', 'gh#11'])
    expect(front.documents).toEqual([])
    /* And the whole paper is not in front of a journeys pane. */
    expect(front.paper).toBe(false)
    expect(whyEmpty(front)).toBe('journeys is picked out; no checklist is held against what it shows.')
  })

  test('a picked container that shows nothing is named as showing nothing', () => {
    const front = inFrontOf({ passage: PARAGRAPH, selection: [], containers: canvas(['kehikot.notes']), aim: 'follow' })
    expect(front.refs).toEqual([])
    expect(front.documents).toEqual([])
    expect(front.quiet).toEqual(['kehikot.notes'])
    expect(whyEmpty(front)).toBe('notes is picked out and shows nothing a checklist can be held against.')
  })

  test('one of two picked shows nothing, and the sentence says which', () => {
    const front = inFrontOf({ passage: null, selection: [], containers: canvas(['kehikot.paper', 'kehikot.checklist']), aim: 'follow' })
    expect(front.documents).toEqual([PARAGRAPH, CHAPTER])
    expect(whyEmpty(front)).toBe(
      'paper and checklist are picked out; no checklist is held against what they show. checklist shows nothing.',
    )
  })

  test('the way out: "everything on this kehikko" ignores the picks and says nothing about them', () => {
    const front = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(['kehikot.journeys']), aim: 'all' })
    expect(front.narrowed).toBe(false)
    expect(front.picked).toEqual(['kehikot.journeys'])
    expect(front.refs).toEqual(['gh#7', 'gh#10', 'gh#11'])
    expect(whyEmpty(front)).toBeNull()
  })
})

describe('picked parts say what is in front, ahead of what the canvas happens to show', () => {
  test('a part picked and no container picked out: no document is asked by, the whole paper is, and the refs are as they were', () => {
    /* A paper walked to a passage by somebody else names the chapter it was
       walked to; one showing two picked parts has its caret in one. Neither is
       what the person picked. `list/focus.ts` narrows to the parts. */
    const front = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(), aim: 'follow', focused: true })
    expect(front.byParts).toBe(true)
    expect(front.documents).toEqual([])
    expect(front.paper).toBe(true)
    expect(front.narrowed).toBe(false)
    expect(front.refs).toEqual(['gh#7', 'gh#10', 'gh#11'])
    expect(whyEmpty(front)).toBeNull()
  })

  test('a container somebody picked out still narrows, and the parts are applied to what it shows', () => {
    const front = inFrontOf({
      passage: PARAGRAPH,
      selection: ['gh#7'],
      containers: canvas(['kehikot.paper']),
      aim: 'follow',
      focused: true,
    })
    expect(front.byParts).toBe(false)
    expect(front.narrowed).toBe(true)
    expect(front.documents).toEqual([PARAGRAPH, CHAPTER])
  })

  test('picked-out containers the reader chose not to follow do not narrow, so the parts decide', () => {
    const front = inFrontOf({ passage: PARAGRAPH, selection: [], containers: canvas(['kehikot.paper']), aim: 'all', focused: true })
    expect(front.byParts).toBe(true)
    expect(front.documents).toEqual([])
  })

  test('no part picked: nothing changes', () => {
    const rested = inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(), aim: 'follow', focused: false })
    expect(rested).toEqual(inFrontOf({ passage: PARAGRAPH, selection: ['gh#7'], containers: canvas(), aim: 'follow' }))
    expect(rested.byParts).toBe(false)
    expect(rested.documents).toEqual([PARAGRAPH, CHAPTER, INTRO])
  })
})

describe('the control in the header', () => {
  test('one group, following by default, with the count in the label', () => {
    const [group] = aimOffer(canvas(['kehikot.paper', 'kehikot.journeys']))
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
    expect(nameOf('kehikot.journeys')).toBe('journeys')
    expect(nameOf('journeys')).toBe('journeys')
  })
})

/**
 * Paper, Slides and Screenplay each showing the same chapter, and three lists
 * held against it: one for nobody in particular, one for the screenplay's work,
 * one for the slides' (Jalez/kehikko-checklist#15).
 */
describe('a list for one module’s work follows the container picked out', () => {
  const three = (picked: string[] = []): Shown[] =>
    ['kehikot.paper', 'kehikot.slides', 'kehikot.screenplay'].map((module) => ({
      module,
      selected: picked.includes(module),
      refs: [],
      documents: [CHAPTER],
    }))
  const front = (picked: string[], aim: 'follow' | 'all' = 'follow') =>
    inFrontOf({ passage: null, selection: [], containers: three(picked), aim })
  type Row = { checklist: { id: string; for?: string } }
  const everyones: Row = { checklist: { id: 'a' } }
  const screenplays: Row = { checklist: { id: 'b', for: 'kehikot.screenplay' } }
  const slides: Row = { checklist: { id: 'c', for: 'kehikot.slides' } }
  const held: Row[] = [everyones, screenplays, slides]

  test('nothing picked out is everything, and the same array comes back', () => {
    const out = forPicked(held, front([]))
    expect(out.instances).toBe(held)
    expect(out.aside).toEqual([])
  })

  test('picking a module out leaves its own lists and every module’s, and names whose were put aside', () => {
    const screenplay = forPicked(held, front(['kehikot.screenplay']))
    expect(screenplay.instances).toEqual([everyones, screenplays])
    expect(screenplay.aside).toEqual(['kehikot.slides'])
    const paper = forPicked(held, front(['kehikot.paper']))
    expect(paper.instances).toEqual([everyones])
    expect(paper.aside).toEqual(['kehikot.screenplay', 'kehikot.slides'])
    expect(forPicked(held, front(['kehikot.slides', 'kehikot.screenplay'])).instances).toBe(held)
  })

  test('a list that names no module is never put aside, which is every list written before one could', () => {
    const old: Row[] = [everyones, { checklist: { id: 'd' } }]
    expect(forPicked(old, front(['kehikot.paper'])).instances).toBe(old)
  })

  test('turning the narrowing off puts nothing aside', () => {
    expect(forPicked(held, front(['kehikot.paper'], 'all')).instances).toBe(held)
  })

  test('a page the pick emptied says whose work the lists held there are for', () => {
    const picked = front(['kehikot.paper'])
    const out = forPicked([screenplays, slides], picked)
    expect(out.instances).toEqual([])
    expect(whyEmpty(picked, out.aside)).toBe(
      'paper is picked out; the checklists held against what it shows are for screenplay and slides.',
    )
    /* And with nothing put aside the sentence is the one it was. */
    expect(whyEmpty(picked)).toBe('paper is picked out; no checklist is held against what it shows.')
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'

import type { Held } from '../list/checklists.ts'
import type { Outline } from '../file/outline.ts'
import type { Placed } from '../list/scope.ts'
import type { Target } from '../list/targets.ts'
import { AllView } from '../src/view/all.tsx'
import { EditView } from '../src/view/edit.tsx'
import { HereView } from '../src/view/here.tsx'
import { Nowhere } from '../src/view/nowhere.tsx'
import { room, type Room } from '../src/view/room.ts'
import type { Here } from '../src/store/ask.ts'

/**
 * The components, rendered for real.
 *
 * Half the value of these is that the words on screen are the thing being
 * asserted: a refusal that names what to do instead is worth nothing if the row
 * it belongs to never draws it, and a two-press arm that never says what the
 * second press does is a dialog with the sentence removed.
 *
 * The other half is what is NOT on screen. The reading page used to carry a
 * row reading `Reading <file>` with a `change` press, a screen saying a list
 * was "not held here" with a press to hold it, and a sentence about nothing
 * having been ticked yet. The owner called all of it useless, and every case
 * on the reading page below asserts its absence beside whatever it asserts
 * the presence of — because a rewrite that kept one of those rows would pass
 * every positive assertion and still be the thing that was reported.
 *
 * happy-dom performs no layout. Everything here is about which elements and
 * which words exist; what fits at 220×300 is `dev/room.probe.mjs`, in a real
 * browser.
 */
afterEach(cleanup)

const ROOMY = room(900, 700)
const TIGHT = room(220, 300)

const LONG =
  'The bridge chapter still claims the wire is synchronous, which it has not been since the mailbox landed, and the '
  + 'paragraph after it repeats the claim in different words so that fixing one leaves the other standing — see also '
  + 'the figure, whose caption says the same thing a third time and is the one somebody will quote.'

const REF: Target = { kind: 'ref', ref: 'gh#105' }
const SECTION: Target = { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' }
const FILE: Target = { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods' }
const PAPER: Target = { kind: 'paper', epic: 'thesis', section: null }

const PLACED: Placed = {
  file: 'chapters/3_methods.tex',
  section: 'chapters:3_methods#sec:meth-design',
  title: 'Research design',
}

const OUTLINE: Outline = {
  root: '',
  capped: false,
  files: [
    { file: 'main.tex', id: 'main', name: 'main.tex', sections: [] },
    {
      file: 'chapters/3_methods.tex',
      id: 'chapters:3_methods',
      name: '3_methods.tex',
      sections: [
        { id: 'chapters:3_methods#sec:meth-design', title: 'Research design', level: 3 },
        { id: 'chapters:3_methods#sec:meth-models', title: 'Model selection', level: 3 },
      ],
    },
  ],
}

function held(over: Partial<Held> = {}): Held {
  const rows = [
    { item: { id: 'aaa', text: LONG, at: '2026-01-01T00:00:00Z', by: 'the owner' }, done: null },
    {
      item: { id: 'bbb', text: 'Second', at: '2026-01-01T00:00:00Z', by: 'the owner' },
      done: { at: '2026-01-02T00:00:00Z', by: 'claude', viaMcp: true, note: 'ran it' },
    },
  ]
  return {
    checklist: {
      id: 'list1',
      name: 'What a change owes',
      at: '2026-01-01T00:00:00Z',
      by: 'the owner',
      origin: null,
      items: rows.map((r) => r.item),
      targets: ['ref:gh#105'],
    },
    target: REF,
    rows,
    done: 1,
    total: 2,
    ...over,
  } as Held
}

const noop = () => {}

function here(instances: Held[], placed: Placed | null = null): Here {
  return { placed, instances, trouble: null, nowhere: false }
}

/** `HereView` with everything a case is not about already filled in. */
function Reading(props: Partial<ComponentProps<typeof HereView>> & { here: Here | null; room: Room }) {
  return (
    <HereView
      somewhere
      listening={false}
      onEdit={noop}
      onOpen={noop}
      onAll={noop}
      trouble={null}
      busy={false}
      {...props}
    />
  )
}

/** `EditView` with the quiet defaults: no targets, no outline, an epic open, nothing selected. */
function Editing(props: Partial<ComponentProps<typeof EditView>> & { held: Held; room: Room }) {
  return (
    <EditView
      targets={[]}
      epic="thesis"
      selection={[]}
      placed={null}
      outline={null}
      paperKnown={false}
      onEdit={noop}
      onDone={noop}
      trouble={null}
      busy={false}
      {...props}
    />
  )
}

/** The words the old reading page said, none of which may come back. */
const GONE = [/^Reading/, /Held against/, /not held/i, /Nothing has been ticked/, /Hold it against/, /^change$/]

function nothingOld(container: HTMLElement) {
  for (const words of GONE) expect(screen.queryByText(words)).toBeNull()
  expect(container.querySelector('[data-switch]')).toBeNull()
  expect(container.querySelector('[data-hold]')).toBeNull()
  expect(container.querySelector('[data-unheld]')).toBeNull()
  expect(container.querySelector('[data-strip]')).toBeNull()
}

describe('the reading page: what is in front of the reader', () => {
  test('waits without claiming anything before the server has answered', () => {
    const { container } = render(<Reading here={null} room={ROOMY} />)
    expect(container.querySelector('[data-here="waiting"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-instance]')).toHaveLength(0)
  })

  test('with nothing held here, says so in one line and offers the way to every checklist', () => {
    const { container } = render(<Reading here={here([])} room={ROOMY} />)
    expect(container.querySelector('[data-none="held"]')?.textContent).toBe('No checklist is held against what is in front of you.')
    expect(container.querySelector('[data-all]')).toBeTruthy()
    nothingOld(container)
  })

  test('with nothing in front at all, says the other sentence, which has a different remedy', () => {
    const { container } = render(<Reading here={here([])} somewhere={false} room={ROOMY} />)
    expect(container.querySelector('[data-none="front"]')?.textContent).toContain('no paper is open and nothing is selected')
  })

  test('one list: its name, which target these ticks belong to, and its items — and none of the old row', () => {
    const { container } = render(<Reading here={here([held()])} room={ROOMY} />)
    expect(screen.getByText('What a change owes')).toBeTruthy()
    expect(container.querySelector('[data-label]')?.textContent).toBe('gh#105')
    expect(container.querySelector('[data-count]')?.textContent).toBe('1/2')
    expect(container.querySelectorAll('li[data-item]')).toHaveLength(2)
    /* One list needs no fold. */
    expect(container.querySelector('[data-fold]')).toBeNull()
    nothingOld(container)
  })

  test('a press ticks for the target this instance IS, and says so in the edit it sends', () => {
    const sent: unknown[] = []
    render(<Reading here={here([held({ target: SECTION, done: 0 })], PLACED)} onEdit={(e) => sent.push(e)} room={ROOMY} />)
    fireEvent.click(screen.getByText(LONG))
    expect(sent[0]).toEqual({ op: 'tick', id: 'list1', item: 'aaa', target: SECTION, done: true })
    fireEvent.click(screen.getByText('Second'))
    expect(sent[1]).toEqual({ op: 'tick', id: 'list1', item: 'bbb', target: SECTION, done: false })
  })

  test('names a section by its words, a file by its name, and the whole paper as such', () => {
    const three = [
      held({ target: SECTION }),
      held({ checklist: { ...held().checklist, id: 'f' }, target: FILE }),
      held({ checklist: { ...held().checklist, id: 'p' }, target: PAPER }),
    ]
    const { container } = render(<Reading here={here(three, PLACED)} room={ROOMY} />)
    const labels = [...container.querySelectorAll('[data-label]')].map((one) => one.textContent)
    expect(labels).toEqual(['Research design', '3_methods.tex', 'the whole paper'])
  })

  test('several lists are stacked in the order given, each foldable, and folding hides only its items', () => {
    const two = [
      held({ target: REF }),
      held({ checklist: { ...held().checklist, id: 'list2', name: 'What the thesis owes' }, target: PAPER }),
    ]
    const { container } = render(<Reading here={here(two)} room={ROOMY} />)
    const instances = [...container.querySelectorAll('[data-instance]')].map((one) => one.getAttribute('data-instance'))
    expect(instances).toEqual(['list1', 'list2'])
    expect(container.querySelectorAll('[data-fold]')).toHaveLength(2)
    expect(container.querySelectorAll('li[data-item]')).toHaveLength(4)
    fireEvent.click(container.querySelectorAll('[data-fold]')[0] as HTMLElement)
    expect(container.querySelector('[data-instance="list1"]')?.getAttribute('data-open')).toBe('no')
    expect(container.querySelectorAll('li[data-item]')).toHaveLength(2)
    /* The folded list's name and count are still there: folding is about
       room, not about hiding that the list applies. */
    expect(screen.getByText('What a change owes')).toBeTruthy()
  })

  test('the same list against a reference and a chapter is two instances, each saying which', () => {
    const twice = [held({ target: REF }), held({ target: FILE, done: 0 })]
    const { container } = render(<Reading here={here(twice, PLACED)} room={ROOMY} />)
    expect(container.querySelectorAll('[data-instance="list1"]')).toHaveLength(2)
    expect([...container.querySelectorAll('[data-label]')].map((one) => one.textContent)).toEqual(['gh#105', '3_methods.tex'])
  })

  test('the one press per instance leads to its edit page', () => {
    const opened: string[] = []
    const { container } = render(<Reading here={here([held()])} onOpen={(id) => opened.push(id)} room={ROOMY} />)
    fireEvent.click(container.querySelector('[data-edit="list1"]') as HTMLElement)
    expect(opened).toEqual(['list1'])
  })

  test('does not print who ticked an item, and keeps the note an agent left', () => {
    render(<Reading here={here([held()])} room={ROOMY} />)
    expect(screen.queryByText(/ticked by/)).toBeNull()
    expect(screen.queryByText(/over MCP/)).toBeNull()
    expect(screen.getByText('ran it')).toBeTruthy()
  })

  test('draws a 400-character item as wrapped prose in a min-w-0 column', () => {
    render(<Reading here={here([held()])} room={ROOMY} />)
    const text = screen.getByText(LONG)
    expect(text.className).toContain('break-words')
    expect(text.className).toContain('min-w-0')
    expect(text.className).not.toContain('whitespace-nowrap')
  })

  test('in a small container the instances are the one scroller and every item is a snap point', () => {
    const { container } = render(<Reading here={here([held()])} room={TIGHT} />)
    const list = container.querySelector('[data-scroller="instances"]') as HTMLElement
    expect(list.className).toContain('overflow-y-auto')
    expect(list.className).toContain('snap-proximity')
    for (const li of container.querySelectorAll('li[data-item]')) expect(li.className).toContain('snap-start')
    /* And the way to every checklist is still there. */
    expect(container.querySelector('[data-all]')).toBeTruthy()
    nothingOld(container)
  })

  test('a refusal is drawn on the page rather than swallowed', () => {
    render(<Reading here={here([held()])} trouble="that press did not come from this app’s own page" room={TIGHT} />)
    expect(screen.getByText(/did not come from/)).toBeTruthy()
  })
})

describe('the edit page: what a list says, and what it is held against', () => {
  test('lists every target the list is held against, by its words, with one press to release each', () => {
    const sent: unknown[] = []
    const targets = [
      { target: REF, done: 1 },
      { target: FILE, done: 0 },
      { target: SECTION, done: 2 },
    ]
    const { container } = render(
      <Editing held={held()} targets={targets} outline={OUTLINE} onEdit={(e) => sent.push(e)} room={ROOMY} />,
    )
    expect(container.querySelector('[data-holding]')?.getAttribute('data-holding')).toBe('3')
    const chips = [...container.querySelectorAll('[data-release]')]
    expect(chips.map((one) => one.getAttribute('data-release'))).toEqual([
      'ref:gh#105',
      'paper:thesis/chapters:3_methods',
      'paper:thesis/chapters:3_methods#sec:meth-design',
    ])
    expect(chips.map((one) => one.textContent)).toEqual(['gh#1051×Release', '3_methods.tex×Release', 'Research design2×Release'])
    fireEvent.click(chips[1] as HTMLElement)
    expect(sent[0]).toEqual({ op: 'release', id: 'list1', target: FILE })
  })

  test('held against nothing says so, at every size, because it is the only thing explaining an absent list', () => {
    const { container } = render(<Editing held={held()} room={TIGHT} />)
    expect(container.querySelector('[data-targets="none"]')?.textContent).toContain('shown nowhere until it is held')
  })

  test('the picker offers the paper, its files and their headings, and pressing one holds the list against it', () => {
    const sent: unknown[] = []
    const { container } = render(
      <Editing held={held()} outline={OUTLINE} placed={PLACED} onEdit={(e) => sent.push(e)} room={ROOMY} />,
    )
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    expect(container.querySelector('[data-pick-paper="thesis"]')).toBeTruthy()
    expect(container.querySelector('[data-pick-file="main"]')).toBeTruthy()
    fireEvent.click(container.querySelector('[data-pick-section="chapters:3_methods#sec:meth-design"]') as HTMLElement)
    expect(sent[0]).toEqual({ op: 'hold', id: 'list1', target: SECTION })
    fireEvent.click(container.querySelector('[data-pick-file="chapters:3_methods"]') as HTMLElement)
    expect(sent[1]).toEqual({ op: 'hold', id: 'list1', target: FILE })
    fireEvent.click(container.querySelector('[data-pick-paper="thesis"]') as HTMLElement)
    expect(sent[2]).toEqual({ op: 'hold', id: 'list1', target: PAPER })
  })

  test('a row the list is already held against is marked, and pressing it releases', () => {
    const sent: unknown[] = []
    const { container } = render(
      <Editing
        held={held()}
        targets={[{ target: FILE, done: 0 }]}
        outline={OUTLINE}
        placed={PLACED}
        onEdit={(e) => sent.push(e)}
        room={ROOMY}
      />,
    )
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    const row = container.querySelector('[data-pick-file="chapters:3_methods"]') as HTMLElement
    expect(row.getAttribute('data-held')).toBe('yes')
    expect((container.querySelector('[data-pick-file="main"]') as HTMLElement).getAttribute('data-held')).toBe('no')
    fireEvent.click(row)
    expect(sent[0]).toEqual({ op: 'release', id: 'list1', target: FILE })
  })

  test('the file the reader is standing in has its headings already open', () => {
    const { container } = render(<Editing held={held()} outline={OUTLINE} placed={PLACED} room={ROOMY} />)
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    expect(container.querySelector('[data-open-file="open"]')).toBeTruthy()
    expect(screen.getByText('Research design')).toBeTruthy()
    /* `main.tex` has no headings and no chevron. */
    expect(container.querySelectorAll('[data-open-file]')).toHaveLength(1)
  })

  test('offers the references the canvas has selected', () => {
    const sent: unknown[] = []
    const { container } = render(
      <Editing held={held()} selection={['gh#900', '!44']} onEdit={(e) => sent.push(e)} room={ROOMY} />,
    )
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-pick-target="ref:!44"]') as HTMLElement)
    expect(sent[0]).toEqual({ op: 'hold', id: 'list1', target: { kind: 'ref', ref: '!44' } })
  })

  test('a reference can still be typed, whatever the scan found', () => {
    const sent: unknown[] = []
    const { container } = render(<Editing held={held()} onEdit={(e) => sent.push(e)} room={ROOMY} />)
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    const box = container.querySelector('[data-type-target]') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'gh#900' } })
    fireEvent.click(screen.getByText('Hold'))
    expect(sent[0]).toEqual({ op: 'hold', id: 'list1', target: { kind: 'ref', ref: 'gh#900' } })
  })

  test('says how to get the paper’s files when no file of it is known, and offers the whole paper anyway', () => {
    const { container } = render(<Editing held={held()} outline={null} paperKnown={false} room={ROOMY} />)
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    expect(container.querySelector('[data-paper="unknown"]')).toBeTruthy()
    expect(screen.getByText(/Open the paper in the paper module/)).toBeTruthy()
    expect(container.querySelector('[data-pick-paper="thesis"]')).toBeTruthy()
  })

  test('with no epic open offers no paper at all, and says so', () => {
    const { container } = render(<Editing held={held()} epic={null} room={ROOMY} />)
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    expect(container.querySelector('[data-paper="no-epic"]')).toBeTruthy()
    expect(container.querySelector('[data-pick-paper]')).toBeNull()
    expect(container.querySelector('[data-type-target]')).toBeTruthy()
  })

  test('in a small container the picker opens over the frame', () => {
    const { container } = render(<Editing held={held()} outline={OUTLINE} room={TIGHT} />)
    expect(container.querySelector('[data-sheet]')).toBeNull()
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    expect(container.querySelector('[data-sheet]')).toBeTruthy()
    expect(container.querySelector('[data-pick-file="chapters:3_methods"]')).toBeTruthy()
  })

  test('nothing on this page is ticked, and Done goes back', () => {
    let done = 0
    const { container } = render(<Editing held={held()} onDone={() => (done += 1)} room={ROOMY} />)
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
    fireEvent.click(container.querySelector('[data-done]') as HTMLElement)
    expect(done).toBe(1)
  })

  test('the box adds a line, and Enter files it', () => {
    const sent: unknown[] = []
    const { container } = render(<Editing held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    const box = container.querySelector('#add-item') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Read the diff again' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sent[0]).toEqual({ op: 'add', id: 'list1', text: 'Read the diff again' })
  })

  test('how ticks are keyed is said here, where there is room for prose, and nowhere else', () => {
    const { container } = render(<Editing held={held()} room={ROOMY} />)
    expect(container.querySelector('[data-keying]')).toBeTruthy()
    expect(screen.getByText(/keeps its own/)).toBeTruthy()
    cleanup()
    const tight = render(<Editing held={held()} room={TIGHT} />)
    expect(tight.container.querySelector('[data-keying]')).toBeNull()
  })

  test('pressing a line rewords it, escape abandons, and an unchanged one is not sent', () => {
    const sent: unknown[] = []
    const { container } = render(<Editing held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    fireEvent.click(container.querySelector('[data-reword="bbb"]') as HTMLElement)
    const box = screen.getByLabelText('Reword this line') as HTMLTextAreaElement
    expect(box.value).toBe('Second')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(sent).toHaveLength(0)
    fireEvent.click(container.querySelector('[data-reword="bbb"]') as HTMLElement)
    fireEvent.change(screen.getByLabelText('Reword this line'), { target: { value: 'Second, sharpened' } })
    fireEvent.keyDown(screen.getByLabelText('Reword this line'), { key: 'Enter' })
    expect(sent[0]).toEqual({ op: 'reword', id: 'list1', item: 'bbb', text: 'Second, sharpened' })
  })

  test('move is drawn at 220 pixels rather than behind a press', () => {
    const sent: unknown[] = []
    const { container } = render(<Editing held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    fireEvent.click(container.querySelector('li[data-item="bbb"] [title="Move up"]') as HTMLElement)
    expect(sent[0]).toEqual({ op: 'move', id: 'list1', item: 'bbb', to: 0 })
  })

  test('removing a line takes two presses, and the first says what the second does', () => {
    const sent: unknown[] = []
    const { container } = render(<Editing held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    const row = container.querySelector('li[data-item="bbb"]') as HTMLElement
    fireEvent.click(row.querySelector('[title="Take this off the list"]') as HTMLElement)
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/along with every tick on it against every target/)).toBeTruthy()
    fireEvent.click(row.querySelector('[title="Press again to take this off the list"]') as HTMLElement)
    expect(sent[0]).toEqual({ op: 'drop', id: 'list1', item: 'bbb' })
  })

  test('removing the checklist takes two presses, and points at release for the smaller wish', () => {
    /* `window.confirm` is IGNORED inside the host's sandbox, so the second
       press is asked for in the row, where it can be seen. */
    const sent: unknown[] = []
    render(<Editing held={held()} onEdit={(e) => sent.push(e)} room={ROOMY} />)
    fireEvent.click(screen.getByText('Remove this checklist'))
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/release that target above instead/)).toBeTruthy()
    fireEvent.click(screen.getByText('Press again to remove it'))
    expect(sent[0]).toEqual({ op: 'forget', id: 'list1' })
  })
})

describe('every checklist in the project', () => {
  const lists = [
    { id: 'one', name: 'What a change owes', at: '', by: 'a test', items: 3, targets: 2, held: [REF, FILE] },
    { id: 'two', name: 'Untouched', at: '', by: 'a test', items: 1, targets: 0, held: [] },
  ]
  const props = { onCreate: noop, onImport: noop, onBack: noop, importing: false, trouble: null, busy: false, said: null }

  test('lists every checklist by name, and a press opens its edit page', () => {
    const opened: string[] = []
    render(<AllView lists={lists} onOpen={(id) => opened.push(id)} {...props} room={ROOMY} />)
    expect(screen.getByText('All checklists')).toBeTruthy()
    fireEvent.click(screen.getByText('What a change owes'))
    expect(opened).toEqual(['one'])
  })

  test('says how many things each is held against, and says nothing where the name needs the width', () => {
    /* A list held against nothing is shown nowhere on the reading page, and
       this row is the one place that says so. */
    const { container } = render(<AllView lists={lists} onOpen={noop} {...props} room={ROOMY} />)
    expect([...container.querySelectorAll('[data-summary]')].map((one) => one.textContent)).toEqual([
      '3 items, held against 2',
      '1 item, held against nothing',
    ])
    cleanup()
    const tight = render(<AllView lists={lists} onOpen={noop} {...props} room={TIGHT} />)
    expect([...tight.container.querySelectorAll('[data-summary]')].map((one) => one.textContent)).toEqual(['3', '1'])
  })

  test('says an empty store in as few words as it takes', () => {
    render(<AllView lists={[]} onOpen={noop} {...props} room={ROOMY} />)
    expect(screen.getByText('No checklists in this project yet.')).toBeTruthy()
  })

  test('Back leads to the reading page', () => {
    let back = 0
    const { container } = render(<AllView lists={lists} onOpen={noop} {...props} onBack={() => (back += 1)} room={ROOMY} />)
    fireEvent.click(container.querySelector('[data-back]') as HTMLElement)
    expect(back).toBe(1)
  })

  test('in a small container the create box is behind a press and still creates', () => {
    const made: string[] = []
    const { container } = render(
      <AllView lists={lists} onOpen={noop} {...props} onCreate={(name) => made.push(name)} room={TIGHT} />,
    )
    expect(container.querySelector('#new-checklist')).toBeNull()
    fireEvent.click(screen.getByText('Start one'))
    fireEvent.change(container.querySelector('#new-checklist') as HTMLTextAreaElement, { target: { value: 'What a paper owes' } })
    fireEvent.click(screen.getByText('Create'))
    expect(made).toEqual(['What a paper owes'])
  })

  test('says why the reader landed here when a list they were editing is gone', () => {
    render(
      <AllView
        lists={lists}
        onOpen={noop}
        {...props}
        said="That checklist is gone — removed here, or on another machine."
        room={TIGHT}
      />,
    )
    expect(screen.getByText(/That checklist is gone/)).toBeTruthy()
  })

  test('draws a long name as wrapped prose, never in a nowrap badge', () => {
    render(<AllView lists={[{ ...lists[1]!, name: LONG }]} onOpen={noop} {...props} room={ROOMY} />)
    const name = screen.getByText(LONG)
    expect(name.className).toContain('break-words')
    expect(name.className).not.toContain('whitespace-nowrap')
  })

  test('a refusal is shown where it was caused', () => {
    render(
      <AllView
        lists={[]}
        onOpen={noop}
        {...props}
        trouble="there is already a checklist called “What a change owes” (one)."
        room={ROOMY}
      />,
    )
    expect(screen.getByText(/there is already a checklist called/)).toBeTruthy()
  })
})

describe('the screen for "there is nowhere to keep a checklist"', () => {
  test('says a project has to be open, and offers nothing to press', () => {
    const { container } = render(<Nowhere unhosted={false} project={null} />)
    expect(screen.getByText(/No project is open/)).toBeTruthy()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  test('names the project when the host gave a name but no folder', () => {
    render(<Nowhere unhosted={false} project="Roadmap" />)
    expect(screen.getByText(/“Roadmap”/)).toBeTruthy()
  })

  test('says something different again when nothing is framing the page at all', () => {
    render(<Nowhere unhosted project={null} />)
    expect(screen.getByText(/Nothing is framing this page/)).toBeTruthy()
  })
})

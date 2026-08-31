import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { Held } from '../list/checklists.ts'
import { ChecklistView } from '../src/view/checklist.tsx'
import { Choose, Unplaced } from '../src/view/choose.tsx'
import { Nowhere } from '../src/view/nowhere.tsx'
import { room } from '../src/view/room.ts'
import { narrow, scopeOf } from '../list/scope.ts'

/**
 * The scope every case here is in unless it says otherwise: no paper, so no
 * ladder.
 *
 * These cases were all written before the container followed a reader, and every
 * one of them is about something else — the words on a row, who ticked it, what
 * a narrow container stops drawing. Handing them the `elsewhere` rung keeps them
 * asking what they were written to ask. The ladder's own cases are in
 * `test/scope.test.ts`, where they can be a table.
 */
const NOWHERE = narrow({ kind: 'elsewhere' }, [])

/**
 * The components, rendered for real.
 *
 * Half the value of these is that the words on screen are the thing being
 * asserted: a refusal that names what to do instead is worth nothing if the row
 * it belongs to never draws it, and a two-press arm that never says what the
 * second press does is a dialog with the sentence removed.
 */
afterEach(cleanup)

/**
 * The two containers every component below is drawn in.
 *
 * Named rather than inlined because almost every assertion here is about WORDS,
 * and which words are on screen is now a function of how much room there is.
 * A test that passed `room(900, 700)` by hand at fourteen call sites would be
 * fourteen places to forget which layout was being asserted.
 */
const ROOMY = room(900, 700)
const TIGHT = room(220, 300)

const LONG =
  'The bridge chapter still claims the wire is synchronous, which it has not been since the mailbox landed, and the '
  + 'paragraph after it repeats the claim in different words so that fixing one leaves the other standing — see also '
  + 'the figure, whose caption says the same thing a third time and is the one somebody will quote.'

function held(over: Partial<Held> = {}): Held {
  const rows = [
    { item: { id: 'aaa', text: LONG, at: '2026-01-01T00:00:00Z', by: 'the owner' }, done: null },
    {
      item: { id: 'bbb', text: 'Second', at: '2026-01-01T00:00:00Z', by: 'the owner' },
      done: { at: '2026-01-02T00:00:00Z', by: 'claude', viaMcp: true, note: 'ran it' },
    },
  ]
  return {
    checklist: { id: 'list1', name: 'What a change owes', at: '2026-01-01T00:00:00Z', by: 'the owner', origin: null, items: rows.map((r) => r.item) },
    target: { kind: 'ref', ref: 'gh#105' },
    rows,
    done: 1,
    total: 2,
    ...over,
  } as Held
}

const noop = () => {}

describe('the pick screen', () => {
  test('says which state it is in rather than a bare instruction', () => {
    render(
      <Choose
        lists={[]}
        onPick={noop}
        onCreate={noop}
        trouble={null}
        busy={false} room={ROOMY}
        said="Nothing has been picked for Roadmap yet."
      />,
    )
    expect(screen.getByText(/Nothing has been picked for Roadmap yet/)).toBeTruthy()
  })

  test('says an empty store is not a gap this app can fill, because nothing ships a list', () => {
    render(<Choose lists={[]} onPick={noop} onCreate={noop} trouble={null} busy={false} room={ROOMY} said="x" />)
    expect(screen.getByText(/Nothing ships a list/)).toBeTruthy()
  })

  test('offers every list that exists, by name, and hands the id back on a press', () => {
    let picked = ''
    render(
      <Choose
        lists={[
          { id: 'one', name: 'What a change owes', at: '', by: 'a test', items: 3, targets: 2 },
          { id: 'two', name: LONG, at: '', by: 'a test', items: 1, targets: 0 },
        ]}
        onPick={(id) => {
          picked = id
        }}
        onCreate={noop}
        trouble={null}
        busy={false} room={ROOMY}
        said="x"
      />,
    )
    fireEvent.click(screen.getByText('What a change owes'))
    expect(picked).toBe('one')
  })

  test('draws a long name as wrapped prose, never in a nowrap badge', () => {
    /* The trap: shadcn's `Badge` carries `whitespace-nowrap`, and a long string in
       one sets a min-content floor far wider than a 220px container. A sibling module
       shipped exactly that. */
    render(
      <Choose
        lists={[{ id: 'two', name: LONG, at: '', by: 'a test', items: 1, targets: 0 }]}
        onPick={noop}
        onCreate={noop}
        trouble={null}
        busy={false} room={ROOMY}
        said="x"
      />,
    )
    const name = screen.getByText(LONG)
    expect(name.className).toContain('break-words')
    expect(name.className).toContain('min-w-0')
    expect(name.className).not.toContain('whitespace-nowrap')
    expect(name.className).not.toContain('truncate')
  })

  test('a refusal is shown where it was caused, not swallowed', () => {
    render(
      <Choose
        lists={[]}
        onPick={noop}
        onCreate={noop}
        trouble="there is already a checklist called “What a change owes” (one)."
        busy={false} room={ROOMY}
        said="x"
      />,
    )
    expect(screen.getByText(/there is already a checklist called/)).toBeTruthy()
  })
})

describe('the checklist', () => {
  test('says which target it is held against, and that ticks belong to the pair', () => {
    render(
      <ChecklistView narrowed={NOWHERE} onWiden={noop} held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} room={ROOMY} />,
    )
    expect(screen.getByText('gh#105')).toBeTruthy()
    expect(screen.getByText(/keeps its own/)).toBeTruthy()
  })

  test('prints who ticked an item and that it came through the MCP door', () => {
    /* Never a bare checkmark. An agent's claim has to be legible as one. */
    render(
      <ChecklistView narrowed={NOWHERE} onWiden={noop} held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} room={ROOMY} />,
    )
    expect(screen.getByText('ticked by claude, over MCP')).toBeTruthy()
  })

  test('draws a 400-character item as wrapped prose in a min-w-0 column', () => {
    render(
      <ChecklistView narrowed={NOWHERE} onWiden={noop} held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} room={ROOMY} />,
    )
    const text = screen.getByText(LONG)
    expect(text.className).toContain('break-words')
    expect(text.className).toContain('min-w-0')
    expect(text.className).not.toContain('whitespace-nowrap')
  })

  test('a press ticks for THIS target, and says so in the edit it sends', () => {
    const sent: unknown[] = []
    render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={(e) => sent.push(e)}
        onAnother={noop}
        trouble={null}
        busy={false} room={ROOMY}
      />,
    )
    fireEvent.click(screen.getByText(LONG))
    expect(sent[0]).toEqual({ op: 'tick', id: 'list1', item: 'aaa', target: { kind: 'ref', ref: 'gh#105' }, done: true })
  })

  test('with no target the rows are text rather than controls, and the row above says why', () => {
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held({ target: null, done: 0, rows: held().rows.map((r) => ({ ...r, done: null })) })}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false} room={ROOMY}
      />,
    )
    expect(screen.getByText(/nothing below can be ticked/)).toBeTruthy()
    expect(container.querySelector('li[data-item="aaa"] button[aria-pressed]')).toBeNull()
  })

  test('removing the checklist takes two presses, and the first one says what the second does', () => {
    /* `window.confirm` is IGNORED inside the host's sandbox — `allow-modals` is
       not set — so it returns false, the handler returns early, and the button
       does nothing forever with nothing in the console. The second press is asked
       for in the row instead, where it can be seen. */
    const sent: unknown[] = []
    render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={(e) => sent.push(e)}
        onAnother={noop}
        trouble={null}
        busy={false} room={ROOMY}
      />,
    )
    const button = screen.getByText('Remove this checklist')
    fireEvent.click(button)
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/along with every tick made on it against every target/)).toBeTruthy()
    fireEvent.click(screen.getByText('Press again to remove it'))
    expect(sent[0]).toEqual({ op: 'forget', id: 'list1' })
  })

  test('the target switch offers what the context proposes and what the list already has ticks against', () => {
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[{ target: { kind: 'paper', epic: 'modes', section: null }, done: 2 }]}
        candidates={[{ kind: 'ref', ref: 'gh#105' }]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false} room={ROOMY}
      />,
    )
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelector('[data-pick-target="ref:gh#105"]')).toBeTruthy()
    expect(container.querySelector('[data-pick-target="paper:modes"]')).toBeTruthy()
  })

  test('a target proposed by the canvas and already ticked against is drawn once, not twice', () => {
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[{ target: { kind: 'ref', ref: 'gh#105' }, done: 1 }]}
        candidates={[{ kind: 'ref', ref: 'gh#105' }]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false} room={ROOMY}
      />,
    )
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelectorAll('[data-pick-target="ref:gh#105"]')).toHaveLength(1)
  })
})

describe('a container that cannot tell which kehikko it is on', () => {
  test('says so, and works anyway for the session', () => {
    render(
      <Unplaced room={ROOMY}>
        <Choose lists={[]} onPick={noop} onCreate={noop} trouble={null} busy={false} room={ROOMY} said="x" />
      </Unplaced>,
    )
    expect(screen.getByText(/cannot tell which kehikko it is on/)).toBeTruthy()
    expect(screen.getByText(/holds until this page is reloaded/)).toBeTruthy()
    /* And the pick screen is still there. Refusing to work would make a usable
       checklist unreachable because of a field a host declined to fill in. */
    expect(screen.getByText('Pick a checklist')).toBeTruthy()
  })
})

describe('the screen for "there is nowhere to keep a checklist"', () => {
  /* Not an error screen and not the pick screen. The distinction is the whole
     reason this component exists: an empty container would look exactly like a
     project with no checklists yet, and that screen has a button on it that
     would do nothing. */
  test('says a project has to be open, and offers nothing to press', () => {
    const { container } = render(<Nowhere unhosted={false} project={null} />)
    expect(screen.getByText(/No project is open/)).toBeTruthy()
    expect(screen.getByText(/kept inside the project/)).toBeTruthy()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  test('says nothing has been lost, because that is the reader’s actual question', () => {
    render(<Nowhere unhosted={false} project={null} />)
    expect(screen.getByText(/Nothing has been lost and nothing has been written/)).toBeTruthy()
  })

  /* A host that sends a NAME and no path has told this container which project it is
     looking at and given it nowhere to open. That is a different sentence from a
     host that has said nothing, and the reader can act on the difference. */
  test('names the project when the host gave a name but no folder', () => {
    render(<Nowhere unhosted={false} project="Roadmap" />)
    expect(screen.getByText(/“Roadmap”/)).toBeTruthy()
    expect(screen.getByText(/did not say where it is on this machine/)).toBeTruthy()
  })

  test('says something different again when nothing is framing the page at all', () => {
    render(<Nowhere unhosted project={null} />)
    expect(screen.getByText(/Nothing is framing this page/)).toBeTruthy()
    expect(screen.getByText(/Opened directly/)).toBeTruthy()
  })
})

/**
 * The same components in the container this module actually spends its life in.
 *
 * Every assertion below is one half of a pair: something is not on screen, AND
 * the thing it did is still reachable. A test that only checked the first would
 * pass just as happily for a feature that had been deleted.
 */
describe('a small container', () => {
  test('the box to type in is behind one press, and typing into it still adds the line', () => {
    /* Measured at 220×300 before this existed: the add box was 147 pixels of the
       300, permanently, in front of the list it is for. */
    const sent: unknown[] = []
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={(e) => sent.push(e)}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(container.querySelector('#add-item')).toBeNull()
    fireEvent.click(screen.getByText('Add a line'))
    const box = container.querySelector('#add-item') as HTMLTextAreaElement
    expect(box).toBeTruthy()
    expect(container.querySelector('[data-sheet]')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'Read the diff again' } })
    fireEvent.click(screen.getByText('Add'))
    expect(sent[0]).toEqual({ op: 'add', id: 'list1', text: 'Read the diff again' })
    /* And it closes itself, because the thing it was opened for is done. */
    expect(container.querySelector('[data-sheet]')).toBeNull()
  })

  test('leaving and removing are still reachable, from the one press that is left', () => {
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(container.querySelector('[data-another]')).toBeNull()
    fireEvent.click(container.querySelector('[data-open-more]') as HTMLElement)
    expect(container.querySelector('[data-another]')).toBeTruthy()
    expect(container.querySelector('[data-forget]')).toBeTruthy()
  })

  test('who ticked it, and that it came over MCP, is drawn at every size', () => {
    /* The one thing a narrow container may not buy space with. An agent may tick
       anything on this list, and what makes that safe is that the claim is
       legible as a claim — a bare checkmark with nobody's name against it is
       exactly what `list/checklists.ts` refuses. */
    render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.getByText('ticked by claude, over MCP')).toBeTruthy()
  })

  test('who WROTE an unticked line moves into the row’s title rather than a line of its own', () => {
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.queryByText('written by the owner')).toBeNull()
    const row = container.querySelector('li[data-item="aaa"] button[aria-pressed]') as HTMLElement
    expect(row.title).toContain('Written by the owner')
  })

  test('move and remove are folded behind one press on the row, and unfold in place', () => {
    const sent: unknown[] = []
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={(e) => sent.push(e)}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    const row = container.querySelector('li[data-item="bbb"]') as HTMLElement
    expect(row.querySelector('[title="Move up"]')).toBeNull()
    fireEvent.click(row.querySelector('[data-unfold]') as HTMLElement)
    fireEvent.click(row.querySelector('[title="Move up"]') as HTMLElement)
    expect(sent[0]).toEqual({ op: 'move', id: 'list1', item: 'bbb', to: 0 })
  })

  test('the items are the one scroller, and every item is a snap point', () => {
    /* Both halves matter: a snap point on the document scroller would snap the
       name and the target away, which is worse than not snapping at all. */
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    const list = container.querySelector('[data-scroller="items"]') as HTMLElement
    expect(list.className).toContain('overflow-y-auto')
    expect(list.className).toContain('snap-proximity')
    expect(list.className).not.toContain('snap-mandatory')
    for (const li of container.querySelectorAll('li[data-item]')) {
      expect(li.className).toContain('snap-start')
    }
  })

  test('the paragraph explaining a target goes; the sentence saying nothing can be ticked does not', () => {
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.queryByText(/keeps its own/)).toBeNull()
    /* And the fact is still somewhere a reader can get at. */
    expect((container.querySelector('[data-switch]') as HTMLElement).title).toContain('keeps its own')

    cleanup()
    render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held({ target: null, done: 0, rows: held().rows.map((r) => ({ ...r, done: null })) })}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.getByText(/nothing below can be ticked/)).toBeTruthy()
  })

  test('the target switch opens over the frame rather than pushing the list off the bottom', () => {
    const { container } = render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[{ target: { kind: 'paper', epic: 'modes', section: null }, done: 2 }]}
        candidates={[{ kind: 'ref', ref: 'gh#105' }]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelector('[data-sheet]')).toBeTruthy()
    expect(container.querySelector('[data-pick-target="ref:gh#105"]')).toBeTruthy()
    expect(container.querySelector('[data-pick-target="paper:modes"]')).toBeTruthy()
  })

  test('a refusal is still drawn on the card when the box it came from is closed', () => {
    /* The failure this catches: with the only place a refusal was ever printed
       now behind a press, a refused add would be silent — the sheet closes on
       the way out and takes the sentence with it. */
    render(
      <ChecklistView
        narrowed={NOWHERE}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble="that item is already on this list."
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.getByText(/already on this list/)).toBeTruthy()
  })

  test('the pick screen puts the create box behind a press and lets the names scroll', () => {
    const made: string[] = []
    const { container } = render(
      <Choose
        lists={[{ id: 'one', name: 'What a change owes', at: '', by: 'a test', items: 3, targets: 2 }]}
        onPick={noop}
        onCreate={(name) => made.push(name)}
        trouble={null}
        busy={false}
        said="Nothing has been picked for Roadmap yet."
        room={TIGHT}
      />,
    )
    expect(container.querySelector('#new-checklist')).toBeNull()
    expect(container.querySelector('[data-scroller="lists"]')).toBeTruthy()
    fireEvent.click(screen.getByText('Start one'))
    const box = container.querySelector('#new-checklist') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'What a paper owes' } })
    fireEvent.click(screen.getByText('Create'))
    expect(made).toEqual(['What a paper owes'])
  })

  test('the sentence saying WHY we are on the pick screen is kept, because it is the answer', () => {
    /* Clamped, not cut: "that checklist is not here any more" is the first thing
       a reader wants and the last thing a small container should drop. */
    render(
      <Choose
        lists={[]}
        onPick={noop}
        onCreate={noop}
        trouble={null}
        busy={false}
        said="That checklist is not here any more — it was removed, here or on another machine."
        room={TIGHT}
      />,
    )
    expect(screen.getByText(/That checklist is not here any more/)).toBeTruthy()
  })

  test('an unplaced container says the two facts a reader can act on, and keeps the rest in a title', () => {
    const { container } = render(
      <Unplaced room={TIGHT}>
        <Choose lists={[]} onPick={noop} onCreate={noop} trouble={null} busy={false} said="x" room={TIGHT} />
      </Unplaced>,
    )
    const note = container.querySelector('[data-unplaced]') as HTMLElement
    expect(note.textContent).toContain('not remembered')
    expect(note.textContent).toContain('until this page is reloaded')
    expect(note.title).toContain('cannot tell which kehikko it is on')
    /* And the pick screen is still there, at every size. */
    expect(screen.getByText('Pick a checklist')).toBeTruthy()
  })
})

describe('the checklist, following a reader through a paper', () => {
  const inSection = scopeOf('thesis', {
    file: 'chapters/3_methods.tex',
    section: 'chapters:3_methods#sec:meth-design',
    title: 'Research design',
  })
  const onPaper = { kind: 'paper' as const, epic: 'thesis', section: null }
  const ticked = [
    { target: onPaper, done: 8 },
    { target: { kind: 'paper' as const, epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' }, done: 2 },
  ]

  test('says the words at the top of the section, not the id it files ticks under', () => {
    /* `targetName` would print `thesis · chapters:3_methods#sec:meth-design`,
       which is sixty characters of an address in a 220-pixel column, most of it
       a slug the reader wrote as a \label. The address is still one hover
       away. */
    render(
      <ChecklistView
        narrowed={narrow(inSection, ticked)}
        onWiden={noop}
        held={held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' } })}
        targets={ticked}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.getByText('Research design')).toBeTruthy()
  })

  test('says how many ticks the narrowing is hiding, and offers the way out', () => {
    /* The whole of "nothing is hidden without being counted". Without this line a
       reader who ticked eight items against the paper walks into section 3, reads
       0/12, and has no way to tell narrowing from this app losing their work. */
    render(
      <ChecklistView
        narrowed={narrow(inSection, ticked)}
        onWiden={noop}
        held={held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' } })}
        targets={ticked}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.getByText(/8 ticked elsewhere in this paper/)).toBeTruthy()
    expect(screen.getByText(/Show 3_methods.tex/)).toBeTruthy()
  })

  test('keeps saying it in the narrowest container there is', () => {
    /* This row never folds away at any size, unlike almost everything else on
       this page. A count that vanished at 220 pixels would be a count nobody
       reads, in the container the owner actually uses. */
    const { container } = render(
      <ChecklistView
        narrowed={narrow(inSection, ticked)}
        onWiden={noop}
        held={held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' } })}
        targets={ticked}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(container.querySelector('[data-elsewhere="8"]')).toBeTruthy()
    expect(container.querySelector('[data-widen]')).toBeTruthy()
  })

  test('climbs one rung when the way out is pressed', () => {
    let climbed = 0
    const { container } = render(
      <ChecklistView
        narrowed={narrow(inSection, ticked)}
        onWiden={() => (climbed += 1)}
        held={held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' } })}
        targets={ticked}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={ROOMY}
      />,
    )
    fireEvent.click(container.querySelector('[data-widen]')!)
    expect(climbed).toBe(1)
  })

  test('draws none of it for a list held against an issue', () => {
    /* The half of this change that had to break nothing. A ref has no document,
       no rung and no widen, and the row it gets is the row it always had. */
    const { container } = render(
      <ChecklistView
        narrowed={narrow({ kind: 'elsewhere' }, ticked)}
        onWiden={noop}
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={TIGHT}
      />,
    )
    expect(screen.getByText('gh#105')).toBeTruthy()
    expect(container.querySelector('[data-widen]')).toBe(null)
    expect(container.querySelector('[data-elsewhere]')).toBe(null)
  })
})

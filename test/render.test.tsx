import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'

import type { Held } from '../list/checklists.ts'
import type { Outline } from '../file/outline.ts'
import { ChecklistView } from '../src/view/checklist.tsx'
import { Choose, Unplaced } from '../src/view/choose.tsx'
import { Nowhere } from '../src/view/nowhere.tsx'
import { room, type Room } from '../src/view/room.ts'
import { narrow, scopeOf, scopeOfTarget } from '../list/scope.ts'
import type { Target } from '../list/targets.ts'

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

/**
 * `ChecklistView` with everything a case is not about already filled in.
 *
 * Written because the component's props are the whole of what a host, a canvas
 * and a store between them tell it, and a case about which WORDS are on a row
 * had to spell out ten of them to say nothing. The cost was real: adding one
 * prop meant editing twenty-three call sites, none of which cared, and a default
 * spelled twenty-three times is twenty-three places for one of them to drift.
 *
 * Every default here is the quiet answer — no targets, no candidates, no
 * outline, no trouble, the `elsewhere` rung. A case that is about one of them
 * passes it, and then the thing being asserted is the only thing on the line.
 */
function List(props: Partial<ComponentProps<typeof ChecklistView>> & { held: Held; room: Room }) {
  return (
    <ChecklistView
      /* `held` is the quiet default for the same reason every other default here
         is the quiet one: these cases were written before a list could be
         somewhere it is not held, and every one of them is about something else.
         The `unheld` screen has its own cases, where it is the only thing being
         asserted. */
      standing="held"
      targets={[]}
      candidates={[]}
      narrowed={NOWHERE}
      outline={null}
      onOutline={noop}
      onTarget={noop}
      onEdit={noop}
      onAnother={noop}
      trouble={null}
      busy={false}
      {...props}
    />
  )
}

/** Press `Edit`, which is the one way to the other page. */
function toEdit(container: HTMLElement) {
  fireEvent.click(container.querySelector('[data-page-to="edit"]') as HTMLElement)
}

describe('the pick screen', () => {
  test('says which state it is in rather than a bare instruction', () => {
    render(
      <Choose
        lists={[]}
        onPick={noop}
        onCreate={noop}
        onImport={noop}
        importing={false}
        trouble={null}
        busy={false} room={ROOMY}
        said="Nothing has been picked for Roadmap yet."
      />,
    )
    expect(screen.getByText(/Nothing has been picked for Roadmap yet/)).toBeTruthy()
  })

  test('says an empty store in as few words as it takes, and nothing about how filing works', () => {
    /*
     * This used to assert on "Nothing ships a list", which was true and was a
     * paragraph. The user counted the lines on this screen at 220 pixels and
     * two of the four were the program explaining its own filing to somebody
     * about to press a button. What has to survive is the DISTINCTION — "this
     * project has no checklists" and "you have not picked one" are different
     * situations with different remedies — and that is what is asserted now.
     */
    render(<Choose lists={[]} onPick={noop} onCreate={noop} onImport={noop} importing={false} trouble={null} busy={false} room={ROOMY} said="x" />)
    expect(screen.getByText('No checklists in this project yet.')).toBeTruthy()
    expect(screen.queryByText(/Nothing ships a list/)).toBeNull()
    /* And the heading is still there, which is the half that says what to do. */
    expect(screen.getByText('Pick a checklist')).toBeTruthy()
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
        onImport={noop}
        importing={false}
        trouble={null}
        busy={false} room={ROOMY}
        said="x"
      />,
    )
    fireEvent.click(screen.getByText('What a change owes'))
    expect(picked).toBe('one')
  })

  test('says how many things each list is held against, which is where the work is', () => {
    /* A checklist is only ticked at the targets somebody paired it with, so a
       list held against two chapters is out of sight from everywhere else in the
       paper. This screen is what stops that being the same as gone. At 220
       pixels the second number goes and the first does not — the count of items
       is what tells one list from another, and the name needs the width. */
    const lists = [
      { id: 'one', name: 'What a change owes', at: '', by: 'a test', items: 3, targets: 2 },
      { id: 'two', name: 'Untouched', at: '', by: 'a test', items: 1, targets: 0 },
    ]
    const props = { onPick: noop, onCreate: noop, onImport: noop, importing: false, trouble: null, busy: false, said: 'x' }
    const { container } = render(<Choose lists={lists} {...props} room={ROOMY} />)
    const said = [...container.querySelectorAll('[data-summary]')].map((one) => one.textContent)
    expect(said).toEqual(['3 items, held against 2', '1 item'])

    cleanup()
    const tight = render(<Choose lists={lists} {...props} room={TIGHT} />)
    expect([...tight.container.querySelectorAll('[data-summary]')].map((one) => one.textContent)).toEqual(['3', '1'])
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
        onImport={noop}
        importing={false}
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
        onImport={noop}
        importing={false}
        trouble="there is already a checklist called “What a change owes” (one)."
        busy={false} room={ROOMY}
        said="x"
      />,
    )
    expect(screen.getByText(/there is already a checklist called/)).toBeTruthy()
  })
})

describe('the checklist', () => {
  test('says which target it is held against, and how ticks are keyed is on the other page', () => {
    /* This case used to assert both sentences on this page. The owner moved the
       second one — "Shouldn't this show in the edit view of the checklist?" —
       and the case moved with it rather than being deleted, because the fact
       still has to be reachable and now has a different address. See the essay
       on `Keying`. */
    const { container } = render(
      <List narrowed={NOWHERE} held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} room={ROOMY} />,
    )
    expect(screen.getByText('gh#105')).toBeTruthy()
    expect(screen.queryByText(/keeps its own/)).toBeNull()
    expect(container.querySelector('[data-keying]')).toBeNull()

    toEdit(container)
    expect(screen.getByText(/keeps its own/)).toBeTruthy()
    /* And it names no target, because this page has none — the sentence is true
       of every target the list will ever be held against. */
    expect(screen.queryByText(/gh#105/)).toBeNull()
  })

  /*
   * The three kinds of target, and the article in front of each of them.
   *
   * On screen this read "A a section of a paper", because `targetNoun` handed
   * back two of its branches with an article and the callers wrote `A ` in front
   * of all three. Every branch is asserted here rather than only the one that
   * was reported: the repair that looks obvious — take the article OUT of the
   * noun — makes the ref branch read "A issue, merge request or pull request",
   * which is the same bug wearing a different branch. See `list/targets.ts`.
   */
  const kinds: [string, Target, string][] = [
    ['an issue', { kind: 'ref', ref: 'gh#105' }, 'Held against an issue, merge request or pull request. Press to change it.'],
    ['a whole paper', { kind: 'paper', epic: 'thesis', section: null }, 'Held against a paper. Press to change it.'],
    ['a section', { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' }, 'Held against a section of a paper. Press to change it.'],
  ]
  for (const [what, target, said] of kinds) {
    test(`names the kind of thing it is held against, with exactly one article, for ${what}`, () => {
      const { container } = render(<List held={held({ target })} room={ROOMY} />)
      const press = container.querySelector('[data-switch]') as HTMLElement
      expect(press.getAttribute('title')).toBe(said)
      /* The shape of the old bug, asserted directly: never an article twice, in
         any casing, anywhere this page puts words on screen. */
      expect(press.getAttribute('title')).not.toMatch(/\b[Aa]n? [Aa]n? /)
      expect(container.textContent).not.toMatch(/\b[Aa]n? [Aa]n? /)
    })
  }

  test('does not print who ticked an item, at the roomiest size there is', () => {
    /* This assertion used to be its exact opposite, and the reversal is the
       owner's: "information about what checklist items is and isn't written by
       Claude is not important information, get rid of it."

       Both halves are asserted, because a case that only checked the badge was
       gone would pass just as happily for a row that had stopped being a tick
       control. What made an agent's tick safe was never the name under it — it
       was that the claim is REVERSIBLE by the person who can judge it, and that
       is the second half below. See the essay on `ItemRow`. */
    const sent: unknown[] = []
    render(<List held={held()} onEdit={(e) => sent.push(e)} room={ROOMY} />)
    expect(screen.queryByText(/ticked by/)).toBeNull()
    expect(screen.queryByText(/over MCP/)).toBeNull()
    expect(screen.queryByText(/written by/)).toBeNull()

    fireEvent.click(screen.getByText('Second'))
    expect(sent[0]).toEqual({
      op: 'tick',
      id: 'list1',
      item: 'bbb',
      target: { kind: 'ref', ref: 'gh#105' },
      done: false,
    })
  })

  test('keeps the note an agent left, because a reason is content and a name is not', () => {
    /* `note` is "how they know" — a sentence somebody wrote about the work,
       which is the thing a reader can act on. It is not provenance and it did
       not go with it. */
    render(<List held={held()} room={ROOMY} />)
    expect(screen.getByText('ran it')).toBeTruthy()
  })

  test('draws a 400-character item as wrapped prose in a min-w-0 column', () => {
    render(
      <List narrowed={NOWHERE} held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} room={ROOMY} />,
    )
    const text = screen.getByText(LONG)
    expect(text.className).toContain('break-words')
    expect(text.className).toContain('min-w-0')
    expect(text.className).not.toContain('whitespace-nowrap')
  })

  test('a press ticks for THIS target, and says so in the edit it sends', () => {
    const sent: unknown[] = []
    render(
      <List
        narrowed={NOWHERE}
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
      <List
        narrowed={NOWHERE}
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
    const { container } = render(<List held={held()} onEdit={(e) => sent.push(e)} room={ROOMY} />)
    toEdit(container)
    const button = screen.getByText('Remove this checklist')
    fireEvent.click(button)
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/along with every tick made on it against every target/)).toBeTruthy()
    fireEvent.click(screen.getByText('Press again to remove it'))
    expect(sent[0]).toEqual({ op: 'forget', id: 'list1' })
  })

  test('the target switch offers what the context proposes and what the list already has ticks against', () => {
    const { container } = render(
      <List
        narrowed={NOWHERE}
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
      <List
        narrowed={NOWHERE}
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
        <Choose lists={[]} onPick={noop} onCreate={noop} onImport={noop} importing={false} trouble={null} busy={false} room={ROOMY} said="x" />
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
  test('the box to type in is on the edit page, and typing into it still adds the line', () => {
    /* Measured at 220×300 before any of this: the add box was 147 pixels of the
       300, permanently, in front of the list it is for. It went behind a press
       and then behind a page, and the pair is what this asserts: the state page
       has no box on it at all, and the box still adds a line.

       The price is named in the essay on `ChecklistView` and it is real: adding
       is two presses now instead of one. */
    const sent: unknown[] = []
    const { container } = render(<List held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    expect(container.querySelector('#add-item')).toBeNull()
    toEdit(container)
    const box = container.querySelector('#add-item') as HTMLTextAreaElement
    expect(box).toBeTruthy()
    fireEvent.change(box, { target: { value: 'Read the diff again' } })
    fireEvent.click(screen.getByText('Add'))
    expect(sent[0]).toEqual({ op: 'add', id: 'list1', text: 'Read the diff again' })
  })

  test('leaving and removing are still reachable, from the one press that is left', () => {
    const { container } = render(<List held={held()} room={TIGHT} />)
    expect(container.querySelector('[data-another]')).toBeNull()
    toEdit(container)
    expect(container.querySelector('[data-another]')).toBeTruthy()
    expect(container.querySelector('[data-forget]')).toBeTruthy()
  })

  test('who ticked it is drawn at NO size, and the row is still a tick control', () => {
    /* This case used to be the opposite of itself, under the heading "the one
       thing a narrow container may not buy space with". The owner has said the
       badge is not information, and the essay on `ItemRow` sets out which half
       of the old argument that overtakes and which half it does not: the record
       and the reversibility both stand, and the second one is asserted here. */
    const sent: unknown[] = []
    const { container } = render(<List held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    expect(screen.queryByText(/ticked by/)).toBeNull()
    expect(screen.queryByText(/written by/)).toBeNull()
    const row = container.querySelector('li[data-item="aaa"] button[aria-pressed]') as HTMLElement
    expect(row.title).not.toContain('Written by')
    fireEvent.click(row)
    expect(sent[0]).toEqual({
      op: 'tick',
      id: 'list1',
      item: 'aaa',
      target: { kind: 'ref', ref: 'gh#105' },
      done: true,
    })
  })

  test('an item on the state page is a mark and a line, with no furniture beside it', () => {
    /* The vertical space the split is FOR. Every row used to carry a `⋯` press
       to unfold the arrows and the ×, and a line of provenance under the text;
       sixteen items were thirty-two lines. Neither is on this page any more, at
       any size, and the `⋯` has no reason to exist. */
    const { container } = render(<List held={held()} room={TIGHT} />)
    const row = container.querySelector('li[data-item="bbb"]') as HTMLElement
    expect(row.querySelector('[data-unfold]')).toBeNull()
    expect(row.querySelector('[title="Move up"]')).toBeNull()
    expect(row.querySelectorAll('button')).toHaveLength(1)
  })

  test('move is on the edit page, drawn at 220 pixels rather than behind a press', () => {
    /* The fold is gone with the page it was on. Nothing on the edit page is
       behind a second press: it is the page whose job the controls are, so
       `room.controls` decides only whether they sit beside the line or under
       it. See the essay on `EditRow`. */
    const sent: unknown[] = []
    const { container } = render(<List held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    toEdit(container)
    const row = container.querySelector('li[data-item="bbb"]') as HTMLElement
    expect(row.querySelector('[data-unfold]')).toBeNull()
    fireEvent.click(row.querySelector('[title="Move up"]') as HTMLElement)
    expect(sent[0]).toEqual({ op: 'move', id: 'list1', item: 'bbb', to: 0 })
  })

  test('the items are the one scroller, and every item is a snap point', () => {
    /* Both halves matter: a snap point on the document scroller would snap the
       name and the target away, which is worse than not snapping at all. */
    const { container } = render(
      <List
        narrowed={NOWHERE}
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

  test('the paragraph explaining a target is gone at every size; the sentence saying nothing can be ticked is not', () => {
    const { container } = render(
      <List
        narrowed={NOWHERE}
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
    /* It used to be here in a `title`, which was the narrow container's answer
       to a paragraph that would not fit. That answer is gone with the paragraph:
       the fact does not depend on the size of this container, so it is on the
       edit page at every size rather than in a tooltip nobody can reach on a
       touch screen. What the press says now is what the press is for. */
    expect((container.querySelector('[data-switch]') as HTMLElement).title).toBe(
      'Held against an issue, merge request or pull request. Press to change it.',
    )
    toEdit(container)
    expect(screen.queryByText(/keeps its own/)).toBeNull() // 220 pixels: `room.prose` is false here too.
    fireEvent.click(container.querySelector('[data-page-to="state"]') as HTMLElement)

    cleanup()
    render(
      <List
        narrowed={NOWHERE}
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
      <List
        narrowed={NOWHERE}
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
      <List
        narrowed={NOWHERE}
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
        onImport={noop}
        importing={false}
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
        onImport={noop}
        importing={false}
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
        <Choose lists={[]} onPick={noop} onCreate={noop} onImport={noop} importing={false} trouble={null} busy={false} said="x" room={TIGHT} />
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
      <List
        narrowed={narrow(inSection, ticked)}
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

  test('says how many ticks the narrowing is hiding, and no longer draws the way out', () => {
    /* The whole of "nothing is hidden without being counted". Without this line a
       reader who ticked eight items against the paper walks into section 3, reads
       0/12, and has no way to tell narrowing from this app losing their work.

       The way OUT is not here any more: it is the grain filter in the container
       header, which the host draws from `offerAt`. The count could not follow it
       — a host cannot add up ticks in a store on another origin — so the split is
       truth here, choice there. */
    render(
      <List
        narrowed={narrow(inSection, ticked)}
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
    expect(screen.queryByText(/Show 3_methods.tex/)).toBe(null)
  })

  test('keeps saying it in the narrowest container there is', () => {
    /* This row never folds away at any size, unlike almost everything else on
       this page. A count that vanished at 220 pixels would be a count nobody
       reads, in the container the owner actually uses. */
    const { container } = render(
      <List
        narrowed={narrow(inSection, ticked)}
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
    expect(container.querySelector('[data-widen]')).toBe(null)
  })

  test('spends no line on a rung that is hiding nothing', () => {
    /* The vertical space this change is FOR. The row used to be drawn on every
       rung below the paper, count or no count, because the widen press had to be
       reachable even when there was nothing to widen back to. The press is in the
       header now, so a rung with nothing hidden behind it says nothing and the
       items get the line. */
    const { container } = render(
      <List
        narrowed={narrow(inSection, [])}
        held={held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' } })}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
        room={ROOMY}
      />,
    )
    expect(container.querySelector('[data-elsewhere]')).toBe(null)
    expect(container.querySelector('[data-widen]')).toBe(null)
  })

  test('draws none of it for a list held against an issue', () => {
    /* The half of this change that had to break nothing. A ref has no document,
       no rung and no ladder, and the row it gets is the row it always had. */
    const { container } = render(
      <List
        narrowed={narrow({ kind: 'elsewhere' }, ticked)}
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

/**
 * The two pages, and the one press between them.
 *
 * Every case here is a pair: something is not on the page it used to be on, AND
 * it is on the other one. A case that only asserted the first would pass just as
 * happily for a feature somebody deleted.
 */
describe('the state page and the edit page', () => {
  test('the state page says where you are, and changes nothing about the list', () => {
    const { container } = render(<List held={held()} room={TIGHT} />)
    expect(container.querySelector('[data-page]')?.getAttribute('data-page')).toBe('state')
    /* What it is FOR: the target row, which answers "what are these ticks
       about". It never folds away at any size. */
    expect(container.querySelector('[data-strip]')).toBeTruthy()
    /* And what it is not for. */
    expect(container.querySelector('#add-item')).toBeNull()
    expect(container.querySelector('[data-another]')).toBeNull()
    expect(container.querySelector('[title="Move up"]')).toBeNull()
  })

  test('the edit page changes the list, and names no target', () => {
    /* The decision this asserts: an edit is a change to the LIST — an item added
       is added for every target it is ever held against, an item removed takes
       every tick on it with it — so drawing a tick or a target beside a line
       somebody is about to reword would suggest the reword is scoped to what is
       on screen. */
    const { container } = render(<List held={held()} room={TIGHT} />)
    toEdit(container)
    expect(container.querySelector('[data-page]')?.getAttribute('data-page')).toBe('edit')
    expect(container.querySelector('#add-item')).toBeTruthy()
    expect(container.querySelector('[title="Move up"]')).toBeTruthy()
    expect(container.querySelector('[data-another]')).toBeTruthy()
    expect(container.querySelector('[data-strip]')).toBeNull()
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
  })

  test('one press moves between them, and it is the only one', () => {
    /* Rejected, and why, in the essay on `ChecklistView`: a filter group in the
       container header (a mode is not a narrowing, and the host remembers a
       filter forever), a tab row (a permanent strip to say what one word says),
       and reusing the row of dots. */
    const { container } = render(<List held={held()} room={TIGHT} />)
    expect(container.querySelectorAll('[data-page-to]')).toHaveLength(1)
    toEdit(container)
    expect(container.querySelector('[data-page-to="state"]')).toBeTruthy()
    fireEvent.click(container.querySelector('[data-page-to="state"]') as HTMLElement)
    expect(container.querySelector('[data-page]')?.getAttribute('data-page')).toBe('state')
  })

  test('the edit page shows every item, because the grain has never hidden one', () => {
    /* Not a safeguard against a filtered edit — that state cannot arise.
       `list/scope.ts`: "Nothing here drops an item: an item belongs to the list
       and is drawn at every rung. What narrowing moves is which TICKS are in
       front of you." So both pages show the same two rows on the narrowest rung
       there is, and this pins that rather than a decision nobody had to make. */
    const inSection = scopeOf('thesis', {
      file: 'chapters/3_methods.tex',
      section: 'chapters:3_methods#sec:meth-design',
      title: 'Research design',
    })
    const { container } = render(
      <List
        held={held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' } })}
        narrowed={narrow(inSection, [{ target: { kind: 'paper', epic: 'thesis', section: null }, done: 8 }])}
        room={TIGHT}
      />,
    )
    expect(container.querySelectorAll('li[data-item]')).toHaveLength(2)
    toEdit(container)
    expect(container.querySelectorAll('li[data-item]')).toHaveLength(2)
  })

  test('pressing a line rewords it, so rewording costs no button of its own', () => {
    const sent: unknown[] = []
    const { container } = render(<List held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    toEdit(container)
    fireEvent.click(container.querySelector('[data-reword="bbb"]') as HTMLElement)
    const box = screen.getByLabelText('Reword this line') as HTMLTextAreaElement
    expect(box.value).toBe('Second')
    fireEvent.change(box, { target: { value: 'Second, sharpened' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sent[0]).toEqual({ op: 'reword', id: 'list1', item: 'bbb', text: 'Second, sharpened' })
  })

  test('escape abandons a reword, and an unchanged one is not sent at all', () => {
    /* A reword to the same words is a press that meant "never mind", and sending
       it would put a write in the log for nothing. */
    const sent: unknown[] = []
    const { container } = render(<List held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    toEdit(container)
    fireEvent.click(container.querySelector('[data-reword="bbb"]') as HTMLElement)
    fireEvent.keyDown(screen.getByLabelText('Reword this line'), { key: 'Escape' })
    expect(sent).toHaveLength(0)

    fireEvent.click(container.querySelector('[data-reword="bbb"]') as HTMLElement)
    fireEvent.keyDown(screen.getByLabelText('Reword this line'), { key: 'Enter' })
    expect(sent).toHaveLength(0)
  })

  test('removing a line still takes two presses, and the first says what the second does', () => {
    const sent: unknown[] = []
    const { container } = render(<List held={held()} onEdit={(e) => sent.push(e)} room={TIGHT} />)
    toEdit(container)
    const row = container.querySelector('li[data-item="bbb"]') as HTMLElement
    fireEvent.click(row.querySelector('[title="Take this off the list"]') as HTMLElement)
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/along with every tick on it against every target/)).toBeTruthy()
    fireEvent.click(row.querySelector('[title="Press again to take this off the list"]') as HTMLElement)
    expect(sent[0]).toEqual({ op: 'drop', id: 'list1', item: 'bbb' })
  })
})

/**
 * What the picker offers for a paper, which is the answer to "you can only type
 * something there".
 *
 * The scan itself is `test/outline.test.ts`, against real files on disk. These
 * are about what the screen does with the answer — and, in the last two cases,
 * what it does with no answer at all, which is the case that must not become a
 * dead end.
 */
describe('the target picker', () => {
  const inFile = scopeOf('thesis', { file: 'chapters/3_methods.tex', section: null, title: null })

  const outline: Outline = {
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

  const paper = (over: Partial<ComponentProps<typeof ChecklistView>> = {}) =>
    render(
      <List
        held={held({ target: { kind: 'paper', epic: 'thesis', section: null } })}
        narrowed={narrow(inFile, [])}
        room={ROOMY}
        {...over}
      />,
    )

  test('asks for the outline when the picker opens, and never before', () => {
    /* The whole reason this is a door of its own: it opens every file of a
       paper, and `/api/checklist` runs on every context — one of which arrives
       after every selection change anywhere on the canvas. */
    let asked = 0
    paper({ onOutline: () => (asked += 1) })
    expect(asked).toBe(0)
    fireEvent.click(screen.getByText('change'))
    expect(asked).toBe(1)
  })

  test('offers the paper’s files and the headings inside them', () => {
    const picked: unknown[] = []
    const { container } = paper({ outline, onTarget: (t) => picked.push(t) })
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelector('[data-pick-file="main"]')).toBeTruthy()
    expect(container.querySelector('[data-pick-file="chapters:3_methods"]')).toBeTruthy()
    fireEvent.click(container.querySelector('[data-pick-section="chapters:3_methods#sec:meth-design"]') as HTMLElement)
    expect(picked[0]).toEqual({ kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' })
  })

  test('a file is a target of its own, not merely a thing that expands', () => {
    /* `chapters/3_methods.tex` is the middle rung of the ladder in
       `list/scope.ts`, so a row whose only behaviour was to expand would make
       the file rung unreachable from the one screen that lists the files. */
    const picked: unknown[] = []
    const { container } = paper({ outline, onTarget: (t) => picked.push(t) })
    fireEvent.click(screen.getByText('change'))
    fireEvent.click(container.querySelector('[data-pick-file="chapters:3_methods"]') as HTMLElement)
    expect(picked[0]).toEqual({ kind: 'paper', epic: 'thesis', section: 'chapters:3_methods' })
  })

  test('the file the reader is standing in has its headings already open', () => {
    /* Not "the first file", which would be this program choosing. Where the
       reader IS is a fact, and `narrowed.scope` already knows it. */
    const { container } = paper({ outline })
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelector('[data-open-file="open"]')).toBeTruthy()
    expect(screen.getByText('Research design')).toBeTruthy()
    /* And `main.tex`, which has no headings, has no chevron at all rather than
       one that opens onto nothing. */
    expect(container.querySelectorAll('[data-open-file]')).toHaveLength(1)
  })

  test('typing is still possible when the scan found nothing, and says so in one line', () => {
    /* The freedom the list is a convenience over. A file nobody has written yet,
       a target that is not a document — neither may be blocked by a picker. */
    const picked: unknown[] = []
    const { container } = paper({ outline: null, onTarget: (t) => picked.push(t) })
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelector('[data-paper="none"]')).toBeTruthy()
    const box = container.querySelector('[data-type-target]') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'gh#900' } })
    fireEvent.click(screen.getByText('Hold'))
    expect(picked[0]).toEqual({ kind: 'ref', ref: 'gh#900' })
  })

  test('a section picked from the list is named by its words, not by its slug', () => {
    /* The wart the probe found. `scopeOfTarget` prints the id for a section the
       reader is not standing in, and before the picker existed that was almost
       always a widened target or an agent's. Pressing "Research design" from a
       list makes it the ordinary case, and the row came back reading
       `sec:meth-design` — the reader's own `\label` read back at them instead of
       the words they had just pressed. The words come from the same outline the
       button was drawn from, so the two cannot disagree. */
    const held3 = held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' } })
    const { container } = render(
      <List held={held3} narrowed={narrow(scopeOfTarget(held3.target, null), [])} outline={outline} room={ROOMY} />,
    )
    /* `placed` is null here on purpose: that IS the case, a reader whose passage
       is somewhere other than the section they picked. Without the outline this
       row reads `sec:meth-design`. */
    expect((container.querySelector('[data-target]') as HTMLElement).textContent).toBe('Research design')
  })

  test('an id the outline does not know falls back to the honest id', () => {
    /* Never invented. A target from another paper, or one whose heading has been
       renamed since, is printed as what it is. */
    const held3 = held({ target: { kind: 'paper', epic: 'thesis', section: 'chapters:9_gone#sec:vanished' } })
    const { container } = render(
      <List held={held3} narrowed={narrow(scopeOfTarget(held3.target, null), [])} outline={outline} room={ROOMY} />,
    )
    expect((container.querySelector('[data-target]') as HTMLElement).textContent).toBe('sec:vanished')
  })

  test('an issue’s picker is exactly what it always was: no files, and a box', () => {
    /* The half of this change that had to break nothing. A ref has no chapters
       and never will. */
    const { container } = render(<List held={held()} outline={outline} room={ROOMY} />)
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelector('[data-paper]')).toBeNull()
    expect(container.querySelector('[data-pick-file]')).toBeNull()
    expect(container.querySelector('[data-type-target]')).toBeTruthy()
  })
})

/**
 * The screen for "you are standing somewhere this list is not held against".
 *
 * The state the old model could not express, and the owner's report:
 *
 * > "held against doesnt really seem to translate to 'show and expect to be
 * > filled for x' … the checklist even if its pointed at some other section does
 * > not 'disappear' from sight until you scroll to that tex file, instead it
 * > stays there and if you scroll around it changes manually to another one."
 *
 * WHICH pairing is in front is decided by `holdingAt`, and its table is
 * `test/holding.test.ts`. What is asserted here is the other half: that the
 * container says the true sentence, that nothing is tickable while it is saying
 * it, and that the one press out of it names the same rung the row is printing.
 */
describe('a list that is not held against what the reader is reading', () => {
  /* The rung the reader is standing on, which the page fetched in order to learn
     where they are. It arrives as `held.target` and is NOT this list's target,
     which is the whole distinction `standing` carries. */
  const section: Target = { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods#sec:meth-design' }
  const placed = { file: 'chapters/3_methods.tex', section: 'chapters:3_methods#sec:meth-design', title: 'Research design' }
  const unticked = () => held({ target: section, done: 0, rows: held().rows.map((r) => ({ ...r, done: null })) })
  const away = (where: Room, targets: { target: Target; done: number }[] = []) => (
    <List
      standing="unheld"
      held={unticked()}
      narrowed={narrow(scopeOfTarget(section, placed), targets)}
      targets={targets}
      room={where}
    />
  )

  test('says so, names where the reader is, and calls it Reading rather than Held against', () => {
    const { container } = render(away(ROOMY))
    expect(container.querySelector('[data-unheld]')).toBeTruthy()
    expect(screen.getByText('Reading')).toBeTruthy()
    expect(screen.queryByText('Held against')).toBeNull()
    const row = container.querySelector('[data-target]') as HTMLElement
    expect(row.textContent).toBe('Research design')
    expect(row.getAttribute('data-standing')).toBe('unheld')
  })

  test('nothing below can be ticked, because a tick here would make a pairing nobody meant', () => {
    /* The load-bearing assertion. Under the old model this row was a tick
       control against whatever the reader had scrolled to, and the pairing it
       created was indistinguishable from one somebody had chosen. */
    const { container } = render(away(ROOMY))
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
    /* And the items are all still drawn: the list is the list wherever you
       stand, and hiding it would lose the work as well as the claim. */
    expect(container.querySelectorAll('li[data-item]')).toHaveLength(2)
    expect(screen.getByText('Second')).toBeTruthy()
  })

  test('one press holds it here, and hands back the rung the row just printed', () => {
    const sent: (Target | null)[] = []
    const { container } = render(
      <List
        standing="unheld"
        held={unticked()}
        narrowed={narrow(scopeOfTarget(section, placed), [])}
        onTarget={(t) => sent.push(t)}
        room={ROOMY}
      />,
    )
    fireEvent.click(container.querySelector('[data-hold]') as HTMLElement)
    expect(sent).toEqual([section])
  })

  test('says how many other things it IS held against, so the work is not invisible', () => {
    const targets: { target: Target; done: number }[] = [
      { target: { kind: 'ref', ref: 'gh#105' }, done: 3 },
      { target: { kind: 'paper', epic: 'thesis', section: 'chapters:2_literature_review' }, done: 1 },
    ]
    render(away(ROOMY, targets))
    expect(screen.getByText(/held against 2 other things/)).toBeTruthy()
  })

  test('and says the other sentence when there is nothing anywhere, which is a different situation', () => {
    /* "You have walked away from the work" and "nobody has ever ticked anything
       on this list" send a reader to two different places. */
    render(away(ROOMY))
    expect(screen.getByText(/Nothing has been ticked on this checklist against anything yet/)).toBeTruthy()
  })

  test('does not also print what the narrowing is hiding, which is a count about a target', () => {
    /* "N ticked elsewhere in this paper" answers "what is my narrowing hiding",
       and there is no narrowing here — there are no ticks in front at all. The
       line above it already says how many pairings exist and that none of them
       is here, which is the sharper sentence and the same absence. */
    const targets: { target: Target; done: number }[] = [
      { target: { kind: 'paper', epic: 'thesis', section: 'chapters:2_literature_review' }, done: 4 },
    ]
    const { container } = render(away(ROOMY, targets))
    expect(container.querySelector('[data-elsewhere]')).toBeNull()
    expect(screen.getByText(/held against 1 other thing/)).toBeTruthy()
  })

  test('neither the sentence nor the press folds away at 220 pixels', () => {
    /* The rule every sentence on this page is held to: prose folds, but the only
       thing on screen explaining why every row is inert never does — and neither
       does the way out of it. Both are shorter here, not absent. */
    const { container } = render(away(TIGHT))
    expect(container.querySelector('[data-unheld]')).toBeTruthy()
    expect(container.querySelector('[data-hold]')).toBeTruthy()
    expect(screen.getByText(/Not held against anything yet/)).toBeTruthy()
  })

  test('a list that IS held here draws none of it, and is tickable', () => {
    const { container } = render(
      <List
        standing="held"
        held={held({ target: section })}
        narrowed={narrow(scopeOfTarget(section, placed), [])}
        room={ROOMY}
      />,
    )
    expect(container.querySelector('[data-unheld]')).toBeNull()
    expect(container.querySelector('[data-hold]')).toBeNull()
    expect(screen.getByText('Held against')).toBeTruthy()
    expect(container.querySelector('button[aria-pressed]')).toBeTruthy()
  })
})

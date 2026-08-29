import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { Held } from '../list/checklists.ts'
import { ChecklistView } from '../src/view/checklist.tsx'
import { Choose, Unplaced } from '../src/view/choose.tsx'

/**
 * The components, rendered for real.
 *
 * Half the value of these is that the words on screen are the thing being
 * asserted: a refusal that names what to do instead is worth nothing if the row
 * it belongs to never draws it, and a two-press arm that never says what the
 * second press does is a dialog with the sentence removed.
 */
afterEach(cleanup)

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
        busy={false}
        said="Nothing has been picked for Roadmap yet."
      />,
    )
    expect(screen.getByText(/Nothing has been picked for Roadmap yet/)).toBeTruthy()
  })

  test('says an empty store is not a gap this app can fill, because nothing ships a list', () => {
    render(<Choose lists={[]} onPick={noop} onCreate={noop} trouble={null} busy={false} said="x" />)
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
        busy={false}
        said="x"
      />,
    )
    fireEvent.click(screen.getByText('What a change owes'))
    expect(picked).toBe('one')
  })

  test('draws a long name as wrapped prose, never in a nowrap badge', () => {
    /* The trap: shadcn's `Badge` carries `whitespace-nowrap`, and a long string in
       one sets a min-content floor far wider than a 220px pane. A sibling module
       shipped exactly that. */
    render(
      <Choose
        lists={[{ id: 'two', name: LONG, at: '', by: 'a test', items: 1, targets: 0 }]}
        onPick={noop}
        onCreate={noop}
        trouble={null}
        busy={false}
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
        busy={false}
        said="x"
      />,
    )
    expect(screen.getByText(/there is already a checklist called/)).toBeTruthy()
  })
})

describe('the checklist', () => {
  test('says which target it is held against, and that ticks belong to the pair', () => {
    render(
      <ChecklistView held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} />,
    )
    expect(screen.getByText('gh#105')).toBeTruthy()
    expect(screen.getByText(/keeps its own/)).toBeTruthy()
  })

  test('prints who ticked an item and that it came through the MCP door', () => {
    /* Never a bare checkmark. An agent's claim has to be legible as one. */
    render(
      <ChecklistView held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} />,
    )
    expect(screen.getByText('ticked by claude, over MCP')).toBeTruthy()
  })

  test('draws a 400-character item as wrapped prose in a min-w-0 column', () => {
    render(
      <ChecklistView held={held()} targets={[]} candidates={[]} onTarget={noop} onEdit={noop} onAnother={noop} trouble={null} busy={false} />,
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
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={(e) => sent.push(e)}
        onAnother={noop}
        trouble={null}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByText(LONG))
    expect(sent[0]).toEqual({ op: 'tick', id: 'list1', item: 'aaa', target: { kind: 'ref', ref: 'gh#105' }, done: true })
  })

  test('with no target the rows are text rather than controls, and the row above says why', () => {
    const { container } = render(
      <ChecklistView
        held={held({ target: null, done: 0, rows: held().rows.map((r) => ({ ...r, done: null })) })}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
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
        held={held()}
        targets={[]}
        candidates={[]}
        onTarget={noop}
        onEdit={(e) => sent.push(e)}
        onAnother={noop}
        trouble={null}
        busy={false}
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
        held={held()}
        targets={[{ target: { kind: 'paper', epic: 'modes', section: null }, done: 2 }]}
        candidates={[{ kind: 'ref', ref: 'gh#105' }]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelector('[data-pick-target="ref:gh#105"]')).toBeTruthy()
    expect(container.querySelector('[data-pick-target="paper:modes"]')).toBeTruthy()
  })

  test('a target proposed by the canvas and already ticked against is drawn once, not twice', () => {
    const { container } = render(
      <ChecklistView
        held={held()}
        targets={[{ target: { kind: 'ref', ref: 'gh#105' }, done: 1 }]}
        candidates={[{ kind: 'ref', ref: 'gh#105' }]}
        onTarget={noop}
        onEdit={noop}
        onAnother={noop}
        trouble={null}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByText('change'))
    expect(container.querySelectorAll('[data-pick-target="ref:gh#105"]')).toHaveLength(1)
  })
})

describe('a pane that cannot tell which kehikko it is on', () => {
  test('says so, and works anyway for the session', () => {
    render(
      <Unplaced>
        <Choose lists={[]} onPick={noop} onCreate={noop} trouble={null} busy={false} said="x" />
      </Unplaced>,
    )
    expect(screen.getByText(/cannot tell which kehikko it is on/)).toBeTruthy()
    expect(screen.getByText(/holds until this page is reloaded/)).toBeTruthy()
    /* And the pick screen is still there. Refusing to work would make a usable
       checklist unreachable because of a field a host declined to fill in. */
    expect(screen.getByText('Pick a checklist')).toBeTruthy()
  })
})

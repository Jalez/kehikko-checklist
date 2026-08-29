import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { Paper } from '../list/papers.ts'
import { NoPaper, PaperList } from '../src/view/paper-list.tsx'

/**
 * What the hand-written list says, rendered.
 *
 * Sentences rather than structure, for the reason `render.test.tsx` gives — and
 * one structural assertion, because it is the one that cost a sibling module a
 * day: an item's text must never be inside anything that cannot wrap. shadcn's
 * `Badge` carries `whitespace-nowrap` in its base, and a 400-character string in
 * one sets a min-content floor over a thousand pixels wide under a pane that is
 * 220. happy-dom has no layout engine and cannot measure the overflow, but it can
 * answer the question that causes it: is the text in a nowrap box.
 */
afterEach(cleanup)

const paper = (items: Paper['items']): Paper => ({
  epic: 'modes-are-modules',
  items,
  done: items.filter((i) => i.done).length,
  total: items.length,
  trouble: null,
})

const item = (over: Partial<Paper['items'][number]> = {}): Paper['items'][number] => ({
  id: 'aabbccdd',
  text: 'The wire chapter still says the bridge is synchronous',
  at: '2026-01-01T00:00:00.000Z',
  by: 'the owner, on this app’s own page',
  done: null,
  ...over,
})

const inert = { onEdit: () => {}, trouble: null, busy: false }

describe('a paper with a list', () => {
  test('draws the item whole, and never inside anything that cannot wrap', () => {
    const long = 'x'.repeat(400)
    const { container } = render(<PaperList paper={paper([item({ text: long })])} {...inert} />)
    const said = [...container.querySelectorAll('span')].find((node) => node.textContent === long)
    expect(said).toBeTruthy()
    /* The trap, asserted rather than remembered. `break-words` is what keeps an
       unbroken 400-character string inside a 220px pane; `whitespace-nowrap` is
       what stops it, and it is one careless `Badge` away at all times. */
    expect(said?.className).toContain('break-words')
    expect(said?.className).not.toContain('whitespace-nowrap')
  })

  test('says who ticked it and whether it came through the MCP door', () => {
    render(
      <PaperList
        paper={paper([item({ done: { at: '2026-01-02T00:00:00.000Z', by: 'claude', viaMcp: true } })])}
        {...inert}
      />,
    )
    /* An agent may tick these, and the whole of what makes that safe is that
       the row says so. A bare checkmark would be an agent's claim wearing the
       owner's clothes. */
    expect(screen.getByText('ticked by claude, over MCP')).toBeTruthy()
  })

  test('an empty list says nobody has written anything, not that something failed', () => {
    render(<PaperList paper={paper([])} {...inert} />)
    expect(screen.getByText(/Nothing is written down against this paper yet/)).toBeTruthy()
  })

  test('removing takes two presses, because there is no modal to ask in', () => {
    /* The host frames this module without `allow-modals`, so `window.confirm`
       is ignored and returns false — a button that does nothing with nothing on
       screen saying why. The second press is asked for in the row instead. See
       the essay in `row.tsx`, where this was measured. */
    const asked: unknown[] = []
    render(<PaperList paper={paper([item()])} {...inert} onEdit={(edit) => asked.push(edit)} />)
    const remove = screen.getByTitle('Take this off the list')
    fireEvent.click(remove)
    expect(asked).toEqual([])
    expect(screen.getByText(/Press × again to take this off the list for good/)).toBeTruthy()
    fireEvent.click(screen.getByTitle('Press again to take this off the list'))
    expect(asked).toEqual([{ op: 'drop', id: 'aabbccdd' }])
  })

  test('the first item cannot be moved up and the last cannot be moved down', () => {
    render(<PaperList paper={paper([item({ id: 'a' }), item({ id: 'b' })])} {...inert} />)
    const up = screen.getAllByTitle('Move up')
    const down = screen.getAllByTitle('Move down')
    expect((up[0] as HTMLButtonElement).disabled).toBe(true)
    expect((up[1] as HTMLButtonElement).disabled).toBe(false)
    expect((down[1] as HTMLButtonElement).disabled).toBe(true)
  })

  test('a store that cannot be read is said on the card, not drawn as an empty list', () => {
    render(<PaperList paper={{ ...paper([]), trouble: 'papers.json could not be read (…)' }} {...inert} />)
    expect(screen.getByText(/could not be read/)).toBeTruthy()
  })
})

describe('no paper', () => {
  test('says which of the three absences it is, rather than drawing an empty list', () => {
    /* `context.epic` is nullable and there are three ways to arrive here. None
       of them is "this paper has no items", and drawing that for any of them
       would be the same fault as `unasked` drawn as `unknown` on the other
       list. */
    const { rerender } = render(<NoPaper where="unhosted" written={[]} onPick={() => {}} />)
    expect(screen.getByText(/Nothing is framing this page/)).toBeTruthy()
    rerender(<NoPaper where="no-epic" written={[]} onPick={() => {}} />)
    expect(screen.getByText(/the canvas is on no epic/)).toBeTruthy()
    rerender(<NoPaper where="listening" written={[]} onPick={() => {}} />)
    expect(screen.getByText(/Waiting to hear/)).toBeTruthy()
  })

  test('offers the papers something has already been written against', () => {
    const picked: string[] = []
    render(
      <NoPaper
        where="unhosted"
        written={[{ epic: 'modes-are-modules', done: 1, total: 3 }]}
        onPick={(epic) => picked.push(epic)}
      />,
    )
    fireEvent.click(screen.getByText('modes-are-modules'))
    expect(picked).toEqual(['modes-are-modules'])
  })

  test('with nothing written anywhere it says so, and says what would start one', () => {
    render(<NoPaper where="no-epic" written={[]} onPick={() => {}} />)
    expect(screen.getByText(/Nothing has been written down against any paper yet/)).toBeTruthy()
  })
})

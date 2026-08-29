import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The paper half of the MCP door, and the page door beside it.
 *
 * What is tested here is the ARGUMENTS: every one of these five tools can be
 * called with something that is not what it asked for, by an agent that read a
 * cached description, and the difference between a good door and a bad one is
 * whether it refuses in a sentence or quietly does the wrong thing. A tool that
 * moved an item to the top because `position` was the string "up" would be worse
 * than one that failed.
 *
 * The refusals are asserted by their words rather than by a flag, because the
 * words are what an agent acts on — every one of them names what was wrong and
 * what to do instead.
 */
let dir = ''
const query = new URLSearchParams()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-paper-door-'))
  process.env.CHECKLIST_DATA = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHECKLIST_DATA
})

interface Content {
  result: { content: { text: string }[]; isError?: boolean }
}

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; failed: boolean }> {
  const { answer } = await import('../doors.ts')
  const reply = answer(
    'POST',
    '/mcp',
    query,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    null,
  )
  const body = reply?.body as Content
  return { text: body.result.content[0]?.text ?? '', failed: body.result.isError === true }
}

/** Add one item and hand back its id, which is how everything else addresses it. */
async function seed(epic: string, text: string): Promise<string> {
  const out = await call('add_paper_item', { epic, text, agent: 'claude' })
  const id = /as ([0-9a-f]{8})/.exec(out.text)?.[1]
  if (!id) throw new Error(`no id in: ${out.text}`)
  return id
}

describe('paper_checklist', () => {
  test('with no epic it lists the papers that have one, and says so when none do', async () => {
    const empty = await call('paper_checklist', {})
    expect(empty.text).toContain('No paper has a hand-written checklist yet')
    await seed('modes-are-modules', 'The wire chapter still says synchronous')
    const written = await call('paper_checklist', {})
    expect(written.text).toContain('modes-are-modules — 0/1 ticked')
  })

  test('an epic that is not a name is refused rather than answered with the directory', async () => {
    /* A caller that meant to ask about one paper and got a listing would read
       it as "there is nothing on mine". */
    const out = await call('paper_checklist', { epic: 'not an epic' })
    expect(out.failed).toBe(true)
    expect(out.text).toContain('not an epic slug')
  })

  test('a paper with nothing on it says nothing is wrong, and names what starts one', async () => {
    const out = await call('paper_checklist', { epic: 'quiet-epic' })
    expect(out.failed).toBe(false)
    expect(out.text).toContain('has no hand-written checklist yet')
    expect(out.text).toContain('add_paper_item')
  })

  test('the list prints the id, the position and who ticked what', async () => {
    const id = await seed('e', 'A line')
    await call('check_paper_item', { epic: 'e', id, agent: 'claude', note: 'done in §2' })
    const out = await call('paper_checklist', { epic: 'e' })
    expect(out.text).toContain(`1. [x] ${id} — A line`)
    expect(out.text).toContain('claude, over MCP: done in §2')
  })
})

describe('add_paper_item', () => {
  test('needs an epic, and says which name it means', async () => {
    const out = await call('add_paper_item', { text: 'A line' })
    expect(out.failed).toBe(true)
    expect(out.text).toContain('needs the slug of the epic')
  })

  test('needs text, and says what the text is for', async () => {
    const out = await call('add_paper_item', { epic: 'e' })
    expect(out.failed).toBe(true)
    expect(out.text).toContain('needs text')
  })

  test('files the agent’s own name when it gives one', async () => {
    await call('add_paper_item', { epic: 'e', text: 'A line', agent: 'claude' })
    const { paper } = await import('../list/papers.ts')
    expect(paper('e').items[0]?.by).toBe('claude')
  })

  test('answers with the id and then the whole list, so the next call needs no second read', async () => {
    const out = await call('add_paper_item', { epic: 'e', text: 'A line', agent: 'claude' })
    expect(out.failed).toBe(false)
    expect(out.text).toMatch(/as [0-9a-f]{8}/)
    expect(out.text).toContain('e — hand-written, 0/1 ticked')
  })
})

describe('check_paper_item', () => {
  test('an agent MAY tick one, unlike the owner’s item on a change', async () => {
    /* The rule the manifest states — never tick on the owner's behalf — is
       about `agreed`, which asks whether a PERSON has agreed. A hand-written
       paper item is a task, and the agent is often the one who did it. What
       makes that safe is the record saying who, which the store test asserts. */
    const id = await seed('e', 'A line')
    const out = await call('check_paper_item', { epic: 'e', id, agent: 'claude' })
    expect(out.failed).toBe(false)
    expect(out.text).toContain('is ticked, by claude')
  })

  test('done: false takes a tick back', async () => {
    const id = await seed('e', 'A line')
    await call('check_paper_item', { epic: 'e', id, agent: 'claude' })
    const out = await call('check_paper_item', { epic: 'e', id, agent: 'claude', done: false })
    expect(out.text).toContain('no longer ticked')
  })

  test('needs an id, and says an id is not the words and not the position', async () => {
    await seed('e', 'A line')
    const out = await call('check_paper_item', { epic: 'e' })
    expect(out.failed).toBe(true)
    expect(out.text).toContain('needs the id of the item')
    expect(out.text).toContain('both of those move')
  })

  test('an id that is not on the list is refused by name', async () => {
    await seed('e', 'A line')
    const out = await call('check_paper_item', { epic: 'e', id: 'deadbeef' })
    expect(out.failed).toBe(true)
    expect(out.text).toContain('there is no item "deadbeef"')
  })
})

describe('reword_paper_item', () => {
  test('keeps the id and the tick, and changes only the words', async () => {
    const id = await seed('e', 'vauge')
    await call('check_paper_item', { epic: 'e', id, agent: 'claude' })
    const out = await call('reword_paper_item', { epic: 'e', id, text: 'The wire chapter still says synchronous' })
    expect(out.failed).toBe(false)
    const { paper } = await import('../list/papers.ts')
    const item = paper('e').items[0]!
    expect(item.id).toBe(id)
    expect(item.text).toBe('The wire chapter still says synchronous')
    expect(item.done?.by).toBe('claude')
  })

  test('empty text is refused, and points at the tool that does mean “take it off”', async () => {
    const id = await seed('e', 'A line')
    const out = await call('reword_paper_item', { epic: 'e', id, text: '  ' })
    expect(out.failed).toBe(true)
    expect(out.text).toContain('drop_paper_item')
  })
})

describe('move_paper_item', () => {
  test('positions count from 1, as the list prints them', async () => {
    await seed('e', 'a')
    await seed('e', 'b')
    const c = await seed('e', 'c')
    const out = await call('move_paper_item', { epic: 'e', id: c, position: 1 })
    expect(out.failed).toBe(false)
    const { paper } = await import('../list/papers.ts')
    expect(paper('e').items.map((i) => i.text)).toEqual(['c', 'a', 'b'])
  })

  test('a position that is not a number is refused rather than read as the top', async () => {
    /* The failure this prevents is the quiet one: defaulting a bad `position`
       to 1 would silently reorder somebody's list, and the agent would be told
       it worked. */
    const id = await seed('e', 'a')
    await seed('e', 'b')
    const out = await call('move_paper_item', { epic: 'e', id, position: 'up' })
    expect(out.failed).toBe(true)
    expect(out.text).toContain('needs position')
    expect(out.text).toContain('Nothing was moved')
    const { paper } = await import('../list/papers.ts')
    expect(paper('e').items.map((i) => i.text)).toEqual(['a', 'b'])
  })

  test('past the end means the end, because that is a clear intention', async () => {
    const id = await seed('e', 'a')
    await seed('e', 'b')
    const out = await call('move_paper_item', { epic: 'e', id, position: 99 })
    expect(out.failed).toBe(false)
    const { paper } = await import('../list/papers.ts')
    expect(paper('e').items.map((i) => i.text)).toEqual(['b', 'a'])
  })
})

describe('drop_paper_item', () => {
  test('takes it off, and the list that comes back no longer has it', async () => {
    const id = await seed('e', 'A line')
    const out = await call('drop_paper_item', { epic: 'e', id })
    expect(out.failed).toBe(false)
    expect(out.text).toContain("is off e's checklist")
    const { paper } = await import('../list/papers.ts')
    expect(paper('e').items).toEqual([])
  })

  test('needs an id, and refuses without touching anything', async () => {
    await seed('e', 'A line')
    const out = await call('drop_paper_item', { epic: 'e' })
    expect(out.failed).toBe(true)
    const { paper } = await import('../list/papers.ts')
    expect(paper('e').items).toHaveLength(1)
  })
})

describe('the announcement every call makes', () => {
  test('a paper call names its own epic, so it is not filed under whatever the canvas shows', async () => {
    const { forgetEverything, since } = await import('../list/outbox.ts')
    forgetEverything()
    await call('add_paper_item', { epic: 'modes-are-modules', text: 'A line' })
    const [announcement] = since(0).announcements
    /* The epic on the announcement is the tool's own, because the tool has one.
       The page's fallback — the epic the canvas is on — would file an agent's
       work on one paper under whichever paper somebody happened to be reading. */
    expect(announcement?.epic).toBe('modes-are-modules')
    expect(announcement?.message).toContain("modes-are-modules's paper checklist")
  })

  test('a refused call is announced too, because an agent came through the door either way', async () => {
    const { forgetEverything, since } = await import('../list/outbox.ts')
    forgetEverything()
    await call('move_paper_item', { epic: 'e', id: 'deadbeef', position: 'up' })
    expect(since(0).announcements).toHaveLength(1)
  })

  test('a change call still names no epic of its own, and leaves it to the page', async () => {
    const { forgetEverything, since } = await import('../list/outbox.ts')
    forgetEverything()
    await call('mr_checklist', { ref: '!1848' })
    expect(since(0).announcements[0]?.epic).toBeNull()
  })
})

describe('the page’s own door', () => {
  test('reads are ungated, because a checklist is not a secret', async () => {
    const { answer } = await import('../doors.ts')
    await seed('e', 'A line')
    const reply = answer('GET', '/api/paper', new URLSearchParams('epic=e'), null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { paper: { total: number } }).paper.total).toBe(1)
  })

  test('a read with no epic is refused with the sentence, not with an empty list', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('GET', '/api/paper', new URLSearchParams('epic=not an epic'), null, null)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('needs an epic slug')
  })

  test('a write is refused without the ticket this process handed out with the page', async () => {
    const { answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/paper', query, { epic: 'e', op: 'add', text: 'A line' }, 'not-the-ticket')
    expect(reply?.status).toBe(403)
  })

  test('with the ticket, the owner writes their own list and it comes back whole', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/paper', query, { epic: 'e', op: 'add', text: 'A line' }, TICKET)
    const body = reply?.body as { ok: boolean; paper: { items: { by: string }[] } }
    expect(body.ok).toBe(true)
    /* The page files the owner, in the same words the tick door uses, so a
       reader can tell their own line from an agent's at a glance. */
    expect(body.paper.items[0]?.by).toContain('the owner')
  })

  test('an op the door does not know is named rather than shrugged at', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const reply = answer('POST', '/api/paper', query, { epic: 'e', op: 'sort', id: 'x' }, TICKET)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('there is no "sort"')
  })

  test('a move with no position is refused, and nothing is moved', async () => {
    const { TICKET, answer } = await import('../doors.ts')
    const id = await seed('e', 'a')
    await seed('e', 'b')
    const reply = answer('POST', '/api/paper', query, { epic: 'e', op: 'move', id }, TICKET)
    expect(reply?.status).toBe(400)
    const { paper } = await import('../list/papers.ts')
    expect(paper('e').items.map((i) => i.text)).toEqual(['a', 'b'])
  })
})

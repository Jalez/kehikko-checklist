import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The hand-written store, and the two things it is not allowed to do.
 *
 * It must not lose an item to a schema that grew a field — which is what the
 * additive rule is for, and what the first `describe` writes an OLD file to
 * prove — and it must not answer "there is nothing written down" when the truth
 * is "this file could not be read". The second is the one that would be
 * invisible: there is no shipped paper list to fall back to, so an empty answer
 * and a broken file look identical to whoever is reading the pane.
 *
 * `CHECKLIST_DATA` is set per test and the module imported fresh, because
 * `dataDir()` resolves the variable at call time.
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-papers-'))
  process.env.CHECKLIST_DATA = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHECKLIST_DATA
})

const file = () => join(dir, 'papers.json')

describe('the store', () => {
  test('an item written down is read back, with who wrote it and nothing ticked', async () => {
    const { paper, setPaper } = await import('../list/papers.ts')
    const out = setPaper({ op: 'add', epic: 'modes-are-modules', text: 'The bridge chapter is still hand-wavy', by: 'the owner' })
    expect(out.ok).toBe(true)
    const p = paper('modes-are-modules')
    expect(p.items).toHaveLength(1)
    expect(p.items[0]?.text).toBe('The bridge chapter is still hand-wavy')
    expect(p.items[0]?.by).toBe('the owner')
    expect(p.items[0]?.done).toBeNull()
    expect(p.total).toBe(1)
    expect(p.done).toBe(0)
  })

  test('a tick says who made it and whether it came through the MCP door', async () => {
    const { paper, setPaper } = await import('../list/papers.ts')
    const added = setPaper({ op: 'add', epic: 'e', text: 'a line', by: 'the owner' })
    if (!added.ok) throw new Error(added.error)
    const id = added.paper.items[0]!.id
    setPaper({ op: 'tick', epic: 'e', id, done: true, by: 'claude', viaMcp: true, note: 'rewrote §3' })
    const item = paper('e').items[0]!
    /* An agent MAY tick a hand-written item — see the essay in `papers.ts` —
       and the whole of what makes that safe is that the record says so. A tick
       that did not name its author would be an agent's claim wearing the
       owner's clothes. */
    expect(item.done?.by).toBe('claude')
    expect(item.done?.viaMcp).toBe(true)
    expect(item.done?.note).toBe('rewrote §3')
    expect(paper('e').done).toBe(1)
  })

  test('a tick taken back leaves the item and loses only the tick', async () => {
    const { paper, setPaper } = await import('../list/papers.ts')
    const added = setPaper({ op: 'add', epic: 'e', text: 'a line', by: 'the owner' })
    if (!added.ok) throw new Error(added.error)
    const id = added.paper.items[0]!.id
    setPaper({ op: 'tick', epic: 'e', id, done: true, by: 'claude', viaMcp: true })
    setPaper({ op: 'tick', epic: 'e', id, done: false, by: 'the owner' })
    expect(paper('e').items[0]?.done).toBeNull()
    expect(paper('e').items).toHaveLength(1)
  })

  test('the order somebody chose is the order it is read back in, and moving rewrites it', async () => {
    const { paper, setPaper } = await import('../list/papers.ts')
    for (const text of ['first', 'second', 'third']) setPaper({ op: 'add', epic: 'e', text, by: 'the owner' })
    expect(paper('e').items.map((i) => i.text)).toEqual(['first', 'second', 'third'])
    const third = paper('e').items[2]!.id
    setPaper({ op: 'move', epic: 'e', id: third, to: 0, by: 'the owner' })
    expect(paper('e').items.map((i) => i.text)).toEqual(['third', 'first', 'second'])
  })

  test('the order survives being read from disk by a fresh reader', async () => {
    const { setPaper } = await import('../list/papers.ts')
    for (const text of ['a', 'b', 'c']) setPaper({ op: 'add', epic: 'e', text, by: 'the owner' })
    const id = JSON.parse(readFileSync(file(), 'utf8')).papers.e.items[2].id
    setPaper({ op: 'move', epic: 'e', id, to: 0, by: 'the owner' })
    /* Read off the bytes rather than through the module that just wrote them:
       a reorder that lived only in memory would pass every other test here. */
    const onDisk = JSON.parse(readFileSync(file(), 'utf8')) as { papers: { e: { items: { text: string }[] } } }
    expect(onDisk.papers.e.items.map((i) => i.text)).toEqual(['c', 'a', 'b'])
  })

  test('a position past the end means the end, because that is what somebody meant', async () => {
    const { paper, setPaper } = await import('../list/papers.ts')
    for (const text of ['a', 'b', 'c']) setPaper({ op: 'add', epic: 'e', text, by: 'the owner' })
    const first = paper('e').items[0]!.id
    setPaper({ op: 'move', epic: 'e', id: first, to: 99, by: 'the owner' })
    expect(paper('e').items.map((i) => i.text)).toEqual(['b', 'c', 'a'])
  })

  test('dropping takes the item and its tick, and says so', async () => {
    const { paper, setPaper } = await import('../list/papers.ts')
    const added = setPaper({ op: 'add', epic: 'e', text: 'a line', by: 'the owner' })
    if (!added.ok) throw new Error(added.error)
    const id = added.paper.items[0]!.id
    setPaper({ op: 'tick', epic: 'e', id, done: true, by: 'claude', viaMcp: true })
    const out = setPaper({ op: 'drop', epic: 'e', id, by: 'the owner' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.said).toContain('along with the tick')
    expect(paper('e').items).toHaveLength(0)
  })

  test('an item that is not there is refused by name, with what an id is', async () => {
    const { setPaper } = await import('../list/papers.ts')
    setPaper({ op: 'add', epic: 'e', text: 'a line', by: 'the owner' })
    const out = setPaper({ op: 'tick', epic: 'e', id: 'nope', done: true, by: 'claude' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('there is no item "nope"')
  })

  test('an item with nothing in it is refused, rather than filed as a blank line', async () => {
    const { setPaper } = await import('../list/papers.ts')
    const out = setPaper({ op: 'add', epic: 'e', text: '   ', by: 'the owner' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('needs to say something')
  })

  test('an epic that is not a name is refused, and a hyphenated one is not', async () => {
    const { epicKey, setPaper } = await import('../list/papers.ts')
    /* The refusal is a fence around the KEY, not a grammar for slugs: every
       epic in this workspace has a hyphen in it, so a positive `[a-z0-9]+`
       would refuse all of them. */
    expect(epicKey('practices-are-the-only-governor')).toBe('practices-are-the-only-governor')
    expect(epicKey('a b')).toBeNull()
    expect(epicKey('../../etc/passwd')).toBeNull()
    expect(epicKey('')).toBeNull()
    expect(epicKey('x'.repeat(81))).toBeNull()
    expect(epicKey(7)).toBeNull()
    const out = setPaper({ op: 'add', epic: 'not an epic', text: 'a line', by: 'the owner' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('that is not an epic')
  })

  test('a paper cleared of every item is deleted rather than left as an empty list', async () => {
    const { papersWritten, setPaper } = await import('../list/papers.ts')
    const added = setPaper({ op: 'add', epic: 'e', text: 'a line', by: 'the owner' })
    if (!added.ok) throw new Error(added.error)
    setPaper({ op: 'drop', epic: 'e', id: added.paper.items[0]!.id, by: 'the owner' })
    expect(papersWritten()).toEqual([])
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ papers: {} })
  })
})

describe('the file', () => {
  test('one written before `viaMcp` existed still opens, and gains the default', async () => {
    /* The additive rule, which is the same rule this workspace applies to a
       database column: never drop, never rename, add with a default so an older
       file opens without complaint. A field added without one would make every
       item in this file unreadable, and an unreadable file is somebody's prose
       gone. */
    writeFileSync(
      file(),
      JSON.stringify({
        papers: {
          'modes-are-modules': {
            items: [
              {
                id: 'aabbccdd',
                text: 'The wire chapter still says synchronous',
                at: '2026-01-01T00:00:00.000Z',
                by: 'the owner',
                done: { at: '2026-01-02T00:00:00.000Z', by: 'claude' },
              },
            ],
          },
        },
      }),
    )
    const { paper } = await import('../list/papers.ts')
    const item = paper('modes-are-modules').items[0]
    expect(item?.text).toBe('The wire chapter still says synchronous')
    expect(item?.done?.by).toBe('claude')
    expect(item?.done?.viaMcp).toBe(false)
  })

  test('a paper that has never been written against is empty and is not trouble', async () => {
    const { paper } = await import('../list/papers.ts')
    const p = paper('never-touched')
    expect(p.items).toEqual([])
    expect(p.trouble).toBeNull()
  })

  test('a file that cannot be read says so, and is never written over', async () => {
    writeFileSync(file(), '{ this is not json')
    const { paper, setPaper } = await import('../list/papers.ts')
    /* The one place this store departs from the other two in this app. They
       fall back to the shipped list and to no ticks respectively, and both are
       defensible; there is no shipped paper list, so an empty answer here is
       indistinguishable from "nobody ever wrote anything" — about material
       nobody can retype. */
    expect(paper('e').trouble).toContain('could not be read')
    const out = setPaper({ op: 'add', epic: 'e', text: 'a line', by: 'the owner' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('nothing was changed')
    expect(readFileSync(file(), 'utf8')).toBe('{ this is not json')
  })
})

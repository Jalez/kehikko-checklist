import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'

/**
 * The store, which is now the whole of what this app decides.
 *
 * Every refusal here is read by both doors — the page's and the agent's — so a
 * test on `change()` is a test on both, and the two can never end up telling
 * somebody different things about the same press.
 */
/**
 * `dir` is a PROJECT now, not this app's data directory.
 *
 * That is the whole of what moved: the store lives at
 * `<project>/.kehikot/checklist/checklists.json`, so a temp directory standing in for a
 * project is all a test needs, and every call below says which project it is
 * about. There is no environment variable left to set — see `store.ts`.
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function store() {
  return import('../list/checklists.ts')
}

/** The store file for the project under test. */
function file(): string {
  return join(dir, KEHIKOT_DIR, moduleFolder(ID), 'checklists.json')
}

/**
 * Put bytes where the store will look for them.
 *
 * The folder has to be made first, because reading never makes it — that is the
 * rule `store.ts` keeps so that opening a container against a repository does not
 * leave a directory in it. A test writing the file by hand is standing in for a
 * project that already has one.
 */
function put(text: string): void {
  mkdirSync(join(dir, KEHIKOT_DIR, moduleFolder(ID)), { recursive: true })
  writeFileSync(file(), text)
}

async function aList(name = 'What a change owes'): Promise<{ list: string; item: string }> {
  const { change } = await store()
  const made = change({ op: 'create', name, by: 'a test' }, dir)
  if (!made.ok) throw new Error(made.error)
  const added = change({ op: 'add', id: made.id, text: 'A test that fails without the change', by: 'a test' }, dir)
  if (!added.ok) throw new Error(added.error)
  return { list: made.id, item: added.held!.rows[0]!.item.id }
}

describe('what the store holds', () => {
  test('nothing, on a fresh directory, because nothing ships a list', async () => {
    const { checklists } = await store()
    expect(checklists(dir).lists).toEqual([])
    expect(checklists(dir).trouble).toBeNull()
  })

  test('a list somebody made, with its items in the order they were added', async () => {
    const { change, held } = await store()
    const made = change({ op: 'create', name: 'Mine', by: 'a test' }, dir)
    if (!made.ok) throw new Error(made.error)
    change({ op: 'add', id: made.id, text: 'first', by: 'a test' }, dir)
    change({ op: 'add', id: made.id, text: 'second', by: 'a test' }, dir)
    const rows = held(made.id, null, dir).held!.rows
    expect(rows.map((r) => r.item.text)).toEqual(['first', 'second'])
  })

  test('order is the array’s order, so a move survives a reload with no `order` column anywhere', async () => {
    /* The argument is in the essay on `checklistSchema`: two sources for one
       fact, and a partial write leaves two items claiming position 3. This
       asserts the consequence — the file itself carries the order and nothing
       else does. */
    const { change, held } = await store()
    const made = change({ op: 'create', name: 'Mine', by: 'a test' }, dir)
    if (!made.ok) throw new Error(made.error)
    change({ op: 'add', id: made.id, text: 'first', by: 'a test' }, dir)
    const second = change({ op: 'add', id: made.id, text: 'second', by: 'a test' }, dir)
    if (!second.ok) throw new Error(second.error)
    const id = second.held!.rows[1]!.item.id
    change({ op: 'move', id: made.id, item: id, to: 0, by: 'a test' }, dir)

    const raw = JSON.parse(readFileSync(file(), 'utf8')) as {
      checklists: Record<string, { items: { text: string; order?: number }[] }>
    }
    expect(raw.checklists[made.id]!.items.map((i) => i.text)).toEqual(['second', 'first'])
    expect(raw.checklists[made.id]!.items[0]).not.toHaveProperty('order')
    expect(held(made.id, null, dir).held!.rows.map((r) => r.item.text)).toEqual(['second', 'first'])
  })

  test('a move past the end is clamped, because "put it last" is a clear intention', async () => {
    const { change } = await store()
    const { list, item } = await aList()
    change({ op: 'add', id: list, text: 'second', by: 'a test' }, dir)
    const out = change({ op: 'move', id: list, item, to: 99, by: 'a test' }, dir)
    expect(out.ok).toBe(true)
    expect(out.ok && out.said).toContain('position 2 of 2')
  })
})

describe('ticks belong to a checklist, a target and an item together', () => {
  test('the same list against two refs keeps two sets', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir)
    expect(held(list, { kind: 'ref', ref: 'gh#105' }, dir).held!.done).toBe(1)
    expect(held(list, { kind: 'ref', ref: 'gh#106' }, dir).held!.done).toBe(0)
  })

  test('a paper and a section of it are different targets', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({
      op: 'tick',
      id: list,
      item,
      target: { kind: 'paper', epic: 'modes', section: 'ch:bridge' },
      done: true,
      by: 'a test',
    }, dir)
    expect(held(list, { kind: 'paper', epic: 'modes', section: null }, dir).held!.done).toBe(0)
    expect(held(list, { kind: 'paper', epic: 'modes', section: 'ch:bridge' }, dir).held!.done).toBe(1)
  })

  test('every tick names its author and whether it came through the MCP door', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: '!44' }, done: true, by: 'claude', viaMcp: true }, dir)
    const tick = held(list, { kind: 'ref', ref: '!44' }, dir).held!.rows[0]!.done
    expect(tick?.by).toBe('claude')
    expect(tick?.viaMcp).toBe(true)
  })

  test('an untick leaves nothing behind, so a target with no ticks is not offered as one', async () => {
    const { change, targetsOf } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#1' }, done: true, by: 'a test' }, dir)
    expect(targetsOf(list, dir)).toHaveLength(1)
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#1' }, done: false, by: 'a test' }, dir)
    expect(targetsOf(list, dir)).toEqual([])
  })

  test('targets a list has ticks against come back, so nothing recorded becomes unreachable', async () => {
    const { change, targetsOf } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#1' }, done: true, by: 'a test' }, dir)
    change({ op: 'tick', id: list, item, target: { kind: 'paper', epic: 'modes', section: null }, done: true, by: 'a test' }, dir)
    expect(targetsOf(list, dir).map((t) => t.target.kind).sort()).toEqual(['paper', 'ref'])
  })

  test('forgetting a list takes every tick on it, on every target', async () => {
    const { change } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#1' }, done: true, by: 'a test' }, dir)
    change({ op: 'forget', id: list, by: 'a test' }, dir)
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { ticks: Record<string, unknown> }
    expect(raw.ticks[list]).toBeUndefined()
  })
})

describe('the file, when it cannot be read', () => {
  test('is reported rather than read as empty, because there is nothing to fall back to', async () => {
    /* The argument carried whole from the paper store this replaces. For authored
       prose, "empty" and "broken" must not be indistinguishable — there is no
       shipped list behind these, and the material is sentences nobody can retype
       from memory. */
    const { checklists } = await store()
    put('{ not json')
    const out = checklists(dir)
    expect(out.lists).toEqual([])
    expect(out.trouble).toContain('could not be read')
    expect(out.trouble).toContain('recoverable')
  })

  test('blocks every write, so a corrupt byte cannot become a flattened store', async () => {
    const { change } = await store()
    const before = 'lists: "everything somebody typed"'
    put(before)
    const out = change({ op: 'create', name: 'Mine', by: 'a test' }, dir)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain('nothing was changed')
    expect(readFileSync(file(), 'utf8')).toBe(before)
  })
})

describe('migration is additive', () => {
  test('a file written today opens under a schema with a field it has never heard of', async () => {
    /* Every field a later version adds arrives with a `.default()`, so an older
       file parses and gains the default rather than failing to parse — and a
       failed parse here is not a missing field, it is the whole store read as
       trouble. `origin` is the field this rule was last exercised on. */
    const { checklists } = await store()
    put(
      JSON.stringify({
        checklists: { abc: { id: 'abc', name: 'Old', at: '2026-01-01T00:00:00Z', by: 'somebody', items: [] } },
      }),
    )
    const out = checklists(dir)
    expect(out.trouble).toBeNull()
    expect(out.lists[0]?.name).toBe('Old')
  })
})

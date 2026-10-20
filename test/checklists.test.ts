import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

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

    const raw = (await store()).snapshot(dir)!
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

  test('an untick leaves no empty tick map behind, and the target stays held', async () => {
    /* The tick map is cleaned so a file full of empty objects does not read as
       holding something. The HOLDING is a fact about the list and survives:
       taking a tick back is not the same as saying the list is no longer about
       that work — that is `release`, in `test/targets.test.ts`. */
    const { change, targetsOf } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#1' }, done: true, by: 'a test' }, dir)
    expect(targetsOf(list, dir)).toEqual([{ target: { kind: 'ref', ref: 'gh#1' }, done: 1 }])
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#1' }, done: false, by: 'a test' }, dir)
    expect(targetsOf(list, dir)).toEqual([{ target: { kind: 'ref', ref: 'gh#1' }, done: 0 }])
    const raw = (await store()).snapshot(dir)!
    expect(raw.ticks[list]).toBeUndefined()
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
    const raw = (await store()).snapshot(dir)!
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

describe('a tracker fact as an item’s evidence (Jalez/kehikko-checklist#1)', () => {
  const EVIDENCE = {
    fact: 'pipeline' as const,
    said: 'pipeline: success at 4f6d7bb',
    print: 'pipeline: success at 4f6d7bb',
    sha: '4f6d7bbf9bdbf209913746fa669904fa5a0616ca',
    read: '2026-10-05T10:00:00Z',
  }

  test('an item names a fact, and naming none clears it, with its ticks untouched', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    const target = { kind: 'ref' as const, ref: '!7' }
    change({ op: 'tick', id: list, item, target, done: true, by: 'a test' }, dir)
    const cited = change({ op: 'cite', id: list, item, fact: 'pipeline', by: 'a test' }, dir)
    expect(cited.ok).toBe(true)
    expect(held(list, target, dir).held!.rows[0]!.item.fact).toBe('pipeline')
    change({ op: 'cite', id: list, item, fact: null, by: 'a test' }, dir)
    const after = held(list, target, dir).held!.rows[0]!
    expect(after.item.fact).toBeUndefined()
    expect(after.done).not.toBeNull()
  })

  test('a tick on a ref keeps the evidence for the fact the item names', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'cite', id: list, item, fact: 'pipeline', by: 'a test' }, dir)
    const target = { kind: 'ref' as const, ref: '!7' }
    change({ op: 'tick', id: list, item, target, done: true, by: 'a test', evidence: EVIDENCE }, dir)
    expect(held(list, target, dir).held!.rows[0]!.done!.evidence).toEqual(EVIDENCE)
  })

  test('evidence for another fact, or on a paper, is not kept — the tick still is', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'cite', id: list, item, fact: 'review', by: 'a test' }, dir)
    const ref = { kind: 'ref' as const, ref: '!7' }
    change({ op: 'tick', id: list, item, target: ref, done: true, by: 'a test', evidence: EVIDENCE }, dir)
    const onRef = held(list, ref, dir).held!.rows[0]!.done!
    expect(onRef.evidence).toBeUndefined()

    change({ op: 'cite', id: list, item, fact: 'pipeline', by: 'a test' }, dir)
    const paper = { kind: 'paper' as const, epic: 'thesis', section: null }
    change({ op: 'tick', id: list, item, target: paper, done: true, by: 'a test', evidence: EVIDENCE }, dir)
    const onPaper = held(list, paper, dir).held!.rows[0]!.done!
    expect(onPaper).not.toBeNull()
    expect(onPaper.evidence).toBeUndefined()
  })

  test('an import carries the fact an item names', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'cite', id: list, item, fact: 'description', by: 'a test' }, dir)
    const other = mkdtempSync(join(tmpdir(), 'checklist-other-'))
    try {
      const copied = change({ op: 'import', from: dir, id: list, by: 'a test' }, other)
      if (!copied.ok) throw new Error(copied.error)
      expect(held(copied.id, null, other).held!.rows[0]!.item.fact).toBe('description')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

describe('a tick has a state: passed, failed or not applicable', () => {
  const REF = { kind: 'ref', ref: 'gh#105' } as const

  test('a tick written without a state reads as passed, and no tick reads as unchecked', async () => {
    const { change, held } = await store()
    const { stateOf } = await import('../list/shapes.ts')
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: REF, done: true, by: 'a test' }, dir)
    const tick = held(list, REF, dir).held!.rows[0]!.done
    expect(stateOf(tick)).toBe('passed')
    expect(stateOf(null)).toBe('unchecked')
  })

  test('an old file, whose ticks never had a state, reads as passed', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: REF, done: true, by: 'a test' }, dir)
    /* Strip the field from every shard on disk: that is what a tick written
       before this change looks like. */
    const { readdirSync, readFileSync: read, writeFileSync: write, statSync } = await import('node:fs')
    const walk = (at: string): string[] =>
      readdirSync(at).flatMap((name) => {
        const path = join(at, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    let stripped = 0
    for (const path of walk(join(dir, KEHIKOT_DIR, moduleFolder(ID)))) {
      const text = read(path, 'utf8')
      if (!text.includes('"state"')) continue
      stripped += 1
      write(path, text.replace(/\s*"state":\s*"passed",?/g, ''))
    }
    expect(stripped).toBeGreaterThan(0)
    const again = held(list, REF, dir).held!
    expect(again.rows[0]!.done?.state).toBe('passed')
    expect(again.counts).toEqual({ passed: 1, failed: 0, na: 0, unchecked: 0 })
  })

  test('a failed tick is stored with its note and who set it, and leaves the others unchecked', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'add', id: list, text: 'second', by: 'a test' }, dir)
    change({ op: 'tick', id: list, item, target: REF, done: true, state: 'failed', note: 'line 4 is wrong', by: 'claude', viaMcp: true }, dir)
    const rows = held(list, REF, dir).held!.rows
    expect(rows[0]!.done).toMatchObject({ state: 'failed', note: 'line 4 is wrong', by: 'claude', viaMcp: true })
    expect(rows[1]!.done).toBeNull()
  })

  test('counts say passed, failed, n/a and unchecked, and done stays the passed count', async () => {
    const { change, held } = await store()
    const { list } = await aList()
    for (const text of ['b', 'c', 'd']) change({ op: 'add', id: list, text, by: 'a test' }, dir)
    const ids = held(list, REF, dir).held!.rows.map((r) => r.item.id)
    change({ op: 'tick', id: list, item: ids[0]!, target: REF, done: true, by: 'a test' }, dir)
    change({ op: 'tick', id: list, item: ids[1]!, target: REF, done: true, state: 'failed', by: 'a test' }, dir)
    change({ op: 'tick', id: list, item: ids[2]!, target: REF, done: true, state: 'na', by: 'a test' }, dir)
    const now = held(list, REF, dir).held!
    expect(now.counts).toEqual({ passed: 1, failed: 1, na: 1, unchecked: 1 })
    expect(now.done).toBe(1)
    expect(now.total).toBe(4)
  })

  test('a second tick on the same item replaces the state, and done:false removes it whatever its state', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: REF, done: true, state: 'failed', by: 'a test' }, dir)
    change({ op: 'tick', id: list, item, target: REF, done: true, state: 'na', note: 'no UI here', by: 'a test' }, dir)
    expect(held(list, REF, dir).held!.rows[0]!.done).toMatchObject({ state: 'na', note: 'no UI here' })
    change({ op: 'tick', id: list, item, target: REF, done: false, by: 'a test' }, dir)
    expect(held(list, REF, dir).held!.rows[0]!.done).toBeNull()
  })

  test('a not-applicable tick still holds the list against the target', async () => {
    const { change, targetsOf } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: REF, done: true, state: 'na', by: 'a test', viaMcp: true }, dir)
    expect(targetsOf(list, dir)).toEqual([{ target: REF, done: 1 }])
  })

  test('a state that is not one of the three is refused by the schema, so a hand-edited file is said so', async () => {
    const { tickSchema } = await import('../list/shapes.ts')
    expect(tickSchema.safeParse({ at: 'x', by: 'y', state: 'maybe' }).success).toBe(false)
    expect(tickSchema.parse({ at: 'x', by: 'y' }).state).toBe('passed')
  })
})

describe('a tick the person made is theirs: no agent changes or removes it', () => {
  const REF = { kind: 'ref', ref: 'gh#105' } as const

  async function personTicked() {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: REF, done: true, state: 'failed', note: 'I checked', by: 'Jaakko' }, dir)
    return { change, held, list, item }
  }

  function bytes(): string {
    const { readdirSync, readFileSync: read, statSync } = require('node:fs') as typeof import('node:fs')
    const walk = (at: string): string[] =>
      readdirSync(at).flatMap((name) => {
        const path = join(at, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    return walk(join(dir, KEHIKOT_DIR, moduleFolder(ID)))
      .sort()
      .map((path) => `${path}\n${read(path, 'utf8')}`)
      .join('\n')
  }

  test('an agent cannot change its state', async () => {
    const { change, held, list, item } = await personTicked()
    const before = bytes()
    const out = change({ op: 'tick', id: list, item, target: REF, done: true, state: 'passed', by: 'claude', viaMcp: true }, dir)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toContain('Jaakko')
    expect(!out.ok && out.error).toContain('only a person')
    expect(bytes()).toBe(before)
    expect(held(list, REF, dir).held!.rows[0]!.done).toMatchObject({ state: 'failed', note: 'I checked', viaMcp: false })
  })

  test('an agent cannot take it back', async () => {
    const { change, held, list, item } = await personTicked()
    const before = bytes()
    const out = change({ op: 'tick', id: list, item, target: REF, done: false, by: 'claude', viaMcp: true }, dir)
    expect(out.ok).toBe(false)
    expect(bytes()).toBe(before)
    expect(held(list, REF, dir).held!.rows[0]!.done).not.toBeNull()
  })

  test('an agent cannot drop an item that carries it', async () => {
    const { change, list, item } = await personTicked()
    const before = bytes()
    const out = change({ op: 'drop', id: list, item, by: 'claude', viaMcp: true }, dir)
    expect(out.ok).toBe(false)
    expect(bytes()).toBe(before)
  })

  test('the person can change their own tick and an agent\'s, and an agent can change an agent\'s', async () => {
    const { change, held } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: REF, done: true, by: 'claude', viaMcp: true }, dir)
    expect(change({ op: 'tick', id: list, item, target: REF, done: true, state: 'failed', by: 'claude', viaMcp: true }, dir).ok).toBe(true)
    expect(change({ op: 'tick', id: list, item, target: REF, done: true, state: 'na', by: 'Jaakko' }, dir).ok).toBe(true)
    expect(held(list, REF, dir).held!.rows[0]!.done?.state).toBe('na')
    expect(change({ op: 'tick', id: list, item, target: REF, done: false, by: 'Jaakko' }, dir).ok).toBe(true)
  })

  test('an agent may tick another target of the same item', async () => {
    const { change, held, list, item } = await personTicked()
    const other = { kind: 'ref', ref: 'gh#106' } as const
    expect(change({ op: 'tick', id: list, item, target: other, done: true, state: 'passed', by: 'claude', viaMcp: true }, dir).ok).toBe(true)
    expect(held(list, other, dir).held!.rows[0]!.done?.state).toBe('passed')
  })
})

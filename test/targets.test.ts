import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'
import { ladderKey, rungsOf, scopeOf } from '../list/scope.ts'
import { part, readKey, readTarget, targetKey, targetName } from '../list/targets.ts'

/**
 * What a checklist is held against: how it is spelled, how it is stored, and
 * how a file written before it was stored at all comes across.
 *
 * ## The real file, not a fixture shaped so the bug cannot occur
 *
 * The migration half of this file opens a COPY of the owner's own store —
 * seven chapter checklists and `"ticks": {}` — because that is the file the
 * previous model failed on: under it a list was "held against" whatever it
 * had ticks on, so seven lists about seven chapters were held against nothing
 * and shown wherever the reader happened to scroll. A synthetic fixture with a
 * tick in it would have passed and said nothing. When the real file is not on
 * this machine those cases are skipped and say so; the synthetic cases beside
 * them cover the other shapes a file can have.
 */

const REAL = '/Users/jaakkorajala/Claude/Projects/CS-DEGREE/05_drafts/thesis_latex/.kehikot/checklist/checklists.json'

let dir = ''
let mine = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-targets-'))
  mine = join(dir, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(mine, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const file = () => join(mine, 'checklists.json')

async function store() {
  return import('../list/checklists.ts')
}

type Raw = {
  checklists: Record<string, { name: string; items: { id: string; text: string; at: string; by: string }[]; targets?: string[] }>
  ticks: Record<string, Record<string, Record<string, unknown>>>
}

const paper = (epic: string, section: string | null = null) => ({ kind: 'paper' as const, epic, section })

describe('target identity', () => {
  test('a ref and a paper with the same name are different targets', () => {
    expect(targetKey({ kind: 'ref', ref: 'gh#105' })).not.toBe(targetKey(paper('gh#105')))
  })

  test('a whole paper and a section of it are different targets', () => {
    expect(targetKey(paper('modes'))).not.toBe(targetKey(paper('modes', 'ch:bridge')))
  })

  test('every key this app writes reads back as the target that made it', () => {
    const targets = [
      { kind: 'ref', ref: 'gh#105' },
      { kind: 'ref', ref: '!1848' },
      paper('modes-are-modules'),
      paper('modes-are-modules', 'ch:bridge'),
    ] as const
    for (const target of targets) expect(readKey(targetKey(target))).toEqual(target)
  })

  test('a slash cannot appear in any component, which is what makes the key unambiguous', () => {
    expect(part('a/b')).toBeNull()
    expect(part('a\\b')).toBeNull()
    expect(part('a b')).toBeNull()
    expect(part('')).toBeNull()
    expect(part('x'.repeat(81))).toBeNull()
    /* A hyphen, a hash, a colon and a leading dot are all allowed: every epic
       slug has a hyphen, every ref a hash, every LaTeX label a colon, and the
       owner's paper lives under `.kehikot/paper/`. */
    expect(part('modes-are-modules')).toBe('modes-are-modules')
    expect(part('gh#105')).toBe('gh#105')
    expect(part('ch:bridge')).toBe('ch:bridge')
    expect(part('.kehikot:paper:thesis:chapters:3_methods')).toBe('.kehikot:paper:thesis:chapters:3_methods')
  })

  test('a key this version cannot read is null rather than a throw', () => {
    for (const junk of ['', 'nonsense', 'ref:', 'paper:', 'paper:a/', 'other:x']) expect(readKey(junk)).toBeNull()
  })

  test('a section given and spelled wrong is refused, not silently dropped', () => {
    expect(readTarget({ epic: 'modes', section: 'ch bridge' })).toBeNull()
    expect(readTarget({ epic: 'modes', section: '' })).toEqual(paper('modes'))
  })

  test('a ref wins over an epic when a caller sends both', () => {
    expect(readTarget({ ref: 'gh#105', epic: 'modes' })).toEqual({ kind: 'ref', ref: 'gh#105' })
  })

  test('a name says what it is, so a row can be read without knowing the key format', () => {
    expect(targetName({ kind: 'ref', ref: 'gh#105' })).toBe('gh#105')
    expect(targetName(paper('modes'))).toContain('the paper')
    expect(targetName(paper('modes', 'ch:bridge'))).toContain('ch:bridge')
  })
})

describe('holding and releasing', () => {
  async function aList(): Promise<{ list: string; item: string }> {
    const { change } = await store()
    const made = change({ op: 'create', name: 'What a chapter owes', by: 'a test' }, dir)
    if (!made.ok) throw new Error(made.error)
    const added = change({ op: 'add', id: made.id, text: 'Every claim has a citation.', by: 'a test' }, dir)
    if (!added.ok) throw new Error(added.error)
    return { list: made.id, item: added.held!.rows[0]!.item.id }
  }

  test('a new list is held against nothing, and says so', async () => {
    const { checklists, targetsOf } = await store()
    const { list } = await aList()
    expect(targetsOf(list, dir)).toEqual([])
    expect(checklists(dir).lists[0]?.targets).toBe(0)
    expect(checklists(dir).lists[0]?.held).toEqual([])
  })

  test('holding writes the target on the list, in the file, as a key', async () => {
    const { change, targetsOf } = await store()
    const { list } = await aList()
    const out = change({ op: 'hold', id: list, target: paper('thesis', 'chapters:3_methods'), by: 'a test' }, dir)
    expect(out.ok && out.said).toContain('is now held against')
    expect(targetsOf(list, dir)).toEqual([{ target: paper('thesis', 'chapters:3_methods'), done: 0 }])
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Raw
    expect(raw.checklists[list]!.targets).toEqual(['paper:thesis/chapters:3_methods'])
  })

  test('holding against several sticks, in the order they were held', async () => {
    const { change, targetsOf } = await store()
    const { list } = await aList()
    change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#105' }, by: 'a test' }, dir)
    change({ op: 'hold', id: list, target: paper('thesis', 'chapters:3_methods'), by: 'a test' }, dir)
    change({ op: 'hold', id: list, target: paper('thesis'), by: 'a test' }, dir)
    expect(targetsOf(list, dir).map((one) => targetKey(one.target))).toEqual([
      'ref:gh#105',
      'paper:thesis/chapters:3_methods',
      'paper:thesis',
    ])
  })

  test('holding twice is one holding, and the sentence says it already was', async () => {
    const { change, targetsOf } = await store()
    const { list } = await aList()
    change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#105' }, by: 'a test' }, dir)
    const again = change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#105' }, by: 'a test' }, dir)
    expect(again.ok && again.said).toContain('already held against')
    expect(targetsOf(list, dir)).toHaveLength(1)
  })

  test('releasing keeps every tick made there, and holding again brings them back', async () => {
    /* "I no longer want this list in chapter 3" and "forget what was done in
       chapter 3" are two sentences, and only the first was said. */
    const { change, held, targetsOf } = await store()
    const { list, item } = await aList()
    const target = paper('thesis', 'chapters:3_methods')
    change({ op: 'hold', id: list, target, by: 'a test' }, dir)
    change({ op: 'tick', id: list, item, target, done: true, by: 'a test' }, dir)
    const released = change({ op: 'release', id: list, target, by: 'a test' }, dir)
    expect(released.ok && released.said).toContain('kept')
    expect(targetsOf(list, dir)).toEqual([])
    /* The tick is still in the file. */
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Raw
    expect(raw.ticks[list]![targetKey(target)]![item]).toBeTruthy()
    change({ op: 'hold', id: list, target, by: 'a test' }, dir)
    expect(held(list, target, dir).held!.done).toBe(1)
  })

  test('releasing what was never held changes nothing and says so', async () => {
    const { change } = await store()
    const { list } = await aList()
    const out = change({ op: 'release', id: list, target: { kind: 'ref', ref: 'gh#1' }, by: 'a test' }, dir)
    expect(out.ok && out.said).toContain('was not held against')
  })

  test('a tick against an unheld target holds it, and the sentence says so', async () => {
    /* The MCP door's case: an agent that ticks item 3 for gh#105 has named the
       target in so many words. The page cannot do this — it only draws a tick
       control on a target the list is already held against. */
    const { change, targetsOf } = await store()
    const { list, item } = await aList()
    const out = change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'an agent', viaMcp: true }, dir)
    expect(out.ok && out.said).toContain('is now held against gh#105')
    expect(targetsOf(list, dir)).toEqual([{ target: { kind: 'ref', ref: 'gh#105' }, done: 1 }])
  })

  test('an untick holds nothing, because taking a tick back is not a claim about the work', async () => {
    const { change, targetsOf } = await store()
    const { list, item } = await aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#105' }, done: false, by: 'a test' }, dir)
    expect(targetsOf(list, dir)).toEqual([])
  })

  test('forgetting a list takes its targets with it, because they were on the list', async () => {
    const { change, checklists } = await store()
    const { list } = await aList()
    change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#105' }, by: 'a test' }, dir)
    change({ op: 'forget', id: list, by: 'a test' }, dir)
    expect(checklists(dir).lists).toEqual([])
  })

  test('what is in front of a reader is read off the holdings, once, for every list', async () => {
    const { change, inFront } = await store()
    const { list } = await aList()
    const other = change({ op: 'create', name: 'What the thesis owes', by: 'a test' }, dir)
    if (!other.ok) throw new Error(other.error)
    change({ op: 'hold', id: list, target: paper('thesis', 'chapters:3_methods'), by: 'a test' }, dir)
    change({ op: 'hold', id: other.id, target: paper('thesis'), by: 'a test' }, dir)

    const inMethods = ladderKey(rungsOf(scopeOf('thesis', { file: 'chapters/3_methods.tex', section: null, title: null })))
    const inIntro = ladderKey(rungsOf(scopeOf('thesis', { file: 'chapters/1_introduction.tex', section: null, title: null })))
    expect(inFront({ ladder: inMethods, selection: [] }, dir).instances.map((one) => one.checklist.id)).toEqual([
      list,
      other.id,
    ])
    expect(inFront({ ladder: inIntro, selection: [] }, dir).instances.map((one) => one.checklist.id)).toEqual([other.id])
    expect(inFront({ ladder: '', selection: [] }, dir).instances).toEqual([])
  })
})

describe('a file written before targets were stored', () => {
  test('gives every list the targets its ticks already named, and touches no tick', async () => {
    /* Under the old model a tick WAS the assignment, so the tick keys are
       exactly the targets that person meant. */
    const yesterday = {
      checklists: {
        abc: { id: 'abc', name: 'Old', at: '2026-01-01T00:00:00Z', by: 'somebody', origin: null, items: [{ id: 'i1', text: 'x', at: '', by: '' }] },
        def: { id: 'def', name: 'Untouched', at: '2026-01-01T00:00:00Z', by: 'somebody', origin: null, items: [] },
      },
      ticks: {
        abc: {
          'ref:gh#105': { i1: { at: '2026-01-02T00:00:00Z', by: 'claude', viaMcp: true, note: 'ran it' } },
          'paper:thesis/chapters:3_methods': { i1: { at: '2026-01-03T00:00:00Z', by: 'the owner', viaMcp: false } },
        },
      },
    }
    writeFileSync(file(), JSON.stringify(yesterday))
    const { checklists, targetsOf } = await store()
    expect(checklists(dir).trouble).toBeNull()
    expect(targetsOf('abc', dir).map((one) => targetKey(one.target))).toEqual(['ref:gh#105', 'paper:thesis/chapters:3_methods'])
    expect(targetsOf('def', dir)).toEqual([])
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Raw
    expect(raw.ticks).toEqual(yesterday.ticks)
    expect(raw.checklists.abc!.targets).toEqual(['ref:gh#105', 'paper:thesis/chapters:3_methods'])
    expect(raw.checklists.def!.targets).toEqual([])
  })

  test('is settled once: a list released to nothing stays released on the next read', async () => {
    /* `targets: []` is a fact and not an absence. A `.default([])` in the
       schema would make the two indistinguishable and a release would undo
       itself on the next read. */
    const { change, checklists, targetsOf } = await store()
    const made = change({ op: 'create', name: 'Mine', by: 'a test' }, dir)
    if (!made.ok) throw new Error(made.error)
    const added = change({ op: 'add', id: made.id, text: 'x', by: 'a test' }, dir)
    if (!added.ok) throw new Error(added.error)
    const item = added.held!.rows[0]!.item.id
    change({ op: 'tick', id: made.id, item, target: { kind: 'ref', ref: 'gh#1' }, done: true, by: 'a test' }, dir)
    change({ op: 'release', id: made.id, target: { kind: 'ref', ref: 'gh#1' }, by: 'a test' }, dir)
    for (let i = 0; i < 3; i += 1) checklists(dir)
    expect(targetsOf(made.id, dir)).toEqual([])
  })

  const there = existsSync(REAL)

  test.skipIf(!there)('the owner’s real store opens with every list, every item and no tick changed', async () => {
    copyFileSync(REAL, file())
    const before = JSON.parse(readFileSync(REAL, 'utf8')) as Raw
    const { checklists, held } = await store()
    const out = checklists(dir)
    expect(out.trouble).toBeNull()
    expect(out.lists).toHaveLength(Object.keys(before.checklists).length)
    for (const [id, was] of Object.entries(before.checklists)) {
      const now = held(id, null, dir).held!
      expect(now.checklist.name).toBe(was.name)
      expect(now.rows.map((row) => row.item)).toEqual(was.items)
    }
    const after = JSON.parse(readFileSync(file(), 'utf8')) as Raw
    expect(after.ticks).toEqual(before.ticks)
  })

  test.skipIf(!there)('the seven chapter lists come across held against nothing, which is the truth of that file', async () => {
    /* `"ticks": {}` — nothing had ever connected them to anything, and that is
       the state the previous model could not express. */
    copyFileSync(REAL, file())
    const { checklists } = await store()
    for (const list of checklists(dir).lists) expect(list.targets).toBe(0)
    const after = JSON.parse(readFileSync(file(), 'utf8')) as Raw
    for (const list of Object.values(after.checklists)) expect(list.targets).toEqual([])
  })

  test.skipIf(!there)('and can be held against the real chapter files, after which a reader in one sees it', async () => {
    copyFileSync(REAL, file())
    const { change, checklists, inFront } = await store()
    const methods = checklists(dir).lists.find((one) => one.name.includes('Chapter 3'))
    expect(methods).toBeTruthy()
    /* The id `list/scope.ts` mints for the real file, which lives under the
       paper module's own folder. */
    const target = paper('thesis', '.kehikot:paper:thesis:chapters:3_methods')
    const out = change({ op: 'hold', id: methods!.id, target, by: 'the owner' }, dir)
    expect(out.ok).toBe(true)

    const inMethods = ladderKey(rungsOf(scopeOf('thesis', {
      file: '.kehikot/paper/thesis/chapters/3_methods.tex',
      section: '.kehikot:paper:thesis:chapters:3_methods#sec:meth-design',
      title: 'Research design',
    })))
    const inIntro = ladderKey(rungsOf(scopeOf('thesis', {
      file: '.kehikot/paper/thesis/chapters/1_introduction.tex',
      section: null,
      title: null,
    })))
    expect(inFront({ ladder: inMethods, selection: [] }, dir).instances.map((one) => one.checklist.name)).toEqual([
      methods!.name,
    ])
    expect(inFront({ ladder: inIntro, selection: [] }, dir).instances).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'
import { change, checklists, inFront } from '../list/checklists.ts'
import { choicesOf, chosenForAny, effective, migrateChoices, noChoiceLine } from '../list/choices.ts'
import type { RefsRead } from '../list/standing.ts'

/**
 * ONE standing checklist per type of item (`list/choices.ts`): chosen by the person per project,
 * overridden per kehikko, migrated from several standards once, and never chosen by an agent.
 */

const READ: RefsRead = { types: { '!7': 'mr', 'gh#105': 'issue', 'gh#200': 'pr' }, roles: {}, epics: {} }
let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-choices-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})
const folder = () => join(dir, KEHIKOT_DIR, moduleFolder(ID))
function ok<T extends { ok: boolean }>(result: T): T & { ok: true } {
  if (!result.ok) throw new Error((result as unknown as { error: string }).error)
  return result as T & { ok: true }
}
const make = (name: string, types: string[] = []) =>
  ok(change({ op: 'create', name, ...(types.length ? { rule: { types } } : {}), by: 'a test' }, dir)).id
const front = (refs: string[], choices?: Record<string, string>) =>
  inFront({ ladders: [], selection: refs, read: READ, ...(choices ? { choices: choicesOf(choices) } : {}) }, dir)
const names = (got: ReturnType<typeof front>) => got.instances.map((one) => one.checklist.name)

describe('choosing per type', () => {
  test('the person chooses a list for a type; every item of the type is read against it, and only it', () => {
    const a = make('MR standard A', ['mr'])
    const b = make('MR standard B', ['mr'])
    expect(names(front(['!7']))).toEqual(['MR standard A'])
    ok(change({ op: 'choose', type: 'mr', id: b, by: 'the person' }, dir))
    expect(names(front(['!7']))).toEqual(['MR standard B'])
    expect(front(['!7']).items[0]!.chosen).toEqual({ id: b, name: 'MR standard B', by: 'project' })
    const file = JSON.parse(readFileSync(join(folder(), 'lists.json'), 'utf8')) as { choices: Record<string, string> }
    expect(file.choices).toEqual({ mr: b })
    void a
  })

  test('a list chosen for a type it was not made for is made for it too, and reads as a standard', () => {
    const plain = make('Anything')
    expect(checklists(dir).lists[0]!.applies).toEqual([])
    ok(change({ op: 'choose', type: 'issue', id: plain, by: 'the person' }, dir))
    expect(checklists(dir).lists[0]!.applies).toEqual([{ kind: 'rule', types: ['issue'], roles: ['any'], epic: null }])
    expect(names(front(['gh#105']))).toEqual(['Anything'])
  })

  test('none: nothing in front of the type, and nothing chosen by itself afterwards', () => {
    make('MR standard', ['mr'])
    ok(change({ op: 'choose', type: 'mr', id: null, by: 'the person' }, dir))
    const got = front(['!7'])
    expect(got.instances).toEqual([])
    expect(got.items[0]!.chosen).toBeNull()
    expect(noChoiceLine('mr')).toBe('No checklist is chosen for merge requests. Pick a checklist for merge requests in the header’s Checklist menu.')
    /* Reading again assigns nothing. */
    expect(front(['!7']).instances).toEqual([])
  })

  test('a starter chosen for a type is adopted on the way, once', () => {
    const chose = ok(change({ op: 'choose', type: 'pr', id: null, starter: 'changes', by: 'the person' }, dir))
    expect(chose.said).toContain('"Pull and merge request standards" is the checklist for pull requests now')
    expect(names(front(['gh#200']))).toEqual(['Pull and merge request standards'])
    /* Adopting it claimed merge requests too, which had no choice. */
    expect(names(front(['!7']))).toEqual(['Pull and merge request standards'])
    ok(change({ op: 'choose', type: 'pr', id: null, starter: 'changes', by: 'the person' }, dir))
    expect(checklists(dir).lists).toHaveLength(1)
  })

  test('choosing is the person’s: refused through the MCP door, even with person_asked; nonsense is refused', () => {
    const a = make('MR standard', ['mr'])
    const viaMcp = change({ op: 'choose', type: 'mr', id: null, by: 'claude', viaMcp: true, asked: 'please' }, dir)
    expect(viaMcp.ok).toBe(false)
    expect(!viaMcp.ok && viaMcp.error).toContain('Which checklist every merge request uses is the person\'s choice')
    expect(names(front(['!7']))).toEqual(['MR standard'])
    expect(change({ op: 'choose', type: 'merge' as never, id: a, by: 'the person' }, dir).ok).toBe(false)
    expect(change({ op: 'choose', type: 'mr', id: 'nope', by: 'the person' }, dir).ok).toBe(false)
  })

  test('forgetting the chosen list leaves its type with none', () => {
    const a = make('MR standard', ['mr'])
    make('Another MR standard', ['mr'])
    ok(change({ op: 'forget', id: a, by: 'the person' }, dir))
    expect(front(['!7']).instances).toEqual([])
    expect(front(['!7']).items[0]!.chosen).toBeNull()
  })
})

describe('the kehikko override', () => {
  test('this kehikko’s choice wins over the project’s for its types, and the rest are the project’s', () => {
    make('Project MRs', ['mr'])
    make('Project issues', ['issue'])
    const here = make('Kehikko MRs')
    const got = front(['!7', 'gh#105'], { mr: here })
    expect(names(got)).toEqual(['Kehikko MRs', 'Project issues'])
    expect(got.items[0]!.chosen).toMatchObject({ name: 'Kehikko MRs', by: 'kehikko' })
    expect(got.items[1]!.chosen).toMatchObject({ name: 'Project issues', by: 'project' })
    /* Nothing written to the project. */
    expect(checklists(dir).lists.find((one) => one.name === 'Project MRs')!.chosen).toEqual(['mr'])
    expect(effective({ mr: 'a', issue: 'b' }, { mr: 'c' })).toEqual({ mr: 'c', issue: 'b' })
  })

  test('kept state is read leniently: unknown types, empty and non-string values are dropped', () => {
    expect(choicesOf({ mr: 'x', kept: 'yes', issue: '', paper: 3, pr: ' y ' })).toEqual({ mr: 'x', pr: 'y' })
    expect(choicesOf('nonsense')).toEqual({})
  })
})

describe('migration of several standards', () => {
  test('a lists.json from before choices: each type keeps the standard most recently used; the others are unassigned, said once', () => {
    mkdirSync(folder(), { recursive: true })
    const list = (id: string, name: string, types: string[], at: string) => ({ id, name, at, by: 'p', origin: null, items: [{ id: `${id}-1`, text: 'x', at, by: 'p' }], holds: 0, next: 0, applies: [{ types, roles: ['any'], since: at }] })
    writeFileSync(
      join(folder(), 'lists.json'),
      JSON.stringify({
        layout: 2,
        checklists: {
          old: list('old', 'Old MR standard', ['mr'], '2026-01-01T00:00:00.000Z'),
          used: list('used', 'Used MR standard', ['mr', 'pr'], '2026-01-02T00:00:00.000Z'),
          fresh: list('fresh', 'Fresh but unused', ['mr'], '2026-03-01T00:00:00.000Z'),
          issues: list('issues', 'Issues', ['issue'], '2026-01-01T00:00:00.000Z'),
        },
      }),
    )
    /* "used" was ticked on an item last, after "fresh" was made: it is the most recently used. */
    mkdirSync(join(folder(), 'targets', 'used'), { recursive: true })
    const { bucketOf, groupOf } = require('../list/book.ts') as typeof import('../list/book.ts')
    writeFileSync(
      join(folder(), 'targets', 'used', `${bucketOf(groupOf('ref:!7'))}.json`),
      JSON.stringify({ 'ref:!7': { ticks: { 'used-1': { state: 'passed', at: '2026-04-01T00:00:00.000Z', by: 'p', viaMcp: false } } } }),
    )
    expect(names(front(['!7', 'gh#200', 'gh#105']))).toEqual(['Used MR standard', 'Used MR standard', 'Issues'])
    const file = JSON.parse(readFileSync(join(folder(), 'lists.json'), 'utf8')) as { choices: Record<string, string> }
    expect(file.choices).toEqual({ issue: 'issues', mr: 'used', pr: 'used' })
    const rows = checklists(dir).lists
    expect(rows.filter((one) => !one.chosen && one.applies?.length).map((one) => one.name).sort()).toEqual(['Fresh but unused', 'Old MR standard'])
  })

  test('migrateChoices, as a table: latest used first, ties by name, one item’s own lines never', () => {
    const lists = [
      { id: 'a', name: 'B list', applies: [{ types: ['mr'], since: '' }] },
      { id: 'b', name: 'A list', applies: [{ types: ['mr'], since: '' }] },
      { id: 'c', name: 'Own', only: 'ref:!7', applies: [{ types: ['mr'], since: '' }] },
    ]
    expect(migrateChoices(lists, () => '2026')).toEqual({ mr: 'b' })
    expect(migrateChoices(lists, (id) => (id === 'a' ? '2027' : '2026'))).toEqual({ mr: 'a' })
  })

  test('an unknown type whose possible types use different lists is unknown, never guessed', () => {
    expect(chosenForAny({ issue: 'a', pr: 'b' }, ['issue', 'pr'], { a: 1, b: 1 })).toEqual({ answer: 'unknown', ids: ['a', 'b'] })
    expect(chosenForAny({ issue: 'a', pr: 'a' }, ['issue', 'pr'], { a: 1 })).toEqual({ answer: 'one', id: 'a', type: 'issue' })
    expect(chosenForAny({}, ['issue', 'pr'], {})).toEqual({ answer: 'none' })
  })
})

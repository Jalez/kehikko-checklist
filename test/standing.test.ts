import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'
import { change, checklists, holds, inFront, targetsOf } from '../list/checklists.ts'
import { covers, kindOf, noneLine, NOTHING_READ, undecidedLine, type RefsRead } from '../list/standing.ts'
import { readKey, readTarget, targetKey, targetName, type Target } from '../list/targets.ts'
import { preview, usage } from '../list/storage.ts'

/**
 * A list held against every issue or every change (Jalez/kehikko-checklist#31):
 * held once, in front of each ref the tracker reads as that kind, ticked per
 * ref under the ref's own key.
 */

const EVERY_ISSUE: Target = { kind: 'every', of: 'issue', epic: null }
const EVERY_CHANGE: Target = { kind: 'every', of: 'change', epic: null }

const ISSUES: RefsRead = { kinds: { 'gh#105': 'issue', 'gh#106': 'issue', 'gh#200': 'change' }, epics: {} }

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-standing-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function folder(): string {
  return join(dir, KEHIKOT_DIR, moduleFolder(ID))
}

function made(name: string, items: string[]): { list: string; items: string[] } {
  const got = change({ op: 'create', name, by: 'a test' }, dir)
  if (!got.ok) throw new Error(got.error)
  const ids = items.map((text) => {
    const added = change({ op: 'add', id: got.id, text, by: 'a test' }, dir)
    if (!added.ok) throw new Error(added.error)
    return added.held!.rows.at(-1)!.item.id
  })
  return { list: got.id, items: ids }
}

function ok<T extends { ok: boolean }>(result: T): T & { ok: true } {
  if (!result.ok) throw new Error((result as unknown as { error: string }).error)
  return result as T & { ok: true }
}

function front(refs: string[], read: RefsRead = ISSUES) {
  return inFront({ ladders: [], selection: refs, read }, dir)
}

describe('the target', () => {
  test('is spelled and read back, with and without an epic', () => {
    expect(targetKey(EVERY_ISSUE)).toBe('every:issue')
    expect(targetKey({ kind: 'every', of: 'change', epic: 'thesis' })).toBe('every:change/thesis')
    expect(readKey('every:issue')).toEqual(EVERY_ISSUE)
    expect(readKey('every:change/thesis')).toEqual({ kind: 'every', of: 'change', epic: 'thesis' })
    expect(readKey('every:merge')).toBeNull()
    expect(readKey('every:issue/a/b')).toBeNull()
    expect(targetName({ kind: 'every', of: 'issue', epic: 'thesis' })).toBe('every issue of thesis')
  })

  test('a door names it with every, and a word that is neither kind is refused', () => {
    expect(readTarget({ every: 'issue' })).toEqual(EVERY_ISSUE)
    expect(readTarget({ every: 'change', epic: 'thesis' })).toEqual({ kind: 'every', of: 'change', epic: 'thesis' })
    expect(readTarget({ every: 'mr' })).toBeNull()
    /* A ref still wins: the one target that names one piece of work. */
    expect(readTarget({ ref: 'gh#1', every: 'issue' })).toEqual({ kind: 'ref', ref: 'gh#1' })
  })
})

describe('covers', () => {
  const issue = [{ of: 'issue' as const, since: 'x' }]
  test('by the tracker reading’s kind', () => {
    expect(covers(issue, 'gh#105', ISSUES).answer).toBe('yes')
    expect(covers(issue, 'gh#200', ISSUES).answer).toBe('no')
  })
  test('by a GitLab spelling, which says its own kind', () => {
    expect(kindOf('!7', NOTHING_READ)).toBe('change')
    expect(covers(issue, '!7', NOTHING_READ).answer).toBe('no')
    expect(covers(issue, '#12', NOTHING_READ).answer).toBe('yes')
  })
  test('unknown when nothing says, never a guess', () => {
    expect(covers(issue, 'gh#9', NOTHING_READ)).toEqual({ answer: 'unknown', why: 'kind' })
    /* A name that is an Object property is not a kind. */
    expect(covers(issue, 'constructor', NOTHING_READ).answer).toBe('unknown')
  })
  test('a list standing against both kinds needs no kind', () => {
    const both = [...issue, { of: 'change' as const, since: 'x' }]
    expect(covers(both, 'gh#9', NOTHING_READ).answer).toBe('yes')
  })
  test('an epic’s: the refs that epic names, and unknown for an epic nobody read', () => {
    const thesis = [{ of: 'issue' as const, epic: 'thesis', since: 'x' }]
    expect(covers(thesis, 'gh#105', { ...ISSUES, epics: { thesis: ['gh#105'] } }).answer).toBe('yes')
    expect(covers(thesis, 'gh#106', { ...ISSUES, epics: { thesis: ['gh#105'] } }).answer).toBe('no')
    expect(covers(thesis, 'gh#105', ISSUES)).toEqual({ answer: 'unknown', why: 'epic' })
  })
})

describe('a standing hold', () => {
  test('a new ref picks up the list, with nothing written per ref', () => {
    const { list } = made('What an issue owes', ['Has a reproduction'])
    const held = ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    expect(held.said).toContain('is now held against every issue')
    /* In lists.json with the list, and no folder for it. */
    const lists = JSON.parse(readFileSync(join(folder(), 'lists.json'), 'utf8')) as { checklists: Record<string, { standing?: unknown[] }> }
    expect(lists.checklists[list]!.standing).toHaveLength(1)
    expect(existsSync(join(folder(), 'targets', list))).toBe(false)

    /* A ref nobody held, opened after the hold, has the list in front as itself. */
    const got = front(['gh#106'])
    expect(got.instances).toHaveLength(1)
    expect(got.instances[0]!.target).toEqual({ kind: 'ref', ref: 'gh#106' })
    expect(got.instances[0]!.through).toEqual([EVERY_ISSUE])
    expect(got.undecided).toEqual([])
    /* A change is not an issue. */
    expect(front(['gh#200']).instances).toEqual([])
    /* Still nothing per ref. */
    expect(existsSync(join(folder(), 'targets', list))).toBe(false)
    expect(holds(list, EVERY_ISSUE, dir)).toBe(true)
    expect(targetsOf(list, dir)[0]).toEqual({ target: EVERY_ISSUE, done: 0 })
    expect(checklists(dir).lists[0]!.standing).toEqual([EVERY_ISSUE])
  })

  test('per-ref ticks stay separate, under each ref’s own key, and a tick holds no ref', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction', 'Has a label'])
    ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    const ticked = ok(change({ op: 'tick', id: list, item: items[0]!, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    expect(ticked.said).toContain('was not held on its own')

    const got = front(['gh#105', 'gh#106'])
    const on = (ref: string) => got.instances.find((one) => one.target?.kind === 'ref' && one.target.ref === ref)!
    expect(on('gh#105').done).toBe(1)
    expect(on('gh#106').done).toBe(0)
    /* The tick did not hold gh#105 by itself: the list is held against nothing per ref. */
    expect(checklists(dir).lists[0]!.targets).toBe(0)
    expect(holds(list, { kind: 'ref', ref: 'gh#105' }, dir)).toBe(false)
    /* Storage counts it as in use, not as released ticks. */
    const row = usage(dir).lists[0]!
    expect(row.held).toBe(1)
    expect(row.released).toBe(0)
  })

  test('Purge never takes ticks a standing hold is still in front of as released ones', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    ok(change({ op: 'tick', id: list, item: items[0]!, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    const later = Date.now() + 400 * 86_400_000
    const kept = preview(dir, { scope: 'released', days: 1 }, null, later)
    expect(kept.ok && kept.value.targets).toBe(0)
    ok(change({ op: 'release', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    const gone = preview(dir, { scope: 'released', days: 1 }, null, later)
    expect(gone.ok && gone.value.targets).toBe(1)
  })

  test('a ref held by hand keeps its own hold and is not said to be through the standing one', () => {
    const { list } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    ok(change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#105' }, by: 'a test' }, dir))
    const got = front(['gh#105'])
    expect(got.instances).toHaveLength(1)
    expect(got.instances[0]!.through).toBeUndefined()
  })

  test('releasing keeps the ticks, and holding again brings them back', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    ok(change({ op: 'tick', id: list, item: items[0]!, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    const released = ok(change({ op: 'release', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    expect(released.said).toContain('no longer held against every issue')
    expect(released.said).toContain('kept')
    expect(front(['gh#105']).instances).toEqual([])
    /* Kept, and counted as released ticks now. */
    const row = usage(dir).lists[0]!
    expect(row.ticks).toBe(1)
    expect(row.released).toBe(1)
    expect(readdirSync(join(folder(), 'targets', list)).length).toBe(1)

    ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    expect(front(['gh#105']).instances[0]!.done).toBe(1)
  })

  test('an unknown kind is said, not guessed', () => {
    const { list } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    const got = front(['gh#9'], NOTHING_READ)
    expect(got.instances).toEqual([])
    expect(got.undecided).toEqual([{ ref: 'gh#9', why: 'kind', lists: ['What an issue owes'] }])
    expect(undecidedLine(got.undecided)).toBe(
      'The tracker has not said whether gh#9 is an issue or a change, so “What an issue owes”, held against every '
      + 'issue or every change, is not shown for it until it does.',
    )
  })

  test('one epic’s: only the refs the epic names', () => {
    const { list } = made('What a thesis issue owes', ['Cites the chapter'])
    ok(change({ op: 'hold', id: list, target: { kind: 'every', of: 'issue', epic: 'thesis' }, by: 'a test' }, dir))
    const read: RefsRead = { ...ISSUES, epics: { thesis: ['gh#105'] } }
    expect(front(['gh#105', 'gh#106'], read).instances.map((one) => one.target)).toEqual([{ kind: 'ref', ref: 'gh#105' }])
  })

  test('a tick against every issue itself is refused: ticks are per ref', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: EVERY_ISSUE, by: 'a test' }, dir))
    const refused = change({ op: 'tick', id: list, item: items[0]!, target: EVERY_ISSUE, done: true, by: 'a test' }, dir)
    expect(refused.ok).toBe(false)
  })

  test('a change list and an issue list each keep to their kind', () => {
    const issues = made('What an issue owes', ['Has a reproduction']).list
    const changes = made('What a change owes', ['Has tests']).list
    ok(change({ op: 'hold', id: issues, target: EVERY_ISSUE, by: 'a test' }, dir))
    ok(change({ op: 'hold', id: changes, target: EVERY_CHANGE, by: 'a test' }, dir))
    const got = front(['gh#105', 'gh#200'])
    expect(got.instances.map((one) => [one.checklist.name, (one.target as { ref: string }).ref])).toEqual([
      ['What an issue owes', 'gh#105'],
      ['What a change owes', 'gh#200'],
    ])
  })
})

describe('the empty pane', () => {
  test('says nothing is held when no list stands anywhere', () => {
    const none = noneLine(['gh#106'], [])
    expect(none?.why).toBe('nothing-held')
    expect(none?.said).toContain('Nothing is held against gh#106')
    expect(none?.said).toContain('not that it owes nothing')
  })
  test('says no checklist applies when lists stand for other refs', () => {
    const none = noneLine(['gh#200'], [EVERY_ISSUE])
    expect(none).toEqual({
      why: 'none-applies',
      said: 'No checklist applies to gh#200: none is held against it, and the ones held against every issue are for other refs.',
    })
  })
  test('has nothing to say with no refs in front', () => {
    expect(noneLine([], [EVERY_ISSUE])).toBeNull()
  })
})

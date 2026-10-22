import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'
import { change, checklists, holds, inFront, targetsOf } from '../list/checklists.ts'
import {
  angleLine,
  angleRoles,
  covers,
  coversPaper,
  migrateStanding,
  NOTHING_PICKED,
  NOTHING_READ,
  nothingLine,
  possibleTypes,
  rolesFromMine,
  ruleOf,
  TASKS_KNOWN,
  typeOfRow,
  undecidedLine,
  type Angle,
  type RefsRead,
  type Rule,
} from '../list/standing.ts'
import { readKey, readTarget, targetKey, targetName, type Target } from '../list/targets.ts'
import { preview, usage } from '../list/storage.ts'

/**
 * A list that applies to a TYPE of item × a ROLE, across the project or one
 * epic (`list/standing.ts`): held once, in front of each item the tracker
 * reads as that type from that angle, ticked per item under the item's own
 * key — and the lines added for one item alone, on top.
 */

const rule = (types: Rule['types'], roles: Rule['roles'] = ['any'], epic: string | null = null): Rule => ({ types, roles, epic })
const target = (types: Rule['types'], roles: Rule['roles'] = ['any'], epic: string | null = null): Target => ({ kind: 'rule', types, roles, epic })
const ISSUES = target(['issue'])
/* A reader anywhere in the thesis: the paper rung of the ladder, as `ladderKey` spells it. */
const PAPER = 'paper\tthesis\t'
const CHANGES = target(['mr', 'pr'])

/* gh#105/106 are GitHub issues, gh#200 a GitHub pull request, !7 a GitLab merge request. */
const READ: RefsRead = {
  types: { 'gh#105': 'issue', 'gh#106': 'issue', 'gh#200': 'pr', '!7': 'mr' },
  roles: { 'gh#200': ['reviewer'], '!7': ['author', 'reviewer'], 'gh#105': [] },
  epics: {},
}

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

function front(refs: string[], read: RefsRead = READ, angle: Angle = 'auto', paper: string | null = null) {
  return inFront({ ladders: [], selection: refs, read, angle, paper }, dir)
}
const names = (got: ReturnType<typeof front>) =>
  got.instances.map((one) => [one.checklist.name, one.target?.kind === 'ref' ? one.target.ref : targetKey(one.target as Target)])

describe('the rule as a target', () => {
  test('is spelled and read back, with and without an epic', () => {
    expect(targetKey(target(['mr', 'pr'], ['reviewer']))).toBe('rule:mr+pr/reviewer')
    expect(readKey('rule:mr+pr/reviewer')).toEqual(target(['mr', 'pr'], ['reviewer']))
    expect(readKey('rule:issue/any/thesis')).toEqual(target(['issue'], ['any'], 'thesis'))
    expect(readKey('rule:nothing/any')).toBeNull()
    expect(targetName(target(['mr'], ['reviewer'], 'thesis'))).toBe('merge requests of thesis · as reviewer')
    expect(targetName(target(['issue', 'paper']))).toBe('issues and papers · any role')
  })

  test('#31’s every-issue and every-change spellings read as the rules they became', () => {
    expect(readKey('every:issue')).toEqual(ISSUES)
    expect(readKey('every:change/thesis')).toEqual(target(['mr', 'pr'], ['any'], 'thesis'))
    expect(readKey('every:merge')).toBeNull()
  })

  test('a door names it with types and roles, task among them; a word that is neither is refused', () => {
    expect(readTarget({ types: ['mr'], roles: ['reviewer'] })).toEqual(target(['mr'], ['reviewer']))
    expect(readTarget({ types: 'issue+paper' })).toEqual(target(['issue', 'paper']))
    expect(readTarget({ every: 'change', epic: 'thesis' })).toEqual(target(['mr', 'pr'], ['any'], 'thesis'))
    expect(readTarget({ types: ['merge'] })).toBeNull()
    expect(readTarget({ types: ['mr'], roles: ['owner'] })).toBeNull()
    expect(TASKS_KNOWN).toBe(true)
    expect(readTarget({ types: ['task'] })).toEqual(target(['task']))
    /* A ref still wins: the one target that names one piece of work. */
    expect(readTarget({ ref: 'gh#1', types: ['issue'] })).toEqual({ kind: 'ref', ref: 'gh#1' })
  })

  test('any role stands alone, and a rule read leniently drops what this version cannot use', () => {
    expect(readTarget({ types: ['issue'], roles: ['reviewer', 'any'] })).toEqual(target(['issue'], ['any']))
    expect(ruleOf({ types: ['issue', 'task', 'epic'], roles: ['author', 'owner'] })).toEqual(rule(['issue', 'task'], ['author']))
    expect(ruleOf({ types: ['task'] })).toEqual(rule(['task']))
  })
})

describe('the type: the tracker’s to say', () => {
  test('a row’s kind and tracker tell an issue, a GitLab merge request and a GitHub pull request apart', () => {
    expect(typeOfRow({ kind: 'issue', tracker: 'gitlab' })).toBe('issue')
    expect(typeOfRow({ kind: 'change', tracker: 'gitlab' })).toBe('mr')
    expect(typeOfRow({ kind: 'change', tracker: 'github' })).toBe('pr')
  })
  test('a GitLab spelling says its own type; a GitHub one says issue or pull request; nothing else is guessed', () => {
    expect(possibleTypes('!7', NOTHING_READ)).toEqual(['mr'])
    expect(possibleTypes('#12', NOTHING_READ)).toEqual(['issue', 'task'])
    expect(possibleTypes('gh#41', NOTHING_READ)).toEqual(['issue', 'pr'])
    expect(possibleTypes('gh#41', { ...NOTHING_READ, types: { 'gh#41': 'pr' } })).toEqual(['pr'])
    /* A name that is an Object property is not a type. */
    expect(possibleTypes('constructor', NOTHING_READ)).toEqual(['issue', 'task', 'mr', 'pr'])
  })
})

describe('a GitLab task: the row’s work item type', () => {
  /* #12 is a GitLab task, #13 a plain GitLab issue, #14 a GitLab incident. */
  const TASKS: RefsRead = { types: { '#12': 'task', '#13': 'issue', '#14': 'issue' }, roles: {}, epics: {} }

  test('a row whose workItem is task is a task; another work item type, or none, is an issue', () => {
    expect(typeOfRow({ kind: 'issue', tracker: 'gitlab', workItem: 'task' })).toBe('task')
    expect(typeOfRow({ kind: 'issue', tracker: 'gitlab', workItem: 'incident' })).toBe('issue')
    expect(typeOfRow({ kind: 'issue', tracker: 'gitlab' })).toBe('issue')
    expect(typeOfRow({ kind: 'issue', tracker: 'github' })).toBe('issue')
    /* A change is never a task, whatever a row says. */
    expect(typeOfRow({ kind: 'change', tracker: 'gitlab', workItem: 'task' })).toBe('mr')
  })

  test('a task matches the lists for tasks and NOT those for issues; an issue the other way round', () => {
    expect(covers([rule(['task'])], '#12', TASKS, ['any']).answer).toBe('yes')
    expect(covers([rule(['issue'])], '#12', TASKS, ['any']).answer).toBe('no')
    expect(covers([rule(['issue'])], '#13', TASKS, ['any']).answer).toBe('yes')
    expect(covers([rule(['task'])], '#13', TASKS, ['any']).answer).toBe('no')
    expect(covers([rule(['issue', 'task'])], '#12', TASKS, ['any']).answer).toBe('yes')
  })

  test('a GitLab #12 nothing has read is an issue or a task: unknown unless the lists agree', () => {
    expect(covers([rule(['issue'])], '#12', NOTHING_READ, ['any'])).toEqual({ answer: 'unknown', why: 'kind' })
    expect(covers([rule(['issue', 'task'])], '#12', NOTHING_READ, ['any']).answer).toBe('yes')
    expect(covers([rule(['mr'])], '#12', NOTHING_READ, ['any']).answer).toBe('no')
  })

  test('in front: a task list is in front of the task, says it is a task, and an issue list is not', () => {
    const { list: forTasks } = made('What a task owes', ['Linked to its issue'])
    const { list: forIssues } = made('What an issue owes', ['Has a label'])
    ok(change({ op: 'hold', id: forTasks, target: target(['task']), by: 'a test' }, dir))
    ok(change({ op: 'hold', id: forIssues, target: ISSUES, by: 'a test' }, dir))
    const task = front(['#12'], TASKS)
    expect(names(task)).toEqual([['What a task owes', '#12']])
    expect(task.items[0]).toMatchObject({ target: { kind: 'ref', ref: '#12' }, type: 'task' })
    const issue = front(['#13'], TASKS)
    expect(names(issue)).toEqual([['What an issue owes', '#13']])
    expect(issue.items[0]).toMatchObject({ type: 'issue' })
  })
})

describe('the angle: the person’s roles, one role, or any', () => {
  test('myRoles: either reviewer role is reviewer; absent is unknown, which is not the same as none', () => {
    expect(rolesFromMine(['reviewer-asked'])).toEqual(['reviewer'])
    expect(rolesFromMine(['reviewer-done', 'author', 'assignee'])).toEqual(['assignee', 'reviewer', 'author'])
    expect(rolesFromMine([])).toEqual([])
    expect(rolesFromMine(undefined)).toBeNull()
  })
  test('automatic is the person’s own roles, and any role when there are none or nobody knows', () => {
    expect(angleRoles('auto', ['reviewer'])).toEqual(['reviewer'])
    expect(angleRoles('auto', ['author', 'reviewer'])).toEqual(['reviewer', 'author'])
    expect(angleRoles('auto', [])).toEqual(['any'])
    expect(angleRoles('auto', null)).toEqual(['any'])
    expect(angleRoles('author', ['reviewer'])).toEqual(['author'])
    expect(angleRoles('any', ['reviewer'])).toEqual(['any'])
  })
  test('the line over an item says the angle', () => {
    expect(angleLine(['reviewer'], '!123')).toBe('As reviewer on !123')
    expect(angleLine(['reviewer', 'author'], '!7')).toBe('As reviewer and author on !7')
    expect(angleLine(['any'], 'gh#105')).toBe('Any role on gh#105')
  })
})

describe('covers: type × role, as a table', () => {
  const review = [rule(['mr', 'pr'], ['reviewer'])]
  const anyIssue = [rule(['issue'])]
  test.each([
    ['a reviewer list on a PR read as reviewer', review, 'gh#200', ['reviewer'], 'yes'],
    ['a reviewer list on a PR read as author', review, 'gh#200', ['author'], 'no'],
    ['a reviewer list on a PR read from any role', review, 'gh#200', ['any'], 'no'],
    ['a reviewer list on an issue', review, 'gh#105', ['reviewer'], 'no'],
    ['a reviewer list on a GitLab MR', review, '!7', ['reviewer'], 'yes'],
    ['an any-role issue list on an issue, from any angle', anyIssue, 'gh#105', ['author'], 'yes'],
    ['an any-role issue list on a PR', anyIssue, 'gh#200', ['any'], 'no'],
  ] as const)('%s', (_name, rules, ref, as, answer) => {
    expect(covers(rules as Rule[], ref, READ, as as never).answer).toBe(answer)
  })
  test('an MR list is not a PR list', () => {
    expect(covers([rule(['mr'])], 'gh#200', READ, ['any']).answer).toBe('no')
    expect(covers([rule(['pr'])], '!7', READ, ['any']).answer).toBe('no')
    expect(covers([rule(['mr'])], '!7', READ, ['any']).answer).toBe('yes')
  })
  test('says through which roles', () => {
    const both = rule(['mr'], ['reviewer', 'author'])
    expect(covers([both], '!7', READ, ['reviewer', 'author'])).toEqual({ answer: 'yes', rules: [both], roles: ['reviewer', 'author'] })
    expect(covers([both], '!7', READ, ['author'])).toEqual({ answer: 'yes', rules: [both], roles: ['author'] })
  })
  test('unknown when the type is not said and only some of what it may be is covered', () => {
    expect(covers(anyIssue, 'gh#9', NOTHING_READ, ['any'])).toEqual({ answer: 'unknown', why: 'kind' })
    /* Covered whatever it turns out to be: no type needed. */
    expect(covers([rule(['issue', 'pr'])], 'gh#9', NOTHING_READ, ['any']).answer).toBe('yes')
  })
  test('an epic’s: the refs that epic names, and unknown for an epic nobody read', () => {
    const thesis = [rule(['issue'], ['any'], 'thesis')]
    expect(covers(thesis, 'gh#105', { ...READ, epics: { thesis: ['gh#105'] } }, ['any']).answer).toBe('yes')
    expect(covers(thesis, 'gh#106', { ...READ, epics: { thesis: ['gh#105'] } }, ['any']).answer).toBe('no')
    expect(covers(thesis, 'gh#105', READ, ['any'])).toEqual({ answer: 'unknown', why: 'epic' })
  })
  test('a paper: a list for papers, of the project or of that epic', () => {
    expect(coversPaper([rule(['paper'])], 'thesis', ['any'])?.answer).toBe('yes')
    expect(coversPaper([rule(['paper'], ['author'])], 'thesis', ['any'])).toBeNull()
    expect(coversPaper([rule(['paper'], ['author'])], 'thesis', ['author'])?.roles).toEqual(['author'])
    expect(coversPaper([rule(['paper'], ['any'], 'other')], 'thesis', ['any'])).toBeNull()
    expect(coversPaper([rule(['issue'])], 'thesis', ['any'])).toBeNull()
  })
})

describe('#31’s standing holds become type × any role', () => {
  test('every issue is issue × any, every change is merge request + pull request × any, epic and time kept', () => {
    expect(migrateStanding([{ of: 'issue', since: 'a' }, { of: 'change', epic: 'thesis', since: 'b' }, { of: 'bug', since: 'c' }])).toEqual([
      { types: ['issue'], roles: ['any'], since: 'a' },
      { types: ['mr', 'pr'], roles: ['any'], epic: 'thesis', since: 'b' },
    ])
  })

  test('a lists.json from #31 is read as the rules, shows the same lists on the same refs, and is written as rules', () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(
      join(folder(), 'lists.json'),
      JSON.stringify({
        layout: 2,
        checklists: {
          a1: { id: 'a1', name: 'What an issue owes', at: 'x', by: 'y', origin: null, items: [{ id: 'i1', text: 'Repro', at: 'x', by: 'y' }], holds: 0, next: 0, standing: [{ of: 'issue', since: '2026-01-01T00:00:00.000Z' }] },
          b2: { id: 'b2', name: 'What a change owes', at: 'x', by: 'y', origin: null, items: [], holds: 0, next: 0, standing: [{ of: 'change', epic: 'thesis', since: '2026-01-02T00:00:00.000Z' }] },
        },
      }),
    )
    expect(checklists(dir).lists.map((one) => one.applies)).toEqual([[target(['mr', 'pr'], ['any'], 'thesis')], [ISSUES]])
    expect(names(front(['gh#105', 'gh#200'], { ...READ, epics: { thesis: ['gh#200'] } }))).toEqual([
      ['What an issue owes', 'gh#105'],
      ['What a change owes', 'gh#200'],
    ])
    /* Any role: whatever the angle. */
    expect(names(front(['gh#105'], READ, 'author'))).toEqual([['What an issue owes', 'gh#105']])
    /* Written as rules the next time anything is written, and `standing` is gone. */
    ok(change({ op: 'rename', id: 'a1', name: 'What every issue owes', by: 'a test' }, dir))
    const file = JSON.parse(readFileSync(join(folder(), 'lists.json'), 'utf8')) as { checklists: Record<string, { standing?: unknown; applies?: unknown }> }
    expect(file.checklists.a1!.standing).toBeUndefined()
    expect(file.checklists.a1!.applies).toEqual([{ types: ['issue'], roles: ['any'], since: '2026-01-01T00:00:00.000Z' }])
    expect(file.checklists.b2!.applies).toEqual([{ types: ['mr', 'pr'], roles: ['any'], epic: 'thesis', since: '2026-01-02T00:00:00.000Z' }])
  })
})

describe('a list that applies by type × role', () => {
  test('a new item picks it up, with nothing written per item', () => {
    const { list } = made('What a review owes', ['Read the diff'])
    const held = ok(change({ op: 'hold', id: list, target: target(['mr', 'pr'], ['reviewer']), by: 'a test' }, dir))
    expect(held.said).toContain('now applies to merge requests and pull requests · as reviewer')
    const file = JSON.parse(readFileSync(join(folder(), 'lists.json'), 'utf8')) as { checklists: Record<string, { applies?: unknown[] }> }
    expect(file.checklists[list]!.applies).toHaveLength(1)
    expect(existsSync(join(folder(), 'targets', list))).toBe(false)

    /* gh#200 is a PR the person reviews: the list is in front as gh#200, through the rule, as reviewer. */
    const got = front(['gh#200'])
    expect(got.instances).toHaveLength(1)
    expect(got.instances[0]!.target).toEqual({ kind: 'ref', ref: 'gh#200' })
    expect(got.instances[0]!.through).toEqual([target(['mr', 'pr'], ['reviewer'])])
    expect(got.instances[0]!.as).toEqual(['reviewer'])
    expect(got.items).toEqual([{ target: { kind: 'ref', ref: 'gh#200' }, type: 'pr', as: ['reviewer'], elsewhere: [] }])
    /* An issue is not a change. */
    expect(front(['gh#105']).instances).toEqual([])
    expect(holds(list, target(['mr', 'pr'], ['reviewer']), dir)).toBe(true)
    expect(targetsOf(list, dir)[0]).toEqual({ target: target(['mr', 'pr'], ['reviewer']), done: 0 })
    expect(checklists(dir).lists[0]!.applies).toEqual([target(['mr', 'pr'], ['reviewer'])])
  })

  test('the default angle is the person’s role from myRoles; another angle hides the list and says it is there', () => {
    const { list } = made('What a review owes', ['Read the diff'])
    ok(change({ op: 'hold', id: list, target: target(['pr'], ['reviewer']), by: 'a test' }, dir))
    expect(front(['gh#200'], READ, 'auto').instances).toHaveLength(1)
    expect(front(['gh#200'], READ, 'reviewer').instances).toHaveLength(1)
    const asAuthor = front(['gh#200'], READ, 'author')
    expect(asAuthor.instances).toEqual([])
    expect(asAuthor.items[0]).toMatchObject({ as: ['author'], elsewhere: ['reviewer'] })
    /* Roles unknown: any role, and the reviewer list is elsewhere. */
    const unknown = front(['gh#200'], { ...READ, roles: {} }, 'auto')
    expect(unknown.instances).toEqual([])
    expect(unknown.items[0]).toMatchObject({ as: ['any'], elsewhere: ['reviewer'] })
  })

  test('several roles: each role’s lists, each saying through which, and a list for any role once', () => {
    const asAuthor = made('Before asking for review', ['Description says why']).list
    const asReviewer = made('What a review owes', ['Read the diff']).list
    const anyone = made('What every MR owes', ['Pipeline green']).list
    ok(change({ op: 'hold', id: asAuthor, target: target(['mr'], ['author']), by: 'a test' }, dir))
    ok(change({ op: 'hold', id: asReviewer, target: target(['mr'], ['reviewer']), by: 'a test' }, dir))
    ok(change({ op: 'hold', id: anyone, target: target(['mr']), by: 'a test' }, dir))
    /* !7: the person is its author and a reviewer. */
    const got = front(['!7'])
    expect(got.items[0]!.as).toEqual(['reviewer', 'author'])
    expect(got.instances.map((one) => [one.checklist.name, one.as])).toEqual([
      ['Before asking for review', ['author']],
      ['What a review owes', ['reviewer']],
      ['What every MR owes', ['any']],
    ])
    /* As assignee only: just the list for any role, and the others are elsewhere. */
    const assignee = front(['!7'], READ, 'assignee')
    expect(names(assignee)).toEqual([['What every MR owes', '!7']])
    expect(assignee.items[0]!.elsewhere).toEqual(['reviewer', 'author'])
  })

  test('a paper is an item when one is picked, and a list for papers is in front of it as the paper', () => {
    const { list, items } = made('What a chapter owes', ['Cites its sources'])
    ok(change({ op: 'hold', id: list, target: target(['paper']), by: 'a test' }, dir))
    expect(inFront({ ladders: [], selection: [], read: READ, paper: null }, dir).instances).toEqual([])
    const got = inFront({ ladders: [PAPER], selection: [], read: READ, paper: 'thesis' }, dir)
    expect(got.instances.map((one) => one.target)).toEqual([{ kind: 'paper', epic: 'thesis', section: null }])
    expect(got.items).toEqual([{ target: { kind: 'paper', epic: 'thesis', section: null }, type: 'paper', as: ['any'], elsewhere: [] }])
    /* Ticked as the paper, holding nothing. */
    const ticked = ok(change({ op: 'tick', id: list, item: items[0]!, target: { kind: 'paper', epic: 'thesis', section: null }, done: true, by: 'a test' }, dir))
    expect(ticked.said).toContain('was not held on its own')
    expect(holds(list, { kind: 'paper', epic: 'thesis', section: null }, dir)).toBe(false)
  })

  test('per-item ticks stay separate, under each item’s own key, whatever the angle, and a tick holds no ref', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction', 'Has a label'])
    ok(change({ op: 'hold', id: list, target: ISSUES, by: 'a test' }, dir))
    const ticked = ok(change({ op: 'tick', id: list, item: items[0]!, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    expect(ticked.said).toContain('was not held on its own')

    const got = front(['gh#105', 'gh#106'])
    const on = (ref: string) => got.instances.find((one) => one.target?.kind === 'ref' && one.target.ref === ref)!
    expect(on('gh#105').done).toBe(1)
    expect(on('gh#106').done).toBe(0)
    /* The same ticks from another angle. */
    expect(front(['gh#105'], READ, 'author').instances[0]!.done).toBe(1)
    expect(checklists(dir).lists[0]!.targets).toBe(0)
    expect(holds(list, { kind: 'ref', ref: 'gh#105' }, dir)).toBe(false)
    const row = usage(dir).lists[0]!
    expect(row.held).toBe(1)
    expect(row.released).toBe(0)
  })

  test('Purge never takes ticks a rule is still in front of as released ones', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: ISSUES, by: 'a test' }, dir))
    ok(change({ op: 'tick', id: list, item: items[0]!, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    const later = Date.now() + 400 * 86_400_000
    const kept = preview(dir, { scope: 'released', days: 1 }, null, later)
    expect(kept.ok && kept.value.targets).toBe(0)
    ok(change({ op: 'release', id: list, target: ISSUES, by: 'a test' }, dir))
    const gone = preview(dir, { scope: 'released', days: 1 }, null, later)
    expect(gone.ok && gone.value.targets).toBe(1)
  })

  test('removing the rule keeps the ticks, and applying again brings them back', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: ISSUES, by: 'a test' }, dir))
    ok(change({ op: 'tick', id: list, item: items[0]!, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    const released = ok(change({ op: 'release', id: list, target: ISSUES, by: 'a test' }, dir))
    expect(released.said).toContain('no longer applies to issues · any role')
    expect(released.said).toContain('kept')
    expect(front(['gh#105']).instances).toEqual([])
    const row = usage(dir).lists[0]!
    expect(row.ticks).toBe(1)
    expect(row.released).toBe(1)
    expect(readdirSync(join(folder(), 'targets', list)).length).toBe(1)
    ok(change({ op: 'hold', id: list, target: ISSUES, by: 'a test' }, dir))
    expect(front(['gh#105']).instances[0]!.done).toBe(1)
  })

  test('applies replaces every rule at once, keeps when a rule was made, takes task and refuses nonsense', () => {
    const { list } = made('What a change owes', ['Has tests'])
    ok(change({ op: 'applies', id: list, rules: [{ types: ['mr'], roles: ['reviewer'] }], by: 'a test' }, dir))
    const since = (JSON.parse(readFileSync(join(folder(), 'lists.json'), 'utf8')) as { checklists: Record<string, { applies: { since: string }[] }> }).checklists[list]!.applies[0]!.since
    const both = ok(change({ op: 'applies', id: list, rules: [{ types: ['mr'], roles: ['reviewer'] }, { types: ['pr', 'issue'], roles: ['author', 'any'], epic: 'thesis' }], by: 'a test' }, dir))
    expect(both.said).toBe('"What a change owes" applies to merge requests · as reviewer; issues and pull requests of thesis · any role')
    const file = JSON.parse(readFileSync(join(folder(), 'lists.json'), 'utf8')) as { checklists: Record<string, { applies: { since: string }[] }> }
    expect(file.checklists[list]!.applies[0]!.since).toBe(since)
    const task = ok(change({ op: 'applies', id: list, rules: [{ types: ['task'] }], by: 'a test' }, dir))
    expect(task.said).toContain('applies to tasks · any role')
    expect(change({ op: 'applies', id: list, rules: [{ types: ['merge'] }], by: 'a test' }, dir).ok).toBe(false)
    expect(change({ op: 'applies', id: list, rules: [{ types: ['mr'], roles: ['owner'] }], by: 'a test' }, dir).ok).toBe(false)
    const none = ok(change({ op: 'applies', id: list, rules: [], by: 'a test' }, dir))
    expect(none.said).toContain('applies to no type of item now')
  })

  test('a list made with its rule said at once', () => {
    const made_ = ok(change({ op: 'create', name: 'Merge requests as reviewer', rule: { types: ['mr'], roles: ['reviewer'] }, by: 'a test' }, dir))
    expect(made_.said).toContain('applying to merge requests · as reviewer')
    expect(checklists(dir).lists[0]!.applies).toEqual([target(['mr'], ['reviewer'])])
  })

  test('an unknown type is said, not guessed', () => {
    const { list } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: ISSUES, by: 'a test' }, dir))
    const got = front(['gh#9'], NOTHING_READ)
    expect(got.instances).toEqual([])
    expect(got.items[0]!.type).toBeNull()
    expect(got.undecided).toEqual([{ ref: 'gh#9', why: 'kind', lists: ['What an issue owes'] }])
    expect(undecidedLine(got.undecided)).toBe(
      'The tracker has not said what kind of item gh#9 is, so “What an issue owes” is not shown for it until it does.',
    )
  })

  test('one epic’s: only the refs the epic names', () => {
    const { list } = made('What a thesis issue owes', ['Cites the chapter'])
    ok(change({ op: 'hold', id: list, target: target(['issue'], ['any'], 'thesis'), by: 'a test' }, dir))
    const read: RefsRead = { ...READ, epics: { thesis: ['gh#105'] } }
    expect(front(['gh#105', 'gh#106'], read).instances.map((one) => one.target)).toEqual([{ kind: 'ref', ref: 'gh#105' }])
  })

  test('a tick against the rule itself is refused: ticks are per item', () => {
    const { list, items } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: ISSUES, by: 'a test' }, dir))
    expect(change({ op: 'tick', id: list, item: items[0]!, target: ISSUES, done: true, by: 'a test' }, dir).ok).toBe(false)
  })

  test('a ref held by hand keeps its own hold and is not said to be through a rule', () => {
    const { list } = made('What an issue owes', ['Has a reproduction'])
    ok(change({ op: 'hold', id: list, target: ISSUES, by: 'a test' }, dir))
    ok(change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#105' }, by: 'a test' }, dir))
    const got = front(['gh#105'])
    expect(got.instances).toHaveLength(1)
    expect(got.instances[0]!.through).toBeUndefined()
  })

  test('an issue list and a change list each keep to their type', () => {
    const issues = made('What an issue owes', ['Has a reproduction']).list
    const changes = made('What a change owes', ['Has tests']).list
    ok(change({ op: 'hold', id: issues, target: ISSUES, by: 'a test' }, dir))
    ok(change({ op: 'hold', id: changes, target: CHANGES, by: 'a test' }, dir))
    expect(names(front(['gh#105', 'gh#200']))).toEqual([
      ['What an issue owes', 'gh#105'],
      ['What a change owes', 'gh#200'],
    ])
  })
})

describe('lines just for one item', () => {
  test('are added on a list of that item’s own, shown with it last, and ticked with its ticks', () => {
    const shared = made('What an issue owes', ['Has a reproduction']).list
    ok(change({ op: 'hold', id: shared, target: ISSUES, by: 'a test' }, dir))
    const added = ok(change({ op: 'add-for', target: { kind: 'ref', ref: 'gh#105' }, text: 'Ask Sam about the flaky test', by: 'a test' }, dir))
    expect(added.said).toContain('just for gh#105')
    const own = added.id
    expect(checklists(dir).lists.find((one) => one.id === own)).toMatchObject({ name: 'Only for gh#105', only: 'ref:gh#105', items: 1 })
    /* A second line lands on the same list. */
    const second = ok(change({ op: 'add-for', target: { kind: 'ref', ref: 'gh#105' }, text: 'Link the design note', by: 'a test' }, dir))
    expect(second.id).toBe(own)

    const got = front(['gh#105', 'gh#106'])
    expect(names(got)).toEqual([
      ['Only for gh#105', 'gh#105'],
      ['What an issue owes', 'gh#105'],
      ['What an issue owes', 'gh#106'],
    ])
    /* From any angle: they are the item's. */
    expect(names(front(['gh#105'], READ, 'reviewer')).map((one) => one[0])).toContain('Only for gh#105')

    /* Ticked like any line, under the item's key. */
    const item = got.instances[0]!.rows[0]!.item.id
    ok(change({ op: 'tick', id: own, item, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    expect(front(['gh#105']).instances.find((one) => one.checklist.id === own)!.done).toBe(1)
  })

  test('are kept when the lists that apply change, can be reworded and dropped, and go with their last line', () => {
    const shared = made('What an issue owes', ['Has a reproduction']).list
    ok(change({ op: 'hold', id: shared, target: ISSUES, by: 'a test' }, dir))
    const own = ok(change({ op: 'add-for', target: { kind: 'ref', ref: 'gh#105' }, text: 'Ask Sam', by: 'a test' }, dir)).id
    const item = front(['gh#105']).instances.find((one) => one.checklist.id === own)!.rows[0]!.item.id
    ok(change({ op: 'tick', id: own, item, target: { kind: 'ref', ref: 'gh#105' }, done: true, by: 'a test' }, dir))
    /* The standing list goes; the item's own lines and their tick stay. */
    ok(change({ op: 'release', id: shared, target: ISSUES, by: 'a test' }, dir))
    ok(change({ op: 'forget', id: shared, by: 'a test' }, dir))
    const left = front(['gh#105'])
    expect(names(left)).toEqual([['Only for gh#105', 'gh#105']])
    expect(left.instances[0]!.done).toBe(1)
    /* Reworded, the tick kept. */
    ok(change({ op: 'reword', id: own, item, text: 'Ask Sam about the flaky test', by: 'a test' }, dir))
    expect(front(['gh#105']).instances[0]!.rows[0]).toMatchObject({ item: { text: 'Ask Sam about the flaky test' }, done: { state: 'passed' } })
    /* Not a list to name, hold or give types. */
    expect(change({ op: 'rename', id: own, name: 'x', by: 'a test' }, dir).ok).toBe(false)
    expect(change({ op: 'hold', id: own, target: ISSUES, by: 'a test' }, dir).ok).toBe(false)
    /* Dropped: its last line takes the list. */
    const dropped = ok(change({ op: 'drop', id: own, item, by: 'a test' }, dir))
    expect(dropped.said).toContain('the last line just for that item')
    expect(checklists(dir).lists).toEqual([])
    expect(front(['gh#105']).instances).toEqual([])
  })

  test('a paper can have them too; a rule cannot', () => {
    const paper = ok(change({ op: 'add-for', target: { kind: 'paper', epic: 'thesis', section: null }, text: 'Ask the supervisor', by: 'a test' }, dir))
    expect(paper.said).toContain('just for thesis (the paper)')
    expect(inFront({ ladders: [PAPER], selection: [], paper: 'thesis' }, dir).instances.map((one) => one.checklist.name)).toEqual(['Only for thesis (the paper)'])
    expect(change({ op: 'add-for', target: ISSUES, text: 'x', by: 'a test' }, dir).ok).toBe(false)
  })

  test('an agent may add and tick them, and never change a person’s tick', () => {
    const own = ok(change({ op: 'add-for', target: { kind: 'ref', ref: '!7' }, text: 'Squash before merge', by: 'claude', viaMcp: true }, dir)).id
    const item = front(['!7']).instances[0]!.rows[0]!.item.id
    ok(change({ op: 'tick', id: own, item, target: { kind: 'ref', ref: '!7' }, done: true, by: 'the owner' }, dir))
    const refused = change({ op: 'tick', id: own, item, target: { kind: 'ref', ref: '!7' }, done: false, by: 'claude', viaMcp: true }, dir)
    expect(refused.ok).toBe(false)
  })

  test('do not count towards the lists a project may hold', () => {
    for (let n = 0; n < 3; n += 1) ok(change({ op: 'add-for', target: { kind: 'ref', ref: `gh#${n + 1}` }, text: 'x', by: 'a test' }, dir))
    expect(checklists(dir).lists.filter((one) => one.only)).toHaveLength(3)
  })
})

describe('the empty sentences', () => {
  test('nothing picked', () => {
    expect(NOTHING_PICKED).toBe('Pick an issue, MR, PR or paper to see its checklists.')
  })
  test('nothing applies, from the angle', () => {
    expect(nothingLine('!123', ['reviewer'])).toBe('No checklist applies to !123 as reviewer.')
    expect(nothingLine('gh#105', ['any'])).toBe('No checklist applies to gh#105 for any role.')
  })
})

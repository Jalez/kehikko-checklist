import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'

/**
 * The one-time, idempotent migration of the hand-written paper lists.
 *
 * The derived, ref-scoped machinery was deleted rather than migrated, and that
 * was safe because nobody typed it: its items were `case` arms and shipped
 * wording, and the ticks against them were ticks on a program's own opinion.
 * These are the opposite. Every line on a paper list is a sentence a person
 * wrote about their own document, and under the new model such a list is not a
 * special kind of thing at all — it is an ordinary checklist held against a
 * paper target.
 *
 * So the promise this file exists to keep is narrow and absolute: a
 * `papers.json` written by the program that existed yesterday opens as
 * checklists today, with nothing lost and nothing duplicated.
 */
let dir = ''

/** A `papers.json` in the shape the deleted store actually wrote. */
const YESTERDAY = {
  papers: {
    'modes-are-modules': {
      items: [
        {
          id: 'a1b2c3d4',
          text: 'The bridge chapter still claims the wire is synchronous, and it has not been since the mailbox landed.',
          at: '2026-08-20T09:14:02.001Z',
          by: 'the owner, on this app’s own page',
          done: null,
        },
        {
          id: 'e5f6a7b8',
          text: 'Extraction needs the paragraph about what a module owns, which is currently only in the commit message.',
          at: '2026-08-20T09:15:40.552Z',
          by: 'the owner, on this app’s own page',
          done: {
            at: '2026-08-22T11:02:19.113Z',
            by: 'claude',
            viaMcp: true,
            note: 'Added as §3.2; the commit message is now a summary of it rather than the only copy.',
          },
        },
      ],
    },
    'practices-are-the-only-governor': {
      items: [
        {
          id: 'c9d0e1f2',
          text: 'Say what a frozen word costs, with the example that made somebody freeze one.',
          at: '2026-08-25T16:41:00.000Z',
          by: 'the owner, on this app’s own page',
          done: null,
        },
      ],
    },
    /* An epic somebody cleared. The old store deleted such a key on write, but a
       file could still hold one — and an empty list migrating into an empty
       checklist would put a name on the pick screen that means nothing. */
    'nothing-written-here': { items: [] },
  },
}

/**
 * `dir` is a PROJECT, and `papers.json` is inside this module's own folder.
 *
 * The migration reads the old paper store from wherever this app's store now
 * lives, which is inside the project. A migration that went on looking beside
 * the program would find nothing on every machine where the data has moved — so
 * the file moves with the rest, and this is what says so.
 */
let mine = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-migration-'))
  mine = join(dir, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(mine, { recursive: true })
  writeFileSync(join(mine, 'papers.json'), `${JSON.stringify(YESTERDAY, null, 2)}\n`)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The store file for the project under test. */
function file(): string {
  return join(mine, 'checklists.json')
}

async function store() {
  return import('../list/checklists.ts')
}

describe('a papers.json from yesterday', () => {
  test('opens as checklists today, one per paper that had anything written on it', async () => {
    const { checklists } = await store()
    const names = checklists(dir).lists.map((l) => l.name)
    expect(names).toContain('modes-are-modules — what the paper owes')
    expect(names).toContain('practices-are-the-only-governor — what the paper owes')
    /* And nothing for the epic somebody cleared: an empty list is a paper with no
       list, not a list with no items. */
    expect(names.some((n) => n.startsWith('nothing-written-here'))).toBe(false)
  })

  test('loses nothing somebody typed, in the order they put it in', async () => {
    const { held } = await store()
    const rows = held('paper-modes-are-modules', null, dir).held!.rows
    expect(rows.map((r) => r.item.text)).toEqual([
      YESTERDAY.papers['modes-are-modules'].items[0]!.text,
      YESTERDAY.papers['modes-are-modules'].items[1]!.text,
    ])
    /* Ids are kept, so an agent holding one from before the migration still
       addresses the same line. */
    expect(rows.map((r) => r.item.id)).toEqual(['a1b2c3d4', 'e5f6a7b8'])
  })

  test('keeps the tick, with who made it, when, whether it came over MCP, and the note', async () => {
    const { held } = await store()
    const on = held('paper-modes-are-modules', { kind: 'paper', epic: 'modes-are-modules', section: null }, dir).held!
    expect(on.done).toBe(1)
    const tick = on.rows[1]!.done
    expect(tick?.by).toBe('claude')
    expect(tick?.viaMcp).toBe(true)
    expect(tick?.at).toBe('2026-08-22T11:02:19.113Z')
    expect(tick?.note).toContain('§3.2')
  })

  test('comes across HELD against its paper, ticks or no ticks, because that was what the old key meant', async () => {
    /* The list with a tick and the list without one are both about their
       paper — the old store was keyed by epic — so both are shown to a reader
       in that paper, which is what being held against it means now. */
    const { targetsOf } = await store()
    expect(targetsOf('paper-modes-are-modules', dir)).toEqual([
      { target: { kind: 'paper', epic: 'modes-are-modules', section: null }, done: 1 },
    ])
    expect(targetsOf('paper-practices-are-the-only-governor', dir)).toEqual([
      { target: { kind: 'paper', epic: 'practices-are-the-only-governor', section: null }, done: 0 },
    ])
  })

  test('files the ticks against the WHOLE paper, because the old store never named a section', async () => {
    /* Inventing a section here would be the migration claiming to know something
       the file never said — and it would put ticks on a target nobody can find. */
    const { held } = await store()
    expect(held('paper-modes-are-modules', { kind: 'paper', epic: 'modes-are-modules', section: 'ch:bridge' }, dir).held!.done).toBe(0)
  })

  test('is idempotent: reading twenty times makes one copy, not twenty', async () => {
    const { checklists } = await store()
    for (let i = 0; i < 20; i += 1) checklists(dir)
    const mine = checklists(dir).lists.filter((l) => l.name.startsWith('modes-are-modules'))
    expect(mine).toHaveLength(1)
  })

  test('leaves papers.json on disk, because deleting somebody’s file as a side effect of reading is not a thing a program should do', async () => {
    const { checklists } = await store()
    checklists(dir)
    expect(JSON.parse(readFileSync(join(mine, 'papers.json'), 'utf8'))).toEqual(YESTERDAY)
  })

  test('does not run when the checklists file cannot be parsed', async () => {
    /* Writing somebody's paper lists into a store this app has just failed to
       read would flatten whatever is in it. The order inside `read()` is what
       stops that, and this is what asserts the order. */
    const { checklists } = await store()
    const broken = '{ half a file'
    writeFileSync(file(), broken)
    expect(checklists(dir).trouble).toContain('could not be read')
    expect(readFileSync(file(), 'utf8')).toBe(broken)
  })

  test('shrugs at an unreadable papers.json rather than refusing to open the checklists', async () => {
    /* `papers.json` is a backup now: nothing writes it and nothing else reads
       it. A broken one must not be able to disable the app. */
    const { change, checklists } = await store()
    writeFileSync(join(mine, 'papers.json'), 'not json at all')
    expect(checklists(dir).trouble).toBeNull()
    expect(change({ op: 'create', name: 'Made after', by: 'a test' }, dir).ok).toBe(true)
  })

  test('a list migrated on one machine and one copied from another are the same list, not two', async () => {
    /* The id is derived from the epic rather than random, which is what makes
       `data/` copyable between machines — the claim `store.ts` makes about this
       whole directory. */
    const { checklists } = await store()
    expect(checklists(dir).lists.map((l) => l.id)).toContain('paper-modes-are-modules')
  })
})

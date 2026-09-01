import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'

import { checklists } from '../list/checklists.ts'
import { apply, oldStore, plan, setAside } from '../dev/migrate.ts'

/**
 * Moving the old store into a project, without losing anything on the way.
 *
 * A migration nobody tested is a migration nobody can rerun — and this one is
 * the only path by which every checklist somebody has already written gets from
 * `data/checklists.json` into the project it belongs to. So what is asserted
 * here is not that the script runs: it is the ORDER (copy, verify off disk, and
 * only then set the original aside) and the refusals, because those are what
 * stop a half-done migration leaving somebody's lists in two places with nothing
 * to say which is current.
 */

/** A store in the shape the old `data/checklists.json` actually holds. */
const YESTERDAY = {
  checklists: {
    c6099fab: {
      id: 'c6099fab',
      name: 'Thesis paper checklist',
      at: '2026-08-20T09:14:02.001Z',
      by: 'the owner, on this app’s own page',
      origin: null,
      items: [],
    },
    a49506e4: {
      id: 'a49506e4',
      name: 'What Chapter 1 (Introduction) owes before the thesis is submitted',
      at: '2026-08-21T10:00:00.000Z',
      by: 'the owner, on this app’s own page',
      origin: null,
      items: [
        { id: 'i1', text: 'Say what the thesis claims, in one sentence', at: '2026-08-21T10:00:00.000Z', by: 'the owner' },
        { id: 'i2', text: 'Name the gap it fills', at: '2026-08-21T10:01:00.000Z', by: 'the owner' },
      ],
    },
  },
  ticks: {
    a49506e4: {
      'paper:thesis': {
        i1: { at: '2026-08-22T11:02:19.113Z', by: 'claude', viaMcp: true, note: 'Added as §1.1.' },
      },
    },
  },
}

let data = ''
let project = ''

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'checklist-olddata-'))
  project = mkdtempSync(join(tmpdir(), 'checklist-target-'))
  writeFileSync(oldStore(data), `${JSON.stringify(YESTERDAY, null, 2)}\n`)
})

afterEach(() => {
  rmSync(data, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

/**
 * Where the store lands — under the project's REAL path.
 *
 * `realpathSync` is why this is not simply `join(project, …)`: on macOS a temp
 * directory under `/var` resolves to `/private/var`, and the resolved form is
 * what `store.ts` returns because resolving is what the fence is built on. A
 * test that expected the unresolved string would be asserting that the fence
 * had not run.
 *
 * `moduleFolder(ID)` rather than the literal `checklist`, for the same reason
 * `store.ts` does not type it either: the folder is named after this module, the
 * derivation is the protocol package's, and a test that hardcoded the answer
 * would go on passing if the derivation ever changed underneath it.
 */
const mine = () => join(KEHIKOT_DIR, moduleFolder(ID))
const landed = () => join(realpathSync(project), mine(), 'checklists.json')

describe('a dry run', () => {
  test('counts what would move and names both paths, without touching anything', () => {
    const intended = plan(data, project)
    expect(intended.refused).toBeNull()
    expect(intended.checklists).toBe(2)
    expect(intended.items).toBe(2)
    expect(intended.ticks).toBe(1)
    expect(intended.to).toBe(landed())
    /* Nothing has happened. That is the whole contract of a dry run: the
       decision is made by somebody looking at the answer, not by somebody who
       ran a command and read the result afterwards. */
    expect(existsSync(join(project, KEHIKOT_DIR))).toBe(false)
    expect(existsSync(oldStore(data))).toBe(true)
  })

  test('refuses the same things an apply would, so the two halves agree', () => {
    rmSync(oldStore(data))
    expect(plan(data, project).refused).toContain('there is no')
    expect(apply(data, project).refused).toContain('there is no')
  })
})

describe('an apply', () => {
  test('lands every checklist, every item and every tick in the project', () => {
    const done = apply(data, project)
    expect(done.refused).toBeNull()
    expect(done.verified).toEqual({ checklists: 2, items: 2, ticks: 1 })

    /* Read back through the app's own reader, not just as JSON: what matters is
       that the store OPENS, not that the bytes arrived. */
    const there = checklists(project)
    expect(there.trouble).toBeNull()
    expect(there.lists.map((l) => l.name).sort()).toEqual([
      'Thesis paper checklist',
      'What Chapter 1 (Introduction) owes before the thesis is submitted',
    ])
  })

  test('keeps the tick whole — who, when, over MCP, and the note', () => {
    apply(data, project)
    const raw = JSON.parse(readFileSync(landed(), 'utf8')) as typeof YESTERDAY
    expect(raw.ticks.a49506e4!['paper:thesis']!.i1).toEqual({
      at: '2026-08-22T11:02:19.113Z',
      by: 'claude',
      viaMcp: true,
      note: 'Added as §1.1.',
    })
  })

  /* The order this file exists to assert. The original is set aside only after
     the new one has been read back off disk and found to hold the same material
     — anything else is a migration that can half-happen. */
  test('sets the original aside only after reading the new one back, and renames rather than deletes', () => {
    const done = apply(data, project)
    expect(done.setAside).toBe(setAside(data))
    expect(existsSync(oldStore(data))).toBe(false)
    expect(existsSync(setAside(data))).toBe(true)
    /* And the set-aside copy is byte-for-byte what was there, so a migration
       that went wrong can be looked at rather than reconstructed. */
    expect(JSON.parse(readFileSync(setAside(data), 'utf8'))).toEqual(YESTERDAY)
  })

  test('leaves the original exactly where it is when the destination will not read back', () => {
    /* `.kehikot` as a symlink out of the project: `store.ts` refuses to resolve
       it, so nothing is written and nothing is renamed. The failure this asserts
       is the dangerous one — a rename that happened anyway would take the only
       copy with it. */
    const elsewhere = mkdtempSync(join(tmpdir(), 'checklist-elsewhere-'))
    try {
      symlinkSync(elsewhere, join(project, KEHIKOT_DIR))
      const done = apply(data, project)
      expect(done.refused).not.toBeNull()
      expect(done.setAside).toBeNull()
      expect(existsSync(oldStore(data))).toBe(true)
      expect(JSON.parse(readFileSync(oldStore(data), 'utf8'))).toEqual(YESTERDAY)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  /* This asked that a migration told the project's `.gitignore` about the folder
     it had just made. It does not any more: whether that folder is committed is
     a checkbox in the host, per project, and a migration that quietly added an
     ignore to every project it touched would be the old behaviour in a hat. */
  test('leaves the project’s .gitignore exactly as it was', () => {
    mkdirSync(join(project, '.git'))
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')
    apply(data, project)
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe('node_modules\n')
  })
})

describe('running it twice', () => {
  test('does nothing the second time, and says so rather than failing silently', () => {
    expect(apply(data, project).refused).toBeNull()
    const again = apply(data, project)
    /* The old file is gone, so there is nothing to move. Not an error worth
       shouting about, and not a second copy either. */
    expect(again.refused).toContain('Nothing to do')
    expect(checklists(project).lists).toHaveLength(2)
  })

  test('refuses to write over a destination that already holds checklists', () => {
    /* Merging two stores would need a rule for two lists with one id, and every
       such rule quietly prefers one person's wording over another's. So it
       refuses and says which file to look at. */
    apply(data, project)
    writeFileSync(oldStore(data), `${JSON.stringify(YESTERDAY, null, 2)}\n`)
    const again = apply(data, project)
    expect(again.refused).toContain('already holds 2 checklist(s)')
    expect(existsSync(oldStore(data))).toBe(true)
  })

  test('writes into a destination that exists but is empty, because that is not somebody’s work', () => {
    mkdirSync(join(project, mine()), { recursive: true })
    writeFileSync(landed(), JSON.stringify({ checklists: {}, ticks: {} }))
    expect(apply(data, project).refused).toBeNull()
    expect(checklists(project).lists).toHaveLength(2)
  })
})

describe('what it will not do', () => {
  test('refuses a project it cannot write under, and moves nothing', () => {
    const out = apply(data, join(project, 'not-a-real-folder'))
    expect(out.refused).not.toBeNull()
    expect(existsSync(oldStore(data))).toBe(true)
  })

  test('refuses an old store that will not parse, and says every checklist in it is still there', () => {
    writeFileSync(oldStore(data), '{ half a file')
    const out = plan(data, project)
    expect(out.refused).toContain('could not be read')
    expect(out.refused).toContain('still there')
    expect(apply(data, project).setAside).toBeNull()
  })
})

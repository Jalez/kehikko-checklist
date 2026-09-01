import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'

import { change, checklists } from '../list/checklists.ts'
import { dataFile, makeDir } from '../store.ts'

/**
 * Where the store is, when it refuses to be anywhere, and what it does to
 * somebody's `.gitignore`.
 *
 * These are the four things the move into the project introduced, and none of
 * them was testable before it — there was one directory, named by an
 * environment variable, and nothing to resolve. Now a path arrives over the
 * wire and becomes a directory, so every one of these is a test about a failure
 * with a real cost: a file in the wrong project, a write into a guessed folder,
 * a symlink out of the project, and a line appended twice to a file the user
 * owns.
 */

/** A project, and somewhere outside every project, for the fence. */
let project = ''
let outside = ''

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'checklist-project-'))
  outside = mkdtempSync(join(tmpdir(), 'checklist-outside-'))
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

/**
 * The two levels this module writes under: `.kehikot/`, and `checklist/` inside
 * it.
 *
 * `moduleFolder(ID)` rather than the literal `checklist`, for the same reason
 * `store.ts` does not type it either — the folder is named after this module and
 * the derivation belongs to the protocol package. A test that hardcoded the
 * answer would go on passing if that derivation changed underneath it, which is
 * the one way this could break without anybody noticing.
 */
const kehikot = () => join(project, KEHIKOT_DIR)
const mine = () => join(kehikot(), moduleFolder(ID))

describe('where a checklist lives', () => {
  test('is .kehikot/checklist/checklists.json inside the project, and nowhere else', async () => {
    const made = change({ op: 'create', name: 'What a change owes', by: 'a test' }, project)
    expect(made.ok).toBe(true)
    expect(existsSync(join(mine(), 'checklists.json'))).toBe(true)
    const raw = JSON.parse(readFileSync(join(mine(), 'checklists.json'), 'utf8')) as {
      checklists: Record<string, { name: string }>
    }
    expect(Object.values(raw.checklists)[0]?.name).toBe('What a change owes')
  })

  /* The path is the partition. Two projects are two files, not two subsets of
     one, so a store that has never heard of a project cannot show one project's
     lists under another's name. */
  test('two projects are two files, and neither can see the other’s lists', () => {
    const second = mkdtempSync(join(tmpdir(), 'checklist-second-'))
    try {
      change({ op: 'create', name: 'First project’s list', by: 'a test' }, project)
      change({ op: 'create', name: 'Second project’s list', by: 'a test' }, second)
      expect(checklists(project).lists.map((l) => l.name)).toEqual(['First project’s list'])
      expect(checklists(second).lists.map((l) => l.name)).toEqual(['Second project’s list'])
    } finally {
      rmSync(second, { recursive: true, force: true })
    }
  })

  test('reading never creates the folder, so opening a container leaves a repository as it was', () => {
    expect(checklists(project).lists).toEqual([])
    expect(existsSync(mine())).toBe(false)
    /* And the whole project is untouched, not merely the folder. */
    expect(readdirSync(project)).toEqual([])
  })

  test('the folder appears on the first write and not before', () => {
    expect(existsSync(mine())).toBe(false)
    change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    expect(existsSync(mine())).toBe(true)
  })
})

describe('no project is an ordinary state, and never a guessed path', () => {
  test('reads as empty, says so, and is not called trouble', () => {
    const out = checklists(null)
    expect(out.lists).toEqual([])
    expect(out.nowhere).toBe(true)
    /* Not an error. A container that drew "no project open" in the same red box as
       "this file will not parse" would teach a reader that the ordinary state is
       a breakage. */
    expect(out.trouble).toBeNull()
  })

  test('every write is refused, in a sentence saying where a checklist lives', () => {
    const out = change({ op: 'create', name: 'Mine', by: 'a test' }, null)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain('there is no project open')
    expect(out.ok === false && out.error).toContain('.kehikot/checklist')
  })

  /* The failure this whole design exists to not have: a write with no project
     landing SOMEWHERE. Not in this app's folder, not in the working directory,
     not in a temp file — nowhere at all. */
  test('writes nothing anywhere, rather than inventing a location', () => {
    const beside = readdirSync(join(import.meta.dirname, '..'))
    change({ op: 'create', name: 'Mine', by: 'a test' }, null)
    change({ op: 'create', name: 'Mine', by: 'a test' }, undefined)
    change({ op: 'create', name: 'Mine', by: 'a test' }, '')
    change({ op: 'create', name: 'Mine', by: 'a test' }, '   ')
    expect(readdirSync(join(import.meta.dirname, '..'))).toEqual(beside)
    expect(dataFile(null)).toEqual({ path: null, trouble: null })
    expect(makeDir(null)).toEqual({ dir: null, trouble: null })
  })

  test('a relative path is refused rather than resolved against this app’s own folder', () => {
    const out = change({ op: 'create', name: 'Mine', by: 'a test' }, './somewhere')
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain('not an absolute path')
    expect(existsSync(join(import.meta.dirname, '..', 'somewhere'))).toBe(false)
  })

  test('a project that is not on this machine is refused, and named', () => {
    const gone = join(outside, 'never-existed')
    const out = checklists(gone)
    expect(out.nowhere).toBe(false)
    expect(out.trouble).toContain('there is no folder at')
    expect(out.trouble).toContain(gone)
  })

  test('a path with a control character in it is refused, because no real path has one', () => {
    /* Written as an escape rather than as a literal byte, so this file stays
       plain text and the next reader can see what is being tested. */
    expect(checklists(`${project}\u0000/x`).trouble).toContain('control character')
  })
})

describe('the fence, which is checked after realpath and not before', () => {
  /**
   * There are two levels to escape through now, and both are tested.
   *
   * The path this app builds is `<project>/.kehikot/checklist/checklists.json`,
   * which starts with the project and looks perfectly confined however either
   * folder in the middle is redirected. That is the case a string comparison
   * misses entirely, and there are two of them: `.kehikot` itself pointing out
   * of the project, and this module's own folder inside it pointing out. The
   * second is the one that only appeared with the folder-per-module shape.
   */

  test('refuses a .kehikot that resolves outside the project, and writes nothing through it', () => {
    const elsewhere = join(outside, 'not-in-the-project')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, kehikot())

    const out = change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain('outside the project it claims to be inside')
    /* The point of the test: the directory it pointed at is still empty — not
       even this module's folder was made inside it. */
    expect(readdirSync(elsewhere)).toEqual([])
  })

  /* The level the folder-per-module shape added. `.kehikot` is a perfectly
     ordinary directory inside the project and only `checklist/` leaves, which
     the outer check cannot see and `realpath` on the inner one does. */
  test('refuses this module’s own folder resolving outside the project', () => {
    const elsewhere = join(outside, 'not-in-the-project-either')
    mkdirSync(elsewhere)
    mkdirSync(kehikot())
    symlinkSync(elsewhere, mine())

    const out = change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain('outside the project it claims to be inside')
    expect(readdirSync(elsewhere)).toEqual([])
  })

  test('refuses the read too, so a redirected folder cannot show another project’s lists', () => {
    const elsewhere = join(outside, 'someone-elses')
    mkdirSync(elsewhere)
    writeFileSync(
      join(elsewhere, 'checklists.json'),
      JSON.stringify({ checklists: { a: { id: 'a', name: 'Not yours', at: '', by: '', items: [] } }, ticks: {} }),
    )
    mkdirSync(kehikot())
    symlinkSync(elsewhere, mine())

    const out = checklists(project)
    expect(out.lists).toEqual([])
    expect(out.trouble).toContain('outside the project it claims to be inside')
  })

  test('refuses a checklists.json that is itself a symlink out of the project', () => {
    const target = join(outside, 'somebody-elses.json')
    writeFileSync(target, JSON.stringify({ checklists: {}, ticks: {} }))
    mkdirSync(mine(), { recursive: true })
    symlinkSync(target, join(mine(), 'checklists.json'))

    expect(checklists(project).trouble).toContain('outside the project it claims to be inside')
    expect(change({ op: 'create', name: 'Mine', by: 'a test' }, project).ok).toBe(false)
    /* And the file it pointed at still holds what it held. */
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ checklists: {}, ticks: {} })
  })

  /* A folder that is a symlink to a directory INSIDE the project is fine. The
     rule is about leaving the project, not about symlinks, and refusing this
     would be refusing something nobody has a reason to worry about. */
  test('allows a folder that resolves to somewhere still inside the project', () => {
    const inside = join(project, 'somewhere-inside')
    mkdirSync(inside)
    symlinkSync(inside, kehikot())
    expect(change({ op: 'create', name: 'Mine', by: 'a test' }, project).ok).toBe(true)
    expect(existsSync(join(inside, moduleFolder(ID), 'checklists.json'))).toBe(true)
  })
})

describe('the .gitignore this module no longer writes', () => {
  /*
   * This module used to append `.kehikot/` to the project's `.gitignore` the
   * first time it made its folder, and there were seven tests here for how it
   * did it — the walk up to a repository several levels above, the `.git` that
   * is a file in a worktree, the rule covering the whole folder rather than
   * this module's part of it. They are gone with the behaviour.
   *
   * It was four programs writing one line in somebody else's repository —
   * checklist, notes, journeys and learning's migration — none able to take it
   * back, none aware of the others, and the rule appearing the first time a
   * module happened to save something. Whether that folder is committed is a
   * checkbox in the host now, per project, with one writer: `shareKehikot` in
   * the host's `server/projects.ts`. The walk up is not lost; the host does it,
   * for the reason argued here, about the same thesis.
   *
   * What remains asserts this module keeps its hands off, because "we removed
   * some code" is not a property and the way this comes back is somebody
   * restoring a helper that looks harmless on its own.
   */
  test('saving a checklist leaves a repository’s .gitignore alone', () => {
    mkdirSync(join(project, '.git'), { recursive: true })
    makeDir(project)
    expect(existsSync(join(project, '.gitignore'))).toBe(false)
  })

  test('and does not touch one that is already there', () => {
    mkdirSync(join(project, '.git'), { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')
    makeDir(project)
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe('node_modules\n')
  })
})

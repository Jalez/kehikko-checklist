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

describe('the project’s .gitignore', () => {
  const gitignore = () => join(project, '.gitignore')

  /** Make the project look like a git repository, without running git. */
  function repo(existing: string | null = null): void {
    mkdirSync(join(project, '.git'))
    if (existing !== null) writeFileSync(gitignore(), existing)
  }

  test('gains the rule once, with a comment saying what the folder is', () => {
    repo('node_modules\ndist\n')
    change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    const after = readFileSync(gitignore(), 'utf8')
    expect(after.startsWith('node_modules\ndist\n')).toBe(true)
    expect(after).toContain(`${KEHIKOT_DIR}/`)
    /* The comment is the part that stops somebody deleting a rule they cannot
       explain, six months from now, in their own file. */
    expect(after).toContain('Remove these lines to')
  })

  /* The one that matters most, because this file is in the user's repository and
     a second copy would show up in their next diff as a change they did not
     make. */
  test('is not appended to twice, however many writes follow', () => {
    repo('node_modules\n')
    change({ op: 'create', name: 'One', by: 'a test' }, project)
    const once = readFileSync(gitignore(), 'utf8')
    change({ op: 'create', name: 'Two', by: 'a test' }, project)
    change({ op: 'add', id: checklists(project).lists[0]!.id, text: 'x', by: 'a test' }, project)
    expect(readFileSync(gitignore(), 'utf8')).toBe(once)
    expect(once.split(`${KEHIKOT_DIR}/`)).toHaveLength(2)
  })

  test('leaves every byte that was already there exactly where it was', () => {
    const untidy = '  dist  \n\n\n#   node_modules\n\tbuild'
    repo(untidy)
    change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    expect(readFileSync(gitignore(), 'utf8').startsWith(`${untidy}\n`)).toBe(true)
  })

  test('a repository with no .gitignore gets one holding only this', () => {
    repo()
    expect(existsSync(gitignore())).toBe(false)
    change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    expect(readFileSync(gitignore(), 'utf8')).toContain(`${KEHIKOT_DIR}/`)
  })

  /* A folder with no `.git` anywhere above it is one somebody keeps outside
     version control, which is a decision they made. A temp directory is exactly
     that, which is why every other test in this file leaves no ignore file
     behind. */
  test('a project with no .git anywhere above it gets no .gitignore at all', () => {
    change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    expect(existsSync(gitignore())).toBe(false)
    expect(existsSync(join(project, '.git'))).toBe(false)
    /* And the checklist was still saved — the ignore file is not a precondition
       for keeping somebody's work. */
    expect(checklists(project).lists).toHaveLength(1)
  })

  test('a rule that already ignores the folder is left alone, in any of its spellings', () => {
    for (const rule of ['.kehikot', '.kehikot/', '/.kehikot/', '**/.kehikot/']) {
      rmSync(project, { recursive: true, force: true })
      mkdirSync(project)
      repo(`dist\n${rule}\n`)
      change({ op: 'create', name: 'Mine', by: 'a test' }, project)
      expect(readFileSync(gitignore(), 'utf8')).toBe(`dist\n${rule}\n`)
    }
  })

  /* Somebody who commented it out decided something. Appending it back under
     their `#` would be arguing with them in their own file. */
  test('a commented-out rule is treated as a decision, not as an absence', () => {
    repo('# .kehikot/\n')
    change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    expect(readFileSync(gitignore(), 'utf8')).toBe('# .kehikot/\n')
  })

  test('an unwritable .gitignore does not stop a checklist being saved', () => {
    /* A directory where the file should be: every write to it throws. The
       checklist still lands, because not being able to edit somebody's ignore
       file is not a reason to refuse to keep their work. */
    mkdirSync(join(project, '.git'))
    mkdirSync(gitignore())
    expect(change({ op: 'create', name: 'Mine', by: 'a test' }, project).ok).toBe(true)
    expect(checklists(project).lists).toHaveLength(1)
  })

  /**
   * The case that forced the walk upward, and it is a real project.
   *
   * The thesis at `…/CS-DEGREE/05_drafts/thesis_latex` has no `.git` of its own
   * and sits several directories inside the CS-DEGREE repository. Under the rule
   * that was here first — write only when `<project>/.git` exists — its
   * `.kehikot/` would have turned up in somebody's `git status` with nothing
   * ignoring it, which is precisely the pollution the user asked this app not to
   * cause.
   */
  test('finds a repository several levels above the project, and still writes at the project', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'checklist-repo-'))
    try {
      mkdirSync(join(repoRoot, '.git'))
      writeFileSync(join(repoRoot, '.gitignore'), 'build\n')
      const deep = join(repoRoot, 'drafts', 'chapters', 'thesis_latex')
      mkdirSync(deep, { recursive: true })

      expect(change({ op: 'create', name: 'Mine', by: 'a test' }, deep).ok).toBe(true)

      /* Written beside the folder it is about. Git honours a `.gitignore` in any
         directory, so this does the job — and it does it without this app
         editing a file three levels up, in the root of a repository that may
         hold thirty other projects. */
      expect(readFileSync(join(deep, '.gitignore'), 'utf8')).toContain(`${KEHIKOT_DIR}/`)
      /* The repository's own ignore file is untouched, which is the half that
         makes the split worth having. */
      expect(readFileSync(join(repoRoot, '.gitignore'), 'utf8')).toBe('build\n')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  test('notices a .git that is a FILE, which is what a worktree and a submodule have', () => {
    /* An agent is more likely to be standing in a worktree than anywhere else,
       and a directory check would quietly skip exactly those checkouts. */
    const repoRoot = mkdtempSync(join(tmpdir(), 'checklist-worktree-'))
    try {
      writeFileSync(join(repoRoot, '.git'), 'gitdir: /somewhere/else/.git/worktrees/thing\n')
      const deep = join(repoRoot, 'sub')
      mkdirSync(deep)
      change({ op: 'create', name: 'Mine', by: 'a test' }, deep)
      expect(readFileSync(join(deep, '.gitignore'), 'utf8')).toContain(`${KEHIKOT_DIR}/`)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  test('the rule covers the whole .kehikot folder, not this one module’s', () => {
    /* A per-module rule would need a new line every time a module was added,
       which is a rule that goes quietly stale in somebody else's repository. */
    repo('node_modules\n')
    change({ op: 'create', name: 'Mine', by: 'a test' }, project)
    const after = readFileSync(gitignore(), 'utf8')
    expect(after).toContain(`${KEHIKOT_DIR}/`)
    expect(after).not.toContain(`${KEHIKOT_DIR}/${moduleFolder(ID)}`)
  })
})

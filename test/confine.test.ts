import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contains, inside, rootOf } from '../file/confine.ts'
import { placeOf } from '../file/open.ts'

/**
 * The file that exists entirely to try to get past the fence.
 *
 * This module now opens documents it does not own, because a passage named them
 * — a path a stranger's program chose and a host relayed without opening. The
 * protocol says so at `passageSchema` and says what is owed: the confinement
 * check this module would owe any other path. Everything below is an attempt to
 * make `inside()` say yes to somewhere it should not.
 *
 * Every temporary directory on macOS is behind a symlink (`/tmp` is
 * `/private/tmp`, `/var/folders/…` is `/private/var/folders/…`), which is not an
 * inconvenience here — it is the exact condition that broke a sibling module's
 * copy of this fence against a real project, and running these cases under it is
 * how that stays fixed.
 */

const tmp = mkdtempSync(join(tmpdir(), 'checklist-fence-'))
const root = join(tmp, 'project')
const evil = join(tmp, 'project-evil')
mkdirSync(join(root, 'chapters'), { recursive: true })
mkdirSync(evil, { recursive: true })
writeFileSync(join(root, 'main.tex'), '\\section{S}\nprose\n')
writeFileSync(join(root, 'chapters', '1_introduction.tex'), '\\chapter{Introduction}\n\\label{ch:intro}\nprose\n')
writeFileSync(join(evil, 'secret.tex'), '\\section{Not yours}\n')
writeFileSync(join(tmp, 'outside.tex'), '\\section{Also not yours}\n')
symlinkSync(join(tmp, 'outside.tex'), join(root, 'link.tex'))

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('the prefix check', () => {
  test('is about directories and not about strings', () => {
    /* `'/project-evil'.startsWith('/project')` is true, and it is the oldest bug
       in this family. */
    expect(contains('/a/project', '/a/project-evil')).toBe(false)
    expect(contains('/a/project', '/a/project/x')).toBe(true)
    expect(contains('/a/project', '/a/project')).toBe(true)
  })
})

describe('what may be a root at all', () => {
  test('an absolute directory that exists, resolved through its symlinks', () => {
    expect(rootOf(root)).toBe(realpathSync(root))
  })

  test('never a relative one, which would resolve against this module’s own source', () => {
    expect(rootOf('.')).toBe(null)
    expect(rootOf('project')).toBe(null)
  })

  test('never an empty one, and never one that is not there', () => {
    expect(rootOf('')).toBe(null)
    expect(rootOf(null)).toBe(null)
    expect(rootOf(join(tmp, 'nope'))).toBe(null)
  })
})

describe('the fence', () => {
  test('lets through a file inside the project', () => {
    expect(inside(root, join(root, 'main.tex'))).toBe(realpathSync(join(root, 'main.tex')))
  })

  test('lets through the HOST’S spelling of the path, symlinked root and all', () => {
    /*
     * This is the case that broke `kehikko-source` against a real project and it
     * is the reason this fence is a considered copy rather than a transcription.
     * A passage carries an absolute path built by whichever module pointed the
     * canvas; `rootOf` has already realpath'd the root. Under `/var/folders/…`
     * the two spellings never lexically agree, and a fence that stopped there
     * refuses every file in the project it was pointed at with the same sentence
     * it uses for `/etc/shadow`.
     */
    const real = realpathSync(root)
    expect(real).not.toBe(root)
    expect(inside(real, join(root, 'main.tex'))).toBe(realpathSync(join(root, 'main.tex')))
  })

  test('refuses a traversal, without touching the disk to find out', () => {
    expect(inside(root, '../project-evil/secret.tex')).toBe(null)
    expect(inside(root, '../../etc/passwd')).toBe(null)
  })

  test('refuses a sibling whose name starts with the root’s', () => {
    expect(inside(root, join(evil, 'secret.tex'))).toBe(null)
  })

  test('refuses a symlink that points out of the project, judging the ANSWER', () => {
    /* `<root>/link.tex` resolves lexically to a path under the root and opens
       somewhere else entirely. Resolution is lexical; only realpath knows. */
    expect(inside(root, join(root, 'link.tex'))).toBe(null)
  })

  test('refuses a path it cannot resolve, with no lexical fallback anywhere', () => {
    /* The consequence, stated so nobody re-adds the fallback as a bug fix: this
       app cannot find sections in a document that does not exist. That is
       correct — there are none in it. */
    expect(inside(root, join(root, 'never-written.tex'))).toBe(null)
  })

  test('refuses a relative root and an empty one', () => {
    expect(inside('', join(root, 'main.tex'))).toBe(null)
    expect(inside('project', join(root, 'main.tex'))).toBe(null)
  })

  test('says no the same way every time, so nothing here is an existence oracle', () => {
    /* Outside the root, not there, and unreadable are one answer. A caller that
       could tell them apart could probe for files it is not allowed to see, one
       question at a time. */
    expect(inside(root, '/etc/shadow')).toBe(null)
    expect(inside(root, '/etc/definitely-not-a-file-here')).toBe(null)
  })
})

describe('what the reader gets back, given all that', () => {
  test('a file and a section, named relative to the project and never to this machine', () => {
    const source = '\\chapter{Introduction}\n\\label{ch:intro}\nprose\n'
    const at = source.indexOf('prose')
    const placed = placeOf(root, join(root, 'chapters', '1_introduction.tex'), at, at + 5)
    expect(placed).toEqual({
      file: 'chapters/1_introduction.tex',
      section: 'chapters:1_introduction#ch:intro',
      title: 'Introduction',
    })
  })

  test('the file alone when nothing is selected in it', () => {
    expect(placeOf(root, join(root, 'main.tex'), null, null)).toEqual({
      file: 'main.tex',
      section: null,
      title: null,
    })
  })

  test('nothing at all for a file the fence refused, which reads as “no narrowing”', () => {
    /* And "no narrowing" is a working container on the paper rung, not an error
       screen. Every refusal this program can suffer here means the same thing to
       the reader. */
    expect(placeOf(root, join(evil, 'secret.tex'), 0, 4)).toBe(null)
    expect(placeOf(root, join(root, 'link.tex'), 0, 4)).toBe(null)
    expect(placeOf(null, join(root, 'main.tex'), 0, 4)).toBe(null)
  })

  test('never a byte of what the file says', () => {
    /* The bound that makes opening arbitrary files affordable at all: there is
       no code path in this module that returns file contents. If this assertion
       ever has to change, the byte cap, the binary sniff and the line cap
       `kehikko-source` carries have to arrive with it. */
    const placed = placeOf(root, join(root, 'main.tex'), 0, 5)
    expect(Object.keys(placed ?? {}).sort()).toEqual(['file', 'section', 'title'])
    expect(JSON.stringify(placed)).not.toContain('prose')
  })
})

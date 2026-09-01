import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'
import { MAX_NAME, change, checklists } from '../list/checklists.ts'

/**
 * Copying a checklist out of one project into another.
 *
 * ## Why this file goes to the trouble of building REAL projects
 *
 * A feature shipped green and unusable here yesterday because its fixture used
 * the one shape where the bug could not occur. For an import there is exactly
 * one such shape and it is easy to write by accident: **a source store with no
 * ticks in it.** Every assertion about ticks not being carried passes trivially
 * against one, and the whole of what the user is protected from — a list arriving
 * in a fresh project already claiming to be half done — would go untested.
 *
 * So no source store in this file is typed out by hand. Each one is built by
 * calling this module's own `change()` — including `tick`, so the ticks have the
 * shape the app actually writes, in the file the app actually writes it to — and
 * the cases below then read the destination's bytes off the disk rather than the
 * return value, because the return value is a claim and the file is the fact.
 *
 * ## And why it also reaches for the projects on this machine
 *
 * Three shapes exist in the wild that a temp directory does not naturally have,
 * and each one is a plausible source: a project with `.kehikot/checklist/` whose
 * store is empty, a project with a `.kehikot/` and no `checklist/` in it at all
 * (it has other modules but has never had this one), and a path naming nothing.
 * Where those exist on this machine they are used, READ ONLY — nothing here ever
 * names a real project as the destination, so nothing here can write into one.
 *
 * They are guarded by `existsSync` because a checkout on another machine has
 * different folders, and a test that failed there would be reporting on
 * somebody's disk rather than on this code. The guard is why the same three
 * shapes are ALSO built as temp projects below: a skipped case is not a passing
 * one, and the coverage must not depend on where this happens to run.
 */

let source = ''
let dest = ''

beforeEach(() => {
  source = mkdtempSync(join(tmpdir(), 'checklist-from-'))
  dest = mkdtempSync(join(tmpdir(), 'checklist-into-'))
})

afterEach(() => {
  rmSync(source, { recursive: true, force: true })
  rmSync(dest, { recursive: true, force: true })
})

function storeFile(project: string): string {
  return join(project, KEHIKOT_DIR, moduleFolder(ID), 'checklists.json')
}

function onDisk(project: string): {
  checklists: Record<
    string,
    /* The stored shape, not a convenient subset of it: `at` and `by` are on a
       checklist as well as on an item, and a helper that omitted them made a
       test about exactly that distinction fail to compile. */
    {
      id: string
      name: string
      at: string
      by: string
      origin: string | null
      items: { id: string; text: string; by: string; at: string }[]
    }
  >
  ticks: Record<string, Record<string, Record<string, unknown>>>
} {
  return JSON.parse(readFileSync(storeFile(project), 'utf8'))
}

/**
 * A list in `project`, with items, and — the part that matters — with a real
 * tick on it, made through the same call the page and the MCP door make.
 */
function aTickedList(project: string, name = 'What a change owes before review'): { list: string; items: string[] } {
  const made = change({ op: 'create', name, by: 'somebody' }, project)
  if (!made.ok) throw new Error(made.error)
  const items: string[] = []
  for (const text of ['A test that fails without the change', 'The reason, in the message']) {
    const added = change({ op: 'add', id: made.id, text, by: 'somebody' }, project)
    if (!added.ok) throw new Error(added.error)
    items.push(added.held!.rows.at(-1)!.item.id)
  }
  const ticked = change(
    {
      op: 'tick',
      id: made.id,
      item: items[0]!,
      target: { kind: 'ref', ref: 'gh#105' },
      done: true,
      by: 'somebody',
      note: 'the test is in the diff',
    },
    project,
  )
  if (!ticked.ok) throw new Error(ticked.error)
  return { list: made.id, items }
}

describe('what crosses, and what does not', () => {
  test('the items come, and the ticks stay where they were made', () => {
    /*
     * The load-bearing case in this file. A checklist's items are the thing
     * being reused; whether they are done is a fact about the project they came
     * from. A copy that arrived ticked would be a list of work claiming to be
     * finished in a repository where none of it has been started.
     *
     * Asserted against the destination's BYTES rather than against the answer,
     * and against the source's bytes too — because "the ticks did not come" and
     * "the ticks were moved" are different, and only one of them is what was
     * asked for.
     */
    const { list } = aTickedList(source)
    expect(Object.keys(onDisk(source).ticks)).toHaveLength(1)

    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok).toBe(true)

    expect(onDisk(dest).ticks).toEqual({})
    /* And the source is untouched: an import is a copy, not a move. */
    expect(Object.keys(onDisk(source).ticks)).toHaveLength(1)
    expect(Object.keys(onDisk(source).checklists)).toHaveLength(1)

    const copied = Object.values(onDisk(dest).checklists)[0]!
    expect(copied.items.map((i) => i.text)).toEqual([
      'A test that fails without the change',
      'The reason, in the message',
    ])
  })

  test('the list gets a new id, and so does every item on it', () => {
    /*
     * Not tidiness. Ticks are keyed by checklist id and item id, so a copy
     * carrying the source's ids could land on top of ticks left behind by a list
     * that used to have that id HERE — inheriting somebody else's answers about
     * work it has never been held against. `drop` writes the same hazard down
     * for items; this is it one level up.
     */
    const { list, items } = aTickedList(source)
    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok).toBe(true)

    const copied = Object.values(onDisk(dest).checklists)[0]!
    expect(copied.id).not.toBe(list)
    for (const item of copied.items) expect(items).not.toContain(item.id)
  })

  test('a copy cannot inherit ticks that were left behind under the source’s id', () => {
    /*
     * The concrete version of the paragraph above, and the one that would have
     * shipped green under an implementation that reused ids. A destination is
     * arranged to hold ticks keyed by the SOURCE's list id — which is what a
     * hand-edited file, or a store that lost its list without its ticks, looks
     * like — and the copy must not pick them up.
     */
    const { list, items } = aTickedList(source)

    /* Give the destination a real list through the store, so the file has the
       shape the app writes, and then file its ticks under the SOURCE's id —
       which is what a store that lost a list without its ticks looks like. */
    aTickedList(dest, 'Something else entirely')
    const held = onDisk(dest)
    held.ticks = { [list]: { 'ref:gh#1': { [items[0]!]: { at: 'then', by: 'nobody', viaMcp: false } } } }
    Bun.write(storeFile(dest), `${JSON.stringify(held, null, 2)}\n`)

    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok).toBe(true)

    const after = onDisk(dest)
    const copied = Object.values(after.checklists).find((one) => one.origin !== null)!
    expect(after.ticks[copied.id]).toBeUndefined()
  })

  test('an item keeps who wrote it; the list says who brought it here', () => {
    /* Two different facts wearing the same field name. `by` on an item is the
       author of a sentence, and stamping the importer on somebody else's words
       is a claim this app has no business making; `by` on the list is who
       performed an act in THIS project, which is the importer. */
    const { list } = aTickedList(source)
    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok).toBe(true)

    const copied = Object.values(onDisk(dest).checklists)[0]!
    expect(copied.items.every((i) => i.by === 'somebody')).toBe(true)
    const answered = done.ok ? done.id : ''
    expect(onDisk(dest).checklists[answered]!.by).toBe('the importer')
  })

  test('origin says where it came from, by name, and never as a path', () => {
    /* A path here would be somebody's home directory written into a file they
       may commit and share, in a field nothing resolves. `origin` is provenance
       for a person to read. */
    const { list } = aTickedList(source)
    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok).toBe(true)

    const copied = Object.values(onDisk(dest).checklists)[0]!
    expect(copied.origin).toBe(`import:${source.split('/').pop()}#${list}`)
    expect(copied.origin).not.toContain('/')
  })
})

describe('names, which cannot be allowed to collide', () => {
  test('a free name is kept exactly', () => {
    const { list } = aTickedList(source)
    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok && done.lists[0]!.name).toBe('What a change owes before review')
  })

  test('a taken name is renamed rather than refused, and the answer says so', () => {
    /*
     * `create` refuses a duplicate, because somebody has just typed a name and
     * can type another. An import has nobody to send back to — the name was
     * typed in a project that is not open — so it renames, and the rule that
     * survives is the one that mattered: two lists with one name is a person
     * picking the wrong one on a screen where they cannot tell them apart.
     */
    const { list } = aTickedList(source)
    aTickedList(dest)

    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok).toBe(true)
    const names = done.ok ? done.lists.map((l) => l.name).sort() : []
    expect(names).toEqual([
      'What a change owes before review',
      `What a change owes before review (from ${source.split('/').pop()})`,
    ])
    expect(done.ok && done.said).toContain('(from ')
  })

  test('and a third copy counts rather than colliding', () => {
    const { list } = aTickedList(source)
    aTickedList(dest)
    expect(change({ op: 'import', from: source, id: list, by: 'x' }, dest).ok).toBe(true)
    const third = change({ op: 'import', from: source, id: list, by: 'x' }, dest)
    expect(third.ok).toBe(true)
    expect(third.ok && third.said).toContain(') 2"')
  })

  test('a name at the limit is not lengthened past it and silently clipped back into a collision', () => {
    /*
     * The subtle one. A suffix on a name already at `MAX_NAME` produces a string
     * the store would clip on write — back to exactly the name it was
     * lengthened to avoid. So every candidate is length-checked, and when none
     * fits, this refuses in a sentence rather than making two rows nobody can
     * tell apart.
     */
    const long = 'x'.repeat(MAX_NAME)
    const { list } = aTickedList(source, long)
    aTickedList(dest, long)

    const done = change({ op: 'import', from: source, id: list, by: 'the importer' }, dest)
    expect(done.ok).toBe(false)
    expect(!done.ok && done.error).toContain('Rename one of them')
    expect(Object.keys(onDisk(dest).checklists)).toHaveLength(1)
  })
})

describe('a source that is not what was hoped', () => {
  test('a project with no checklists is refused by the list, not by the folder', () => {
    const done = change({ op: 'import', from: source, id: 'whatever', by: 'x' }, dest)
    expect(done.ok).toBe(false)
    expect(!done.ok && done.error).toContain('there is no checklist')
  })

  test('a path naming nothing on this machine is refused in the store’s own words', () => {
    const gone = join(source, 'not-here')
    const done = change({ op: 'import', from: gone, id: 'whatever', by: 'x' }, dest)
    expect(done.ok).toBe(false)
    expect(!done.ok && done.error).toContain('there is no folder at')
    /* And nothing was written into the destination on the way to finding out. */
    expect(existsSync(storeFile(dest))).toBe(false)
  })

  test('a source whose file will not parse is refused rather than read as empty', () => {
    /* "The file is broken" and "there is nothing in it" must not be the same
       answer. The second would silently offer nothing to import out of a project
       full of somebody's lists. */
    mkdirSync(join(source, KEHIKOT_DIR, moduleFolder(ID)), { recursive: true })
    Bun.write(storeFile(source), '{ not json')
    const read = checklists(source)
    expect(read.trouble).toBeTruthy()
    const done = change({ op: 'import', from: source, id: 'whatever', by: 'x' }, dest)
    expect(done.ok).toBe(false)
    expect(!done.ok && done.error).toContain('could not be read')
  })

  test('importing from the project being written to is a copy, not a special case', () => {
    /* The picker can be answered with the open project. Refusing that would be a
       rule to explain; renaming is what already happens to any name that is
       taken, and it makes the duplicate legible on the row. */
    const { list } = aTickedList(dest)
    const done = change({ op: 'import', from: dest, id: list, by: 'x' }, dest)
    expect(done.ok).toBe(true)
    expect(done.ok && done.lists).toHaveLength(2)
    expect(onDisk(dest).ticks[list]).toBeTruthy()
    const copy = Object.values(onDisk(dest).checklists).find((one) => one.origin !== null)!
    expect(onDisk(dest).ticks[copy.id]).toBeUndefined()
  })
})

/* --------------------------------------------------------------------- *
 * The projects that are actually on this machine
 *
 * Read only, and never a destination. See the essay at the top for why these
 * are guarded and why the same shapes are covered above without a guard.
 * --------------------------------------------------------------------- */

const REAL = [
  '/Users/jaakkorajala/Projects/roadmap',
  '/Users/jaakkorajala/Projects/hippos_kotisivut/hippos-portal',
]

describe('against the projects on this machine', () => {
  test('every real project this app can see reads without trouble, and without being changed', () => {
    const found = REAL.filter((root) => existsSync(root))
    for (const root of found) {
      const before = existsSync(join(root, KEHIKOT_DIR, moduleFolder(ID)))
      const read = checklists(root)
      expect(read.trouble).toBeNull()
      expect(read.nowhere).toBe(false)
      /* Reading never creates. A person who opens a checklist container against a
         repository should find that repository exactly as they left it — which
         matters more here than anywhere, because the picker makes it possible to
         read a project nobody has opened. */
      expect(existsSync(join(root, KEHIKOT_DIR, moduleFolder(ID)))).toBe(before)
    }
  })

  test('a real project is importable FROM, list by list, with nothing carried but the items', () => {
    for (const root of REAL.filter((one) => existsSync(one))) {
      const there = checklists(root)
      for (const list of there.lists) {
        const into = mkdtempSync(join(tmpdir(), 'checklist-real-'))
        try {
          const done = change({ op: 'import', from: root, id: list.id, by: 'a test' }, into)
          expect(done.ok).toBe(true)
          const after = onDisk(into)
          expect(after.ticks).toEqual({})
          const copied = Object.values(after.checklists)[0]!
          expect(copied.items).toHaveLength(list.items)
          expect(copied.id).not.toBe(list.id)
        } finally {
          rmSync(into, { recursive: true, force: true })
        }
      }
    }
  })

  test('a real store copied into a project is importable out of it, ticks and all left behind', () => {
    /*
     * The one case a temp project cannot produce on its own: a file written by
     * earlier versions of this app, carrying migration-era ids that are not
     * eight hex characters, notes on ticks, and `viaMcp` set. If one is on this
     * machine it is used; the shape it protects is covered above regardless.
     */
    const kept = [
      '/Users/jaakkorajala/.claude/jobs/85f6bc23/tmp/ck-live/checklists.json',
      '/Users/jaakkorajala/.claude/jobs/85f6bc23/backup/checklist-data/checklists.json',
    ].filter((one) => existsSync(one))

    for (const bytes of kept) {
      mkdirSync(join(source, KEHIKOT_DIR, moduleFolder(ID)), { recursive: true })
      cpSync(bytes, storeFile(source))
      const there = checklists(source)
      expect(there.trouble).toBeNull()
      expect(there.lists.length).toBeGreaterThan(0)

      for (const list of there.lists) {
        const into = mkdtempSync(join(tmpdir(), 'checklist-kept-'))
        try {
          const done = change({ op: 'import', from: source, id: list.id, by: 'a test' }, into)
          expect(done.ok).toBe(true)
          expect(onDisk(into).ticks).toEqual({})
          expect(Object.values(onDisk(into).checklists)[0]!.items).toHaveLength(list.items)
        } finally {
          rmSync(into, { recursive: true, force: true })
        }
      }
      rmSync(join(source, KEHIKOT_DIR), { recursive: true, force: true })
    }
  })
})

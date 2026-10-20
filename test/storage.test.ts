import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { headerItemsSchema, KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'
import { change, checklists, held, snapshot, targetsOf } from '../list/checklists.ts'
import { discard, preview, purge, restore, usage, usageText } from '../list/storage.ts'
import { headerFor, viewPressed } from '../src/wire/header.ts'
import { fingerprint } from './disk.ts'

/**
 * Layout 2, Storage and Purge: the folder split so a list may be held against
 * any number of targets, a person seeing what it takes, and a person — never
 * an agent — trimming it, with a preview first.
 */

let dir = ''
let other = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-storage-'))
  other = mkdtempSync(join(tmpdir(), 'checklist-outside-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
})

const folder = () => join(dir, KEHIKOT_DIR, moduleFolder(ID))
const DAY = 86_400_000

function aList(name = 'What an issue owes'): { list: string; item: string } {
  const made = change({ op: 'create', name, by: 'a test' }, dir)
  if (!made.ok) throw new Error(made.error)
  const added = change({ op: 'add', id: made.id, text: 'It has a test.', by: 'a test' }, dir)
  if (!added.ok) throw new Error(added.error)
  return { list: made.id, item: added.held!.rows[0]!.item.id }
}

/** A layout-1 file, as the folder held one before the split. */
function legacy(targets: string[], ticks: Record<string, Record<string, unknown>> = {}) {
  return {
    checklists: {
      abc: {
        id: 'abc',
        name: 'Old',
        at: '2026-01-01T00:00:00.000Z',
        by: 'somebody',
        origin: null,
        items: [{ id: 'i1', text: 'x', at: '2026-01-01T00:00:00.000Z', by: 'somebody' }],
        targets,
      },
    },
    ticks: { abc: ticks },
  }
}

function putLegacy(value: unknown, name = 'checklists.json'): void {
  mkdirSync(folder(), { recursive: true })
  writeFileSync(join(folder(), name), JSON.stringify(value))
}

describe('the migration from one file to layout 2', () => {
  const tick = { at: '2026-02-01T00:00:00.000Z', by: 'claude', viaMcp: true, note: 'ran it' }

  test('moves every list, hold and tick, and removes the old file only once the new layout is proved', () => {
    putLegacy(legacy(['ref:gh#1', 'paper:thesis/chapters:3_methods'], { 'ref:gh#1': { i1: tick }, 'ref:gh#9': { i1: tick } }))
    expect(checklists(dir).trouble).toBeNull()
    expect(readdirSync(folder()).sort()).toEqual(['lists.json', 'targets'])
    expect(targetsOf('abc', dir).map((one) => one.target)).toEqual([
      { kind: 'ref', ref: 'gh#1' },
      { kind: 'paper', epic: 'thesis', section: 'chapters:3_methods' },
    ])
    /* A released target's ticks came across too, and stay released. */
    expect(held('abc', { kind: 'ref', ref: 'gh#9' }, dir).held!.done).toBe(1)
    expect(snapshot(dir)!.ticks.abc).toEqual({ 'ref:gh#1': { i1: tick }, 'ref:gh#9': { i1: tick } })
  })

  test('is idempotent: a second read writes nothing', () => {
    putLegacy(legacy(['ref:gh#1'], { 'ref:gh#1': { i1: tick } }))
    checklists(dir)
    const once = fingerprint(folder())
    checklists(dir)
    targetsOf('abc', dir)
    expect(fingerprint(folder())).toBe(once)
  })

  test('an interrupted migration — the backup set aside, half the buckets written — starts again from the backup', () => {
    putLegacy(legacy(['ref:gh#1', 'ref:gh#2'], { 'ref:gh#2': { i1: tick } }), 'checklists.v1.json')
    mkdirSync(join(folder(), 'targets', 'abc'), { recursive: true })
    writeFileSync(join(folder(), 'targets', 'abc', '00.json'), '{"ref:stray":{"since":"x"}}')
    expect(checklists(dir).lists[0]?.targets).toBe(2)
    expect(targetsOf('abc', dir).map((one) => one.target)).toEqual([{ kind: 'ref', ref: 'gh#1' }, { kind: 'ref', ref: 'gh#2' }])
    expect(existsSync(join(folder(), 'checklists.v1.json'))).toBe(false)
  })

  test('a file that will not parse is left exactly where it was, and every write is refused', () => {
    putLegacy('{ half a file')
    const before = fingerprint(folder())
    expect(checklists(dir).trouble).toContain('could not be read')
    expect(change({ op: 'create', name: 'Mine', by: 'a test' }, dir).ok).toBe(false)
    expect(fingerprint(folder())).toBe(before)
  })

  test('a list folder that is a symlink out of the project is refused, read and write', () => {
    const { list } = aList()
    change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#1' }, by: 'a test' }, dir)
    rmSync(join(folder(), 'targets', list), { recursive: true })
    writeFileSync(join(other, '00.json'), '{}')
    symlinkSync(other, join(folder(), 'targets', list))
    expect(targetsOf(list, dir)).toEqual([])
    const out = change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#2' }, by: 'a test' }, dir)
    expect(!out.ok && out.error).toContain('outside the project')
  })

  test('a broken bucket names that one file, and the rest of the project still reads', () => {
    const { list } = aList()
    const second = aList('What a change owes')
    change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#1' }, by: 'a test' }, dir)
    change({ op: 'hold', id: second.list, target: { kind: 'ref', ref: 'gh#1' }, by: 'a test' }, dir)
    const bucket = readdirSync(join(folder(), 'targets', list))[0]!
    writeFileSync(join(folder(), 'targets', list, bucket), '{ broken')
    const out = change({ op: 'tick', id: list, item: 'x', target: { kind: 'ref', ref: 'gh#1' }, done: true, by: 'a test' }, dir)
    expect(out.ok).toBe(false)
    expect(checklists(dir).trouble).toBeNull()
    expect(held(second.list, { kind: 'ref', ref: 'gh#1' }, dir).held).not.toBeNull()
  })
})

describe('no limit, and a list held against fifty thousand targets stays fast', () => {
  /*
   * Built through the migration rather than fifty thousand holds: a layout-1
   * file with 50,000 refs, a tick on every tenth, which is what the cap was
   * guarding against. The bounds are generous for a slow CI machine and an
   * order of magnitude under what reading the whole store costs.
   */
  test('a context, a tick and the list of every checklist touch only what they need', () => {
    const N = 50_000
    const keys = Array.from({ length: N }, (_, n) => `ref:gh#${n + 1}`)
    const ticks: Record<string, Record<string, unknown>> = {}
    for (let n = 0; n < N; n += 10) ticks[keys[n]!] = { i1: { at: '2026-02-01T00:00:00.000Z', by: 'claude', viaMcp: true } }
    putLegacy(legacy(keys, ticks))
    const legacyBytes = readFileSync(join(folder(), 'checklists.json')).length

    let t = performance.now()
    expect(checklists(dir).lists[0]?.targets).toBe(N)
    const migrated = performance.now() - t

    const time = (run: () => void, times = 20): number => {
      const start = performance.now()
      for (let i = 0; i < times; i += 1) run()
      return (performance.now() - start) / times
    }
    const { inFront } = require('../list/checklists.ts') as typeof import('../list/checklists.ts')
    const context = time(() => {
      const got = inFront({ ladders: [], selection: ['gh#12345', 'gh#41'] }, dir)
      if (got.instances.length !== 2) throw new Error('both refs are held')
    })
    const list = time(() => checklists(dir))

    const before = fingerprint(folder())
    t = performance.now()
    const ticked = change({ op: 'tick', id: 'abc', item: 'i1', target: { kind: 'ref', ref: 'gh#777' }, done: true, by: 'a test' }, dir)
    const tickMs = performance.now() - t
    expect(ticked.ok).toBe(true)
    const after = fingerprint(folder())
    const changed = after.split('\n---\n').filter((one) => !before.includes(one)).map((one) => one.split('\n')[0])
    /* One bucket, and not even lists.json: a tick on a held target changes nothing a list says. */
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatch(/^targets\/abc\/[0-9a-f]{2}\.json$/)

    const hold = time(() => {
      const out = change({ op: 'hold', id: 'abc', target: { kind: 'ref', ref: `gh#${N + 1 + Math.floor(Math.random() * 1e9)}` }, by: 'a test' }, dir)
      if (!out.ok) throw new Error(out.error)
    }, 10)

    console.log(
      `[scale] ${N} targets, ${N / 10} ticks: layout-1 file ${(legacyBytes / 1024 / 1024).toFixed(1)} MB; `
      + `migration ${migrated.toFixed(0)} ms; context ${context.toFixed(2)} ms; every checklist ${list.toFixed(2)} ms; `
      + `tick ${tickMs.toFixed(2)} ms; hold ${hold.toFixed(2)} ms`,
    )
    expect(context).toBeLessThan(25)
    expect(list).toBeLessThan(25)
    expect(tickMs).toBeLessThan(50)
    expect(hold).toBeLessThan(50)
  }, 60_000)
})

describe('Storage: what the folder takes up', () => {
  test('per list: bytes, held, released with ticks kept, ticks, last activity, finished — and the project total', () => {
    const { list, item } = aList()
    for (const ref of ['gh#1', 'gh#2', 'gh#3']) {
      change({ op: 'tick', id: list, item, target: { kind: 'ref', ref }, done: true, by: 'a test' }, dir)
    }
    change({ op: 'release', id: list, target: { kind: 'ref', ref: 'gh#3' }, by: 'a test' }, dir)
    const report = usage(dir, [{ ref: 'gh#1', at: '2026-01-05T00:00:00Z' }, { ref: 'gh#3', at: null }])
    const row = report.lists[0]!
    expect(row).toMatchObject({ id: list, held: 2, released: 1, ticks: 3, finished: 2 })
    expect(row.bytes).toBeGreaterThan(0)
    expect(row.last).not.toBeNull()
    expect(report.total).toBe(fingerprintSize())
    /* Without a tracker reading, finished is not guessed. */
    expect(usage(dir).lists[0]!.finished).toBeNull()
  })

  test('the agent’s text says what is there and that purging is a person’s', () => {
    aList()
    const text = usageText(dir)
    expect(text).toContain('What an issue owes')
    expect(text).toContain('no tool for it')
  })
})

function fingerprintSize(): number {
  let n = 0
  const walk = (at: string) => {
    for (const name of readdirSync(at, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(at, name.name))
      else n += readFileSync(join(at, name.name)).length
    }
  }
  walk(folder())
  return n
}

describe('Purge: preview, confirm, remove', () => {
  const later = (days: number) => Date.now() + days * DAY

  function released(): { list: string } {
    const { list, item } = aList()
    for (const ref of ['gh#1', 'gh#2']) {
      change({ op: 'tick', id: list, item, target: { kind: 'ref', ref }, done: true, by: 'a test' }, dir)
    }
    change({ op: 'release', id: list, target: { kind: 'ref', ref: 'gh#2' }, by: 'a test' }, dir)
    return { list }
  }

  test('a preview writes nothing and says exactly what would go and what it frees', () => {
    released()
    const before = fingerprint(folder())
    const plan = preview(dir, { scope: 'released', days: 30 }, null, later(60))
    expect(plan.ok && plan.value).toMatchObject({ targets: 1, ticks: 1, lists: 0 })
    expect(plan.ok && plan.value.frees).toBeGreaterThan(0)
    expect(fingerprint(folder())).toBe(before)
  })

  test('released ticks are kept until a person purges them, and only those older than the age chosen', () => {
    const { list } = released()
    expect(preview(dir, { scope: 'released', days: 30 }).ok && (preview(dir, { scope: 'released', days: 30 }) as { value: { targets: number } }).value.targets).toBe(0)
    expect(held(list, { kind: 'ref', ref: 'gh#2' }, dir).held!.done).toBe(1)
  })

  test('a purge removes what was previewed, keeps a backup, and the backup puts it back', () => {
    const { list } = released()
    const now = later(60)
    const plan = preview(dir, { scope: 'released', days: 30 }, null, now)
    if (!plan.ok) throw new Error(plan.error)
    const sizeBefore = usage(dir).total
    const done = purge(dir, { rule: { scope: 'released', days: 30 }, digest: plan.value.digest, keep: true }, null, now)
    if (!done.ok) throw new Error(done.error)
    expect(done.value.said).toContain('backup is kept')
    expect(held(list, { kind: 'ref', ref: 'gh#2' }, dir).held!.done).toBe(0)
    /* The held target and its tick are untouched. */
    expect(held(list, { kind: 'ref', ref: 'gh#1' }, dir).held!.done).toBe(1)
    const report = usage(dir)
    expect(report.backups).toHaveLength(1)
    expect(report.total).toBe(sizeBefore - plan.value.frees + report.backups[0]!.bytes)

    const back = restore(dir, report.backups[0]!.name)
    expect(back.ok && back.value).toContain('put back')
    expect(held(list, { kind: 'ref', ref: 'gh#2' }, dir).held!.done).toBe(1)
    expect(usage(dir).backups).toEqual([])
  })

  test('a purge is refused when the folder no longer plans what was previewed', () => {
    const { list } = released()
    const now = later(60)
    const plan = preview(dir, { scope: 'lists', days: 30 }, null, now)
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.value.lists).toBe(1)
    change({ op: 'create', name: 'Made since', by: 'a test' }, dir)
    const done = purge(dir, { rule: { scope: 'lists', days: 30 }, digest: plan.value.digest, keep: true }, null, now)
    expect(!done.ok && done.error).toContain('Preview again')
    expect(checklists(dir).lists.map((one) => one.id)).toContain(list)
  })

  test('whole checklists with no activity go, folder and all; without a backup it says it is permanent', () => {
    const { list } = released()
    const now = later(400)
    const plan = preview(dir, { scope: 'lists', days: 365 }, null, now)
    if (!plan.ok) throw new Error(plan.error)
    const done = purge(dir, { rule: { scope: 'lists', days: 365 }, digest: plan.value.digest, keep: false }, null, now)
    if (!done.ok) throw new Error(done.error)
    expect(done.value.said).toContain('cannot be undone')
    expect(checklists(dir).lists).toEqual([])
    expect(existsSync(join(folder(), 'targets', list))).toBe(false)
    expect(existsSync(join(folder(), 'purged'))).toBe(false)
  })

  test('finished targets need the tracker’s reading, and then are released with their ticks', () => {
    const { list } = released()
    expect(!preview(dir, { scope: 'finished', days: 1 }).ok).toBe(true)
    const finished = [{ ref: 'gh#1', at: new Date(Date.now() - 10 * DAY).toISOString() }]
    const plan = preview(dir, { scope: 'finished', days: 7 }, finished)
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.value).toMatchObject({ targets: 1, ticks: 1 })
    const done = purge(dir, { rule: { scope: 'finished', days: 7 }, digest: plan.value.digest, keep: true }, finished)
    if (!done.ok) throw new Error(done.error)
    expect(targetsOf(list, dir)).toEqual([])
    expect(checklists(dir).lists[0]!.targets).toBe(0)
  })

  test('a backup can be deleted at once, and is gone for good', () => {
    released()
    const now = later(60)
    const plan = preview(dir, { scope: 'released', days: 30 }, null, now)
    if (!plan.ok) throw new Error(plan.error)
    purge(dir, { rule: { scope: 'released', days: 30 }, digest: plan.value.digest, keep: true }, null, now)
    const name = usage(dir).backups[0]!.name
    expect(discard(dir, name).ok).toBe(true)
    expect(restore(dir, name).ok).toBe(false)
    expect(discard(dir, '../../etc/passwd').ok).toBe(false)
  })
})

describe('purging is a person’s: agents are refused', () => {
  test('no MCP tool purges, and asking for one is answered with why', async () => {
    const { answerAt, PURGE_IS_A_PERSONS } = await import('../doors.ts')
    released()
    const list = answerAt('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const names = (list?.body as { result: { tools: { name: string }[] } }).result.tools.map((one) => one.name)
    expect(names).toContain('storage')
    for (const name of ['purge_storage', 'purge_checklists', 'restore_backup']) {
      const reply = answerAt('POST', '/mcp', new URLSearchParams(), {
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { project: dir } },
      }, null)
      const result = (reply?.body as { result: { isError?: boolean; content: { text: string }[] } }).result
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toBe(PURGE_IS_A_PERSONS)
    }
    const read = answerAt('POST', '/mcp', new URLSearchParams(), {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'storage', arguments: { project: dir } },
    }, null)
    expect((read?.body as { result: { content: { text: string }[] } }).result.content[0]!.text).toContain('Checklist storage')
  })

  test('the purge door is behind the page’s ticket, and wants a confirm', async () => {
    const { answerAt, TICKET } = await import('../doors.ts')
    released()
    const before = fingerprint(folder())
    const body = { project: dir, op: 'purge', scope: 'lists', days: 1, digest: 'x', confirm: true }
    expect(answerAt('POST', '/api/storage', new URLSearchParams(), body, null)?.status).not.toBe(200)
    expect(answerAt('POST', '/api/storage', new URLSearchParams(), { ...body, confirm: false }, TICKET)?.status).toBe(400)
    expect(fingerprint(folder())).toBe(before)
  })

  test('the header offers View → Storage by the option id a host opens it by, and nothing in it is for agents', () => {
    const items = headerItemsSchema.parse(headerFor('here'))
    const view = items.find((one) => one.id === 'view')!
    expect(view.kind).toBe('switch')
    expect(view.kind === 'switch' && view.options.map((one) => one.id)).toContain('storage')
    for (const one of items) expect(one.agents).toBe(false)
    expect(viewPressed({ item: 'view', value: 'storage' })).toBe('storage')
    expect(viewPressed({ item: 'view', value: 'nowhere' })).toContain('takes one of')
  })

  function released() {
    const { list, item } = aList()
    change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#1' }, done: true, by: 'a test' }, dir)
  }
})

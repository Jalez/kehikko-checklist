import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The store, and the one promise the extraction had to keep: **the files on disk
 * are somebody's work and must keep loading.**
 *
 * Everything else in this repository is new — a new page, a new protocol, a new
 * port — and none of it is allowed to mean that a `checklist.json` or a
 * `ticks.json` written by the program this came from stops being readable. So
 * these tests write the OLD shapes, byte for byte as the previous version
 * produced them, and assert that the current readers still find every rewording,
 * every exemption and every tick in them.
 *
 * `CHECKLIST_DATA` is set per test and the modules are imported fresh, because
 * `dataDir()` resolves the variable at call time — deliberately, so that a test
 * does not depend on which module happened to load first.
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-'))
  process.env.CHECKLIST_DATA = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHECKLIST_DATA
})

describe('a checklist.json written by the old program', () => {
  test('still applies its wordings, exemptions and thresholds', async () => {
    writeFileSync(
      join(dir, 'checklist.json'),
      JSON.stringify({
        lists: {
          mr: {
            wording: { test: { label: 'A test that fails without it', why: 'Undo the change and watch it go red.' } },
            added: [{ id: 'screenshots', label: 'Screenshots attached', why: 'A reviewer should not have to boot it.' }],
            removed: { proof: { setBy: 'the settings dialog' } },
          },
          issue: { wording: {}, added: [], removed: {} },
        },
        exempt: { gitlab: {}, github: { changeset: 'No .changeset in these repos, they deploy from a branch.' } },
        size: { fine: 10, big: 30 },
      }),
    )

    const { effectiveList, exemptFor, sizeBig, sizeFine } = await import('../list/store.ts')
    const list = effectiveList('mr')
    expect(list.find((c) => c.id === 'test')?.label).toBe('A test that fails without it')
    expect(list.find((c) => c.id === 'screenshots')?.kind).toBe('agent')
    expect(list.find((c) => c.id === 'proof')).toBeUndefined()
    expect(exemptFor('github').changeset).toContain('deploy from a branch')
    expect(sizeFine()).toBe(10)
    expect(sizeBig()).toBe(30)
  })

  test('reads a bare-string exemption, which is how the very first version wrote them', async () => {
    /* The migration in `exemptSchema`. Without it the whole file fails to parse,
       and an unparseable file reads as "nothing edited" — so a version bump would
       silently throw away every exemption, rewording and removal in it and report
       the list as untouched. */
    writeFileSync(
      join(dir, 'checklist.json'),
      JSON.stringify({ exempt: { gitlab: { size: 'This repo has no size convention worth enforcing.' }, github: {} } }),
    )
    const { exemptFor } = await import('../list/store.ts')
    expect(exemptFor('gitlab').size).toContain('no size convention')
  })
})

describe('a ticks.json written by the old program', () => {
  test('still reports every tick, and the head each was pinned to', async () => {
    writeFileSync(
      join(dir, 'ticks.json'),
      JSON.stringify({
        ticks: {
          '!1848': [
            { item: 'solved', agent: 'an agent', at: '2026-01-01T00:00:00.000Z' },
            { item: 'reviewed', agent: 'an agent', at: '2026-01-01T00:00:00.000Z', sha: 'abc123def456' },
          ],
        },
        seen: {
          '!1848': {
            at: '2026-01-01T00:00:00.000Z',
            from: 'a roadmap framing this page',
            state: { state: 'opened', title: 'A change', at: '2026-01-01T00:00:00.000Z', url: 'https://x/1', sha: 'abc123def456' },
          },
        },
      }),
    )
    const { ticks, seen, known } = await import('../list/ticks.ts')
    expect(ticks('!1848').map((t) => t.item)).toEqual(['solved', 'reviewed'])
    expect(ticks('!1848')[1]?.sha).toBe('abc123def456')
    expect(seen('!1848')?.from).toBe('a roadmap framing this page')
    expect(known()).toEqual(['!1848'])
  })

  test('a corrupt file is never written over, so the ticks in it stay recoverable', async () => {
    /* The asymmetry `ticks.ts` argues for: reading tolerates rubbish because a
       lost tick is a claim that has to be made again, and writing refuses it
       because a write over an unreadable file is not recoverable at all. */
    const file = join(dir, 'ticks.json')
    writeFileSync(file, '{ this is not json')
    const { setTick, tickTrouble } = await import('../list/ticks.ts')
    expect(tickTrouble()).toContain('could not be read')
    const out = setTick({ ref: '!1', item: 'solved', done: true, agent: 'an agent' })
    expect(out.ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('{ this is not json')
  })
})

describe('a tick', () => {
  test('is recorded, read back, and taken away without leaving an empty row behind', async () => {
    const { setTick, ticks, known } = await import('../list/ticks.ts')
    expect(setTick({ ref: 'gh#131', item: 'solved', done: true, agent: 'an agent' }).ok).toBe(true)
    expect(ticks('gh#131')).toHaveLength(1)
    expect(setTick({ ref: 'gh#131', item: 'solved', done: false, agent: 'an agent' }).ok).toBe(true)
    expect(ticks('gh#131')).toEqual([])
    /* A reference somebody ticked and unticked is a reference nothing is recorded
       against, and a file full of empty arrays is a file that reads as if it
       holds something. */
    expect(known()).toEqual([])
  })
})

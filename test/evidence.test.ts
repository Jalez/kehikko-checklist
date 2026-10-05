import { describe, expect, test } from 'bun:test'

import { trackerReadingResult, trackerRowSchema, type TrackerRow } from 'roadmap-module-protocol'

import { evidenceOf, evidenceSchema, factOf, staleness } from '../list/evidence.ts'
import { factsOf } from '../src/view/facts.tsx'

/**
 * The tracker's facts as an item's evidence, against stand-in rows.
 *
 * Every row here goes through the protocol's own `trackerRowSchema`, so a
 * stand-in the host could never send fails here rather than passing a test it
 * has no business passing. The host side (Jalez/kehikko#25) is what will send
 * the real ones.
 */
function change(over: Record<string, unknown> = {}, detail: Record<string, unknown> | null = {}): TrackerRow {
  return trackerRowSchema.parse({
    ref: '!7',
    tracker: 'gitlab',
    host: 'gitlab.com',
    repo: 'group/project',
    number: 7,
    kind: 'change',
    state: 'open',
    title: 'Teach the parser tabs',
    url: 'https://gitlab.com/group/project/-/merge_requests/7',
    labels: ['parser'],
    pipeline: 'success',
    review: 'required',
    readAt: '2026-10-05T10:00:00Z',
    ...over,
    ...(detail
      ? {
          detail: {
            body: 'Tabs were read as spaces.',
            files: [{ path: 'src/parse.ts', additions: 3, deletions: 1 }],
            headSha: '4f6d7bbf9bdbf209913746fa669904fa5a0616ca',
            approvedBy: [],
            readAt: '2026-10-05T10:00:00Z',
            ...detail,
          },
        }
      : {}),
  })
}

function issue(over: Record<string, unknown> = {}): TrackerRow {
  return trackerRowSchema.parse({
    ref: 'gh#41',
    tracker: 'github',
    host: 'github.com',
    repo: 'owner/repo',
    number: 41,
    kind: 'issue',
    state: 'open',
    title: 'Tabs',
    url: 'https://github.com/owner/repo/issues/41',
    readAt: '2026-10-05T10:00:00Z',
    ...over,
  })
}

describe('a fact, out of a row', () => {
  test('a pipeline is said at the commit it ran on', () => {
    expect(factOf(change(), 'pipeline')?.said).toBe('pipeline: success at 4f6d7bb')
  })

  test('a fact the tracker does not record is null, never "none"', () => {
    /* A GitHub issue has no pipeline. Drawing "pipeline: none" would read as
       one that never ran. */
    expect(factOf(issue(), 'pipeline')).toBeNull()
    expect(factOf(issue(), 'draft')).toBeNull()
    /* And the facts that live in `detail` are null on a row read without it. */
    expect(factOf(change({}, null), 'files')).toBeNull()
    expect(factOf(change({}, null), 'description')).toBeNull()
  })

  test('labels and links say "none" because the tracker always records them', () => {
    expect(factOf(issue(), 'labels')?.said).toBe('labels: none')
    expect(factOf(issue(), 'links')?.said).toBe('links: none')
    expect(factOf(change({ links: [{ ref: 'gh#41', relation: 'closes' }] }), 'links')?.said).toBe('links: closes gh#41')
  })

  test('a state carries the tracker’s close reason when it has one', () => {
    expect(factOf(issue({ state: 'closed', stateReason: 'NOT_PLANNED' }), 'state')?.said).toBe('state: closed (not planned)')
  })

  test('the description is compared by a hash and drawn by its length', () => {
    const fact = factOf(change(), 'description')!
    expect(fact.said).toBe('description: 25 characters')
    expect(fact.print).toMatch(/^body:[0-9a-f]{8}$/)
  })
})

describe('evidence on a tick, and when it is stale', () => {
  test('what a tick keeps parses as the store will hold it', () => {
    const kept = evidenceOf(change(), 'pipeline')!
    expect(evidenceSchema.parse(kept)).toEqual(kept)
    expect(kept.sha).toBe('4f6d7bbf9bdbf209913746fa669904fa5a0616ca')
  })

  test('nothing moved: not stale', () => {
    const kept = evidenceOf(change(), 'pipeline')!
    expect(staleness(kept, change())).toBeNull()
  })

  test('new commits make a fact about one commit stale, even when it still says the same', () => {
    const kept = evidenceOf(change(), 'pipeline')!
    const moved = change({}, { headSha: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1' })
    expect(staleness(kept, moved)).toBe('new commits since it was ticked (4f6d7bb → b2c3d4e); now pipeline: success at b2c3d4e')
  })

  test('a fact that reads differently now is stale, and says what it reads', () => {
    const kept = evidenceOf(issue({ labels: ['tested'] }), 'labels')!
    expect(staleness(kept, issue({ labels: [] }))).toBe('now labels: none')
  })

  test('a description edited since is stale, without quoting either', () => {
    const kept = evidenceOf(change(), 'description')!
    expect(staleness(kept, change({}, { body: 'Tabs were read as spaces, because of the lexer.' }))).toBe(
      'the description has changed since it was ticked',
    )
  })

  test('a fact the row no longer carries says nothing, and is not called stale', () => {
    const kept = evidenceOf(change(), 'files')!
    expect(staleness(kept, change({}, null))).toBeNull()
  })
})

describe('the reading, keyed for the page', () => {
  test('rows by ref, missing by ref, and a failed source’s reason', () => {
    const reading = trackerReadingResult.parse({
      at: '2026-10-05T10:00:00Z',
      refreshing: false,
      sources: [
        { tracker: 'gitlab', host: 'gitlab.com', repo: 'group/project', default: true, error: 'gitlab.com could not be reached' },
      ],
      rows: [change()],
      missing: [
        { ref: 'gh#9', reason: 'pending' },
        { ref: '!8', reason: 'failed' },
      ],
    })
    const facts = factsOf(reading, [], false)!
    expect(Object.keys(facts.rows)).toEqual(['!7'])
    expect(facts.missing).toEqual({ 'gh#9': 'pending', '!8': 'failed' })
    expect(facts.failed).toBe('gitlab.com could not be reached')
  })

  test('no reading is no facts, which draws nothing', () => {
    expect(factsOf(null, [], false)).toBeNull()
  })
})

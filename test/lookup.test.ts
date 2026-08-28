import { describe, expect, test } from 'bun:test'

import { generatedAt, index } from '../src/live/lookup.ts'

/**
 * The join between a selection and a host's reading.
 *
 * A selection carries refs and nothing else, deliberately — a host can vouch
 * that somebody picked these and cannot vouch for what they ARE. The kind comes
 * from the bag a refresh filed the reference in, and these tests are about that
 * one fact, because getting it wrong means the change list under an issue or the
 * issue list under a pull request.
 */
const reading = {
  generated: '2026-01-01T00:00:00.000Z',
  issues: { '2274': { state: 'opened', title: 'An issue', at: 'x', url: 'https://x/2274' } },
  mrs: { '1848': { state: 'opened', title: 'A change', at: 'x', url: 'https://x/1848', pipeline: 'success' } },
  ghIssues: { 'gh#131': { state: 'opened', title: 'A GitHub issue', at: 'x', url: 'https://x/131' } },
  ghPrs: { 'gh#105': { state: 'opened', title: 'A pull request', at: 'x', url: 'https://x/105', sha: 'abc' } },
}

describe('reading a host’s epic', () => {
  test('says which of two identically-spelled GitHub numbers is a pull request', () => {
    /* The whole reason this file exists. GitHub numbers issues and pull requests
       in one sequence, so neither ref says which it is; the bag does. */
    const found = index(reading)
    expect(found.get('gh#131')?.shape).toBe('work')
    expect(found.get('gh#105')?.shape).toBe('change')
  })

  test('rebuilds GitLab’s bare-number keys into the spelling people write', () => {
    const found = index(reading)
    expect(found.get('#2274')?.shape).toBe('work')
    expect(found.get('!1848')?.shape).toBe('change')
    /* And not under the bare number, which is how the host files them and not how
       anybody selects them. */
    expect(found.get('2274')).toBeUndefined()
  })

  test('hands back the state exactly as the host wrote it', () => {
    const found = index(reading)
    expect((found.get('!1848')?.state as { pipeline?: string } | null)?.pipeline).toBe('success')
  })

  test('a damaged entry keeps its shape and loses only its state', () => {
    /* A key is a reference. The reading was damaged, not absent — and knowing
       that gh#7 is a pull request is worth having even when nothing else about it
       could be read: it is the right list with empty verdicts rather than both
       lists with a shrug. */
    const found = index({ ghPrs: { 'gh#7': 'not an object' } })
    expect(found.get('gh#7')).toEqual({ state: null, shape: 'change' })
  })

  test('a key called constructor is a row about constructor, not a prototype', () => {
    /* `bag[ref]` with a ref off the wire answers with something inherited when
       the string is `constructor`, and this page would then hand
       `Function.prototype` to its own store as a tracker state. Enumeration has
       no such hazard, and the test is here because the code LOOKS like the
       hazardous shape. */
    const found = index({ ghIssues: { constructor: { state: 'opened', title: 'odd', at: 'x', url: 'https://x' } } })
    expect(found.get('constructor')?.shape).toBe('work')
    expect(found.size).toBe(1)
  })

  test('nothing at all is an empty index rather than a throw', () => {
    expect(index(null).size).toBe(0)
    expect(index('a string').size).toBe(0)
    expect(index({}).size).toBe(0)
  })

  test('says when the reading was taken, or admits it does not know', () => {
    expect(generatedAt(reading)).toBe('2026-01-01T00:00:00.000Z')
    expect(generatedAt({})).toBeNull()
  })
})

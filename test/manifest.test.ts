import { describe, expect, test } from 'bun:test'
import { METHOD_NAMES, PROTOCOL, manifestSchema, speaks } from 'roadmap-module-protocol'

import { ID, MANIFEST } from '../manifest.ts'

/**
 * The manifest is the only half of this program a host reads, and the whole of
 * the port from protocol 1 lives in it. So the things that changed are asserted
 * by name rather than by eye: a mode scope of `journey` and a `needs` block are
 * exactly what a host frames as INCOMPATIBLE, and the symptom is a pane that
 * refuses to open with no error in this repository at all.
 */
describe('the manifest', () => {
  test('is one a host will accept, parsed by the protocol package itself', () => {
    expect(() => manifestSchema.parse(MANIFEST)).not.toThrow()
  })

  test('speaks protocol 2, and says so in a range a host can compare', () => {
    expect(MANIFEST.protocol).toBe(PROTOCOL)
    expect(PROTOCOL).toBe(2)
    expect(speaks(MANIFEST.declares.protocol, PROTOCOL)).toBe(true)
    /* The refusal that the port exists to avoid: a module still claiming 1 is
       not degraded on a protocol-2 host, it is incompatible. */
    expect(speaks(MANIFEST.declares.protocol, 1)).toBe(false)
  })

  test('scopes its mode to an epic, which is the rename that raised the number', () => {
    expect(MANIFEST.modes).toHaveLength(1)
    expect(MANIFEST.modes[0]?.scope).toBe('epic')
  })

  test('declares live:read and nothing else, and every name is one the protocol knows', () => {
    expect(MANIFEST.declares.uses).toEqual(['live:read'])
  })

  test('every method this app calls is a real one, resolved from the protocol', () => {
    /* `live.get` is the only question this page asks. Asserting it against
       METHOD_NAMES rather than against a string in a test is the point: a typo
       here would be refused by a host as `unknown-method`, from inside a frame,
       with nothing in this repository to look at. */
    expect(METHOD_NAMES).toContain('live.get')
    expect(METHOD_NAMES).not.toContain('journeys.list' as never)
    expect(METHOD_NAMES).not.toContain('journey.get' as never)
  })

  test('asks for an origin, because it holds data and takes writes', () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('does not ask for a prompt, because it has nothing to do with one', () => {
    /* The reasoning is in `manifest.ts` at length. The assertion is here so that
       turning it on is a deliberate act with a failing test attached, rather than
       something that drifts true and starts a host offering readers a box whose
       contents this app would never read. */
    expect(MANIFEST.declares.prompt).toBe(false)
  })

  test('keeps its id, so ticks already filed under it are still this module’s', () => {
    expect(ID).toBe('roadmap.checklist')
  })
})

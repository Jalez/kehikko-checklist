import { describe, expect, test } from 'bun:test'
import { CAPABILITY_NAMES, EXTENSION_NAMES, METHOD_NAMES, PROTOCOL, manifestSchema, speaks } from 'roadmap-module-protocol'

import { FORMAT, ID, MANIFEST } from '../manifest.ts'

/**
 * The manifest is the only half of this program a host reads, and the whole of
 * the port from protocol 1 lives in it. So the things that changed are asserted
 * by name rather than by eye: a mode scope of `journey` and a `needs` block are
 * exactly what a host frames as INCOMPATIBLE, and the symptom is a container that
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

  test('declares exactly the two it calls, and every name is one the protocol knows', () => {
    /* `events:emit` for the one thing it says: an agent came through the MCP
       door — which is the one thing that happens to this app that nobody
       watching the screen can see. `state:keep` for the one thing it remembers:
       which checklist was picked, per kehikko.

       `live:read` is NOT here, and its absence is the assertion that matters.
       It was the only capability this module declared, and it existed to compute
       hardcoded, tracker-derived items from a reading a host handed over. There
       are no hardcoded items now. A capability asked for and never used is the
       fastest way to teach somebody to press yes without reading, so it is gone
       and this test is what stops it drifting back. */
    expect(MANIFEST.declares.uses).toEqual(['events:emit', 'state:keep'])
    expect(MANIFEST.declares.uses).not.toContain('live:read')
    /* Checked against the protocol's own list rather than against a string
       here: a capability a host does not know is not an error anywhere — it is
       simply a line in a manifest that means nothing, and this is the only
       place it can be caught. */
    for (const name of MANIFEST.declares.uses) {
      expect(CAPABILITY_NAMES as readonly string[]).toContain(name)
    }
  })

  test('emits the one format it emits, and consumes nothing', () => {
    expect(MANIFEST.extensions.emits).toEqual([FORMAT])
    /* A checklist that also showed other modules' announcements would be two
       panels in one container. */
    expect(MANIFEST.extensions.consumes).toEqual([])
  })

  test('the format it names is one this protocol can actually check', () => {
    /* A typo here is silent: the host would know no such format, refuse to
       carry the payload, and the only evidence would be a refusal inside a
       frame nobody has a console open on. */
    expect(EXTENSION_NAMES).toContain(FORMAT)
  })

  test('every method this app calls is a real one, resolved from the protocol', () => {
    /* `state.set` and `events.emit` are the only two questions this page asks.
       Asserting them against METHOD_NAMES rather than against a string in a test
       is the point: a typo here would be refused by a host as
       `unknown-method`, from inside a frame, with nothing in this repository to
       look at. */
    expect(METHOD_NAMES).toContain('state.set')
    expect(METHOD_NAMES).toContain('events.emit')
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

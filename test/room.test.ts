import { describe, expect, test } from 'bun:test'

import { room, wantedHeight, ROOM_TO_FLOW, ROOM_TO_SPREAD } from '../src/view/room.ts'

/**
 * The size table, held against the sizes this module is actually given.
 *
 * These are not tests of an implementation — `room` is nine lines of booleans
 * and nobody needs a test to know they work. What is being pinned down is the
 * DECISION: that at 220×300, which is the container this module spends most of its
 * life in, the explaining paragraphs are gone and the item list is a scroller of
 * its own; and that at 900×700 nothing is hidden and nothing is pinned, because
 * a page that folded itself away on a monitor would be answering a question
 * nobody asked.
 *
 * The four sizes below are the four `dev/room.probe.mjs` measures, so a
 * threshold changed here and not there stops agreeing with the only reading
 * anybody has of what it costs.
 */
describe('what a container of each size gets', () => {
  test('220×300 — the ordinary case: pinned, snapping, nothing explaining itself', () => {
    const it = room(220, 300)
    expect(it.pinned).toBe(true)
    expect(it.snap).toBe(true)
    expect(it.prose).toBe(false)
    expect(it.pageSwitch).toBe('glyph')
    expect(it.controls).toBe('under')
    expect(it.compose).toBe('overlay')
  })

  test('320×200 — wider and shorter, and the height is what decides', () => {
    /* The trap this catches: a table written on width alone would call 320 roomy
       and draw a 147-pixel add box into a 200-pixel frame. */
    const it = room(320, 200)
    expect(it.pinned).toBe(true)
    expect(it.compose).toBe('overlay')
    expect(it.prose).toBe(false)
    expect(it.controls).toBe('under')
  })

  test('460×360 — still short, so the list still gets its own scroller', () => {
    const it = room(460, 360)
    expect(it.pinned).toBe(true)
    expect(it.snap).toBe(true)
  })

  test('320×700 — tall but narrow: the box stays, the edit row stacks', () => {
    /* The pair that stops one threshold from being made to do two jobs. What
       made the create box wrong was 147 pixels of a 300-pixel FRAME, which is a
       height fact; what makes an edit row's buttons wrong beside its text is
       that they wrap below 360, which is a width fact. Measured: at 320 the
       controls beside the line cost 80px an item against 59px at 360 — so a
       container that drew them beside it here would spend more than one that
       put them underneath. */
    const it = room(320, 700)
    expect(it.compose).toBe('inline')
    expect(it.controls).toBe('under')
    expect(it.pinned).toBe(false)
    expect(it.prose).toBe(false)
  })

  test('900×700 — nothing is pinned, nothing is stacked, nothing is hidden', () => {
    const it = room(900, 700)
    expect(it.pinned).toBe(false)
    expect(it.snap).toBe(false)
    expect(it.prose).toBe(true)
    expect(it.pageSwitch).toBe('named')
    expect(it.controls).toBe('beside')
    expect(it.compose).toBe('inline')
  })

  test('the word on the page switch is a WIDTH decision, and pays in a tall column too', () => {
    /* The trap this catches, and it is the mirror of the one above: what `Edit`
       costs is horizontal — it takes the room the list's name needs on the same
       row, and the name then wraps. A tall narrow column pays that exactly as a
       short one does, so a table that tied this to `tall` would draw the word at
       320x700 and spend the nineteen pixels the probe measured. */
    expect(room(320, 700).pageSwitch).toBe('glyph')
    expect(room(900, 200).pageSwitch).toBe('named')
  })

  test('a container that has not been measured yet is treated as the small one', () => {
    /* Zero is the first render, before the observer has said anything. Guessing
       roomy and collapsing a frame later is the flicker `use-roadmap.ts` spends
       a paragraph avoiding; collapsing to the layout that always fits is the
       guess that is never wrong about what fits. */
    const it = room(0, 0)
    expect(it.pinned).toBe(true)
    expect(it.compose).toBe('overlay')
  })

  test('snapping only ever happens where there is a scroller of our own', () => {
    /* A snap point on the document scroller would snap the header away, which is
       worse than no snapping at all. */
    const sizes: [number, number][] = [[220, 300], [320, 200], [460, 360], [900, 700], [1200, 419], [1200, 420]]
    for (const [w, h] of sizes) {
      expect(room(w, h).snap).toBe(room(w, h).pinned)
    }
  })

  test('the thresholds are exclusive at the bottom and inclusive at the top', () => {
    expect(room(1200, ROOM_TO_FLOW - 1).pinned).toBe(true)
    expect(room(1200, ROOM_TO_FLOW).pinned).toBe(false)
    expect(room(ROOM_TO_SPREAD - 1, 700).controls).toBe('under')
    expect(room(ROOM_TO_SPREAD, 700).controls).toBe('beside')
    expect(room(ROOM_TO_SPREAD - 1, 700).pageSwitch).toBe('glyph')
    expect(room(ROOM_TO_SPREAD, 700).pageSwitch).toBe('named')
  })
})

describe('the height this page asks its host for', () => {
  test('flowing, it is the shell — which is the whole document, as it always was', () => {
    expect(wantedHeight(640, 0, 0)).toBe(640)
  })

  test('pinned, it adds back what the inner scroller is hiding', () => {
    /* Otherwise a pinned page reports the frame height it was given, for ever,
       and a host willing to grow this container is never asked to. */
    expect(wantedHeight(300, 1100, 200)).toBe(1200)
  })

  test('a scroller with nothing hidden adds nothing, so it settles', () => {
    /* The second reading after a host has grown the frame. If this did not
       settle, every host that honoured a resize would be resized for ever. */
    expect(wantedHeight(1200, 1100, 1100)).toBe(1200)
  })

  test('a scroller scrolled past its content cannot make the answer smaller', () => {
    expect(wantedHeight(300, 100, 200)).toBe(300)
  })
})

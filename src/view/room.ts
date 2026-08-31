/**
 * How much room this container has, and what that buys.
 *
 * ## Why this is a function and not a handful of classes in the JSX
 *
 * Every decision below is a claim about a size, and a claim about a size is the
 * kind of thing that is quietly wrong for a year. Written as `@max-[18rem]/container:hidden`
 * on one element and a `height < 400` in a component somewhere else, the two
 * would disagree the first time either moved and nothing would say so. Here they
 * are one table, in one file, with a test that holds each threshold against the
 * measurement it came from — so "what is on screen at 220×300" is a question
 * with an answer that can be read rather than reconstructed from six class
 * strings.
 *
 * ## Why the WIDTH is not a container query, when everything else in this app is
 *
 * It still is one, in the only sense that matters: `width` here is the width of
 * the container element, measured by a `ResizeObserver` on it — never
 * `window.innerWidth`, which is the frame's viewport and is a different number
 * the moment anything wraps this page. `src/index.css` says the rule and this
 * obeys it; what changed is where the answer is spelled.
 *
 * The reason it is spelled in TypeScript is the height. There is no container
 * query for it — `container-type: inline-size` measures one axis on purpose, and
 * `size` containment would require this app to declare its own height, which is
 * the one thing it does not know, since the host decides it. So the height
 * decisions have to be a piece of state fed by a `ResizeObserver` regardless.
 * Splitting the table so that the width half lived in CSS and the height half in
 * state would be two sources for one question, which is the defect this codebase
 * argues against on nearly every page. A purely cosmetic width variant —
 * padding, a font size, something with no consequence for what is reachable —
 * still belongs in a `@…/container:` class; this file is for the decisions about
 * what is on screen at all, which are the ones worth being able to read in one
 * place and test.
 *
 * ## The numbers, and where they came from
 *
 * `dev/room.probe.mjs` frames this app at four sizes and measures it. Before any
 * of this existed, with six ordinary items in the list:
 *
 *     220×300   160px of fixed chrome above the first item (53% of the frame),
 *               0 of 6 items fully visible, 1202px of document in a 300px box
 *     320×200   128px of chrome (64% of the frame), 0 of 6 items visible
 *     460×360   112px of chrome, 3 of 6 items visible
 *     900×700   96px of chrome, 6 of 6 visible, nothing scrolls
 *
 * And after, with the same six items:
 *
 *     220×300   78px of chrome, the items own the rest of the frame and scroll
 *               inside it, the page itself does not scroll at all, and a 40px
 *               nudge settles one pixel off an item boundary
 *     320×200   78px of chrome; the one long item is taller than the 92px the
 *               list gets, and the browser correctly declines to snap an area
 *               bigger than its scrollport — which is the argument for
 *               `proximity` rather than `mandatory`, made by the browser
 *     460×360   78px of chrome, 4 of 6 fully visible, nudge lands flush
 *     900×700   unchanged in every respect: 96px, 6 of 6, nothing folded
 *
 * So the thresholds are the places those readings change character rather than
 * round numbers: below `ROOM_TO_FLOW` the header and the items cannot both be on
 * screen and one of them has to be pinned; below `ROOM_TO_SPREAD` a row's
 * furniture wraps and costs more than folding it away would.
 */

/**
 * The height at which the checklist stops needing to be pinned.
 *
 * Above it the whole card fits or nearly fits and the document can simply flow,
 * which is what it did before any of this and is still the right answer when
 * there is space: one scrollbar, nothing sticky, and a host free to grow the
 * frame to the height this page asks for.
 *
 * 420 rather than 360, because at 360 the measurement above found three of six
 * items reachable with the header still on screen — pinning is what makes the
 * other three reachable without losing sight of which target the ticks are
 * about. Above 420 the fixed chrome (96px) plus the add box (107px) leaves room
 * for three or four items, and a page that pinned itself there would be putting
 * a second scrollbar inside a frame that did not need one.
 */
export const ROOM_TO_FLOW = 420

/**
 * The width at which a row can carry its furniture beside its text.
 *
 * Measured on one short item — "Say who owns the trust chapter." — in a tall
 * frame, so that only the width was moving:
 *
 *     220   the meta row wraps to two lines; the item is 89px tall
 *     280   still two lines; 73px
 *     320   the three buttons drop below the name: 45px of meta, 80px item
 *     360   name and buttons on one line: 24px of meta, 59px item
 *     900   the same 24px and 59px — nothing above 360 buys anything
 *
 * So 360, and 320 is emphatically the wrong side of it: a container that drew the
 * controls inline there would spend MORE per item than one that folded them
 * away, which is the shape of a threshold picked by eye rather than measured.
 */
export const ROOM_TO_SPREAD = 360

export interface Room {
  /**
   * The name, the count and the target stay put while the items scroll under
   * them.
   *
   * What it buys is not the pinning — it is that the item list becomes a
   * scroller of its own, which is the only thing that makes a snap point mean
   * anything. With the whole document scrolling, "bring the next item fully into
   * view" has to fight the header for the top of the frame.
   */
  pinned: boolean
  /**
   * Scroll snapping on the item list, and it is `proximity` rather than
   * `mandatory`.
   *
   * The owner asked for exactly this: "scrolling the next item to be fully
   * visible when scrolling just a little". `proximity` is what that sentence
   * says — a small scroll near a boundary completes it, and a deliberate long
   * drag is left alone. `mandatory` says something else and something worse: it
   * commits the scroller to a snap position at all times, so a flick past four
   * items lands on a boundary the reader did not aim at, and an item taller than
   * the frame — this list holds 400 characters of whatever somebody typed — is
   * a snap area you have to fight to read the middle of.
   *
   * Only ever true with `pinned`, because a snap point on the document scroller
   * would snap the header away.
   */
  snap: boolean
  /**
   * The explaining paragraphs: what a target means for a tick, what an item
   * belongs to.
   *
   * True and, in a 220-pixel column, unread — the standing complaint about every
   * module here. They are dropped rather than shortened because there is a
   * shorter thing already on screen saying the same: the row above the paragraph
   * says which target this is, and the paragraph says ticks belong to it.
   *
   * What is NEVER dropped is a sentence that says why something is not working:
   * "nothing has said what this list is held against, so nothing below can be
   * ticked" is the difference between an inert row and a broken one, and it is
   * drawn at every size.
   */
  prose: boolean
  /**
   * "written by …" under an item nobody has ticked.
   *
   * The tick's own provenance — who ticked it, and whether it came through the
   * MCP door — is not covered by this and is never dropped at any size. That is
   * the promise `list/checklists.ts` makes about an agent's claims being legible
   * as claims, and a size is not a reason to break it. Who first typed a line is
   * a different and much smaller fact; at small sizes it moves into the row's
   * `title`.
   */
  authorship: boolean
  /**
   * Move-up, move-down and remove: on every row, or behind one press on the row
   * that wants them.
   *
   * Three buttons and their line cost more per item than the item does at 220
   * wide. Folded they are one small control, and reordering — which is a thing
   * somebody does once in a while to a list they are looking at — costs one
   * extra press.
   */
  controls: 'inline' | 'folded'
  /**
   * Writing something: in a strip at the bottom of the card, or over the whole
   * frame.
   *
   * At 220×300 the add box measured 147 pixels — half the frame — to hold a
   * two-line textarea somebody uses for a few seconds at a time. As an overlay
   * it costs one button until it is wanted and then gets the whole frame, which
   * is more room to type in than it ever had inline.
   */
  compose: 'inline' | 'overlay'
}

/** What a container of this size gets. */
export function room(width: number, height: number): Room {
  const tall = height >= ROOM_TO_FLOW
  const wide = width >= ROOM_TO_SPREAD
  return {
    pinned: !tall,
    snap: !tall,
    prose: tall && wide,
    authorship: tall,
    controls: tall && wide ? 'inline' : 'folded',
    /* Height alone, and deliberately not width. What made the strip wrong was
       that it was 147 pixels of a 300-pixel FRAME; a 320-pixel column with 700
       pixels of height has room for it and is better served by a box that is
       simply there than by one behind a press. */
    compose: tall ? 'inline' : 'overlay',
  }
}

/**
 * The height this page would like its frame to be, when part of it is scrolling
 * inside itself.
 *
 * `resize` has always reported the height of the drawn shell, which was the
 * whole document. Pinned, the shell is exactly as tall as the frame — so
 * reporting it would tell every host "the size you already gave me is right",
 * for ever, and a host willing to grow this container would never be asked to.
 *
 * So what is reported is the shell plus whatever the inner scroller is hiding.
 * A host that honours it grows the frame, the frame passes `ROOM_TO_FLOW`, the
 * pinning switches off and the document flows again — which is the same answer
 * this page gave before any of this, arrived at from the other direction. A host
 * that ignores it changes nothing.
 *
 * There is no loop in that: growing the frame does not grow the content, so the
 * second reading is the first one and it settles.
 */
export function wantedHeight(shell: number, scrollHeight: number, clientHeight: number): number {
  return Math.ceil(shell) + Math.max(0, Math.ceil(scrollHeight - clientHeight))
}

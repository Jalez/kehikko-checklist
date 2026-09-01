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
 * furniture wraps and costs more than moving it would.
 *
 * ## And again, after the card became two pages
 *
 * The same probe, the same six items, the same four sizes. `chrome` is the fixed
 * strip above the first item; `rows` is what those six items add up to; `asked`
 * is the height this page tells its host it would like to be.
 *
 *                 chrome        rows          fully visible   asked
 *     220×300     78 → 83       533 → 437     1 → 2           673 → 545
 *     320×200     78 → 83       344 → 297     0 → 1           484 → 405
 *     460×360     78 → 83       308 → 257     4 → 6           448 → 376
 *     900×700     96 → 101      373 → 217     6 → 6           639 → 343
 *
 * **Five pixels of chrome, at every size, and it is the page switch's own
 * height.** That is the whole cost of the split, and it is paid once. What it
 * bought is the row: at 900×700 an ordinary item went from 59 pixels to 33,
 * because "ticked by claude, over MCP" and the three inline controls were a
 * second line under every single one of them. Chrome is paid once and a row is
 * paid sixteen times, which is why a table that only watched the first number
 * would have called this change a regression.
 *
 * The `fully visible` column is the reading that matters at 220×300, which is
 * where this module lives: one item to two. At 460×360 it is four to six, which
 * is the whole list.
 *
 * The edit page measures 129 pixels of chrome above its first item at every
 * size — the header, and the box to type in, which is 83 of it. That box is not a
 * regression of the 147-pixel strip this file was written about: it is on a page
 * a reader pressed a button to reach, and it is not in front of the list they
 * spend their day looking at.
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
   * The press that moves between the two pages: the word, or a glyph carrying
   * the word in its label.
   *
   * ## Nineteen pixels, found by the probe rather than by reasoning
   *
   * The press sits on the header row beside the list's name and the count, and
   * that row does not wrap — the NAME does. `Edit` at `container` size is about
   * forty-four pixels wide. Measured with `dev/room.probe.mjs` at 220×300
   * against a list called "What a change owes": with the word drawn, the name no
   * longer fitted on one line and the chrome above the first item went from 78
   * pixels to 97. With a glyph it is 83. Nineteen pixels of a three-hundred-pixel
   * frame, spent on four letters, in the container this module spends its life
   * in — which is exactly the shape of thing this file exists to catch, and it
   * was caught by measuring rather than by looking at the JSX and thinking it
   * looked fine.
   *
   * The remaining five pixels are the press's own height — `container` is 24
   * against a 19-pixel line of text — and they are not negotiable. Every press on
   * this page is the same height, which is the argument in
   * `src/components/ui/button.tsx`, and a page with one smaller button on it is a
   * page whose smallest target is the one nobody notices is smaller.
   *
   * ## The word is never actually lost
   *
   * `glyph` is about what is DRAWN. The button keeps `Edit` / `Done` in an
   * `sr-only` span and in its `title` at every size, so nothing reading the page
   * rather than looking at it can tell the difference — the same arrangement
   * every other small control in this module uses, and the reason none of them is
   * a bare glyph.
   */
  pageSwitch: 'named' | 'glyph'
  /**
   * Move-up, move-down and remove on an edit-page row: beside the line, or on
   * their own line under it.
   *
   * ## This field used to say something else, and the change is worth reading
   *
   * It was `'inline' | 'folded'`, and `folded` meant the three buttons went
   * behind a `⋯` press on the row that wanted them — because at 220 pixels they
   * cost more per item than the item did, on every row, forever.
   *
   * They are not on every row any more. Reordering, rewording and removing live
   * on a page of their own now (see the essay in `src/view/checklist.tsx`), so
   * the list a reader spends their day looking at carries no furniture at all
   * and the fold has nothing left to hide. What survives of the measurement is
   * the other half of it: the reading in `ROOM_TO_SPREAD` said that below 360
   * pixels a row cannot carry its buttons BESIDE its text without wrapping to
   * two lines anyway. That is still true and still decides something — on the
   * edit page the buttons go under the line rather than beside it — so the
   * threshold keeps its meaning and only the two words change.
   *
   * `under` is not a fold: both controls are drawn and reachable at every size.
   * Nothing here is behind a press.
   */
  controls: 'beside' | 'under'
  /**
   * A box to type in: in a strip on the card, or over the whole frame.
   *
   * At 220×300 the add box measured 147 pixels — half the frame — to hold a
   * two-line textarea somebody uses for a few seconds at a time. As an overlay
   * it costs one button until it is wanted and then gets the whole frame, which
   * is more room to type in than it ever had inline.
   *
   * Two things read this now and they are on two different screens: the create
   * box on the pick screen (`src/view/choose.tsx`), which is what it was written
   * for, and the target picker, which opens over the frame rather than pushing
   * the list it is about off the bottom. The add box is no longer one of them —
   * it lives on the edit page, which is a whole frame already.
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
    /* Width alone. What the word costs is horizontal — it takes the room the
       list's NAME needs on the same row — so a tall narrow column pays for it
       exactly as a short one does. */
    pageSwitch: wide ? 'named' : 'glyph',
    controls: tall && wide ? 'beside' : 'under',
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

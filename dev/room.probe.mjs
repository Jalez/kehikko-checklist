/**
 * What this module actually looks like at the sizes it is actually given.
 *
 *     PLAYWRIGHT=/path/to/playwright CHROME=/path/to/chrome-headless-shell \
 *       node dev/room.probe.mjs
 *
 * ## Why a probe and not a component test
 *
 * Because every claim in `src/view/room.ts` is a claim about PIXELS, and a
 * component test renders into happy-dom, which has no layout. `render()` will
 * tell you an element exists; it cannot tell you that it is 160 pixels down a
 * 300-pixel frame with nothing under it, which is the entire finding this whole
 * change was made in answer to. So the assertions about words live in
 * `test/render.test.tsx`, the assertions about thresholds live in
 * `test/room.test.ts`, and the MEASUREMENTS live here, run by hand, printed as
 * numbers somebody reads.
 *
 * ## What it has to build first
 *
 * A host. This app is a module: unframed it has no project and draws the "no
 * project is open" screen, so there is nothing to measure. So this stands up a
 * page that frames it and speaks the greeting, and it must be served over HTTP
 * from an origin the module's own `frame-ancestors` allows — hence `PORT` and
 * `ROADMAP_ORIGIN` below. A `page.setContent` harness is blocked by CSP before
 * the frame loads, silently, which costs twenty minutes if you have not seen it.
 *
 * It seeds through the app's own API using the ticket the served page carries,
 * rather than writing JSON into the project by hand: the store's file format is
 * the store's business, and a probe that wrote it directly would be a second
 * writer to keep in step.
 *
 * ## What it found
 *
 * Before (six ordinary items, one of them long, one ticked):
 *
 *     220×300   160px of chrome above the first item, 0 of 6 items fully
 *               visible, 1202px of document in a 300px box, add box 147px
 *     320×200   128px of chrome, 0 of 6 visible
 *     460×360   112px of chrome, 3 of 6 visible
 *     900×700   96px of chrome, 6 of 6 visible, nothing scrolls
 *
 * After:
 *
 *     220×300   78px of chrome, the items own the rest of the frame and scroll
 *               inside it, the PAGE does not scroll at all, 1 of 6 fully visible
 *               at rest (the first item is eight lines at this width), and a
 *               40-pixel nudge settles one pixel off an item boundary
 *     320×200   78px of chrome, 0 fully visible — the long first item is taller
 *               than the 92px the list gets, and the browser then declines to
 *               snap, because a snap area bigger than its scrollport has no
 *               valid alignment. That is the argument for `proximity` over
 *               `mandatory` being made by the browser rather than by an essay.
 *     460×360   78px of chrome, 4 of 6 fully visible, nudge lands flush
 *     900×700   unchanged in every respect: 96px, 6 of 6, nothing pinned,
 *               nothing folded, nothing hidden, no page scroll
 *
 * ## And what it found the second time, when the card became two pages
 *
 * Run against the change and then against `git stash`, which is the only way
 * these numbers mean anything — a probe that passes both ways proves nothing.
 * `chrome` is the fixed strip above the first item, `rows` is what the six items
 * add up to, `asked` is the height this page tells its host it wants:
 *
 *                 chrome        rows          fully visible   asked
 *     220×300     78 → 83       533 → 437     1 → 2           673 → 545
 *     320×200     78 → 83       344 → 297     0 → 1           484 → 405
 *     460×360     78 → 83       308 → 257     4 → 6           448 → 376
 *     900×700     96 → 101      373 → 217     6 → 6           639 → 343
 *
 * Five pixels of chrome at every size — the page-switch press's own height, paid
 * once — against 26 pixels a row at 900×700, paid sixteen times on a real list.
 * The row shrank because "ticked by claude, over MCP" and the three inline
 * controls were a whole second line under every item; the provenance is gone
 * (the owner's judgement) and the controls are on the edit page.
 *
 * It also found a real bug in this probe: `window.asked` is the LAST
 * `roadmap.resize` the harness heard, and the edit page is measured by clicking
 * into it — so reading `asked` at the bottom of the loop reported the height the
 * other page wanted under a heading that said this one. 838 against a state page
 * asking for 545. It is read before the switch now.
 *
 * And the nineteen pixels that made `room.pageSwitch` exist: with `Edit` drawn
 * as a word, the header row at 220 could not hold the list's name beside it and
 * the name wrapped — 97 pixels of chrome rather than 83. The word is a glyph
 * below 360 pixels and an `sr-only` label at every size.
 *
 * It also found the reason a pinned card scrolled off the top of its own frame:
 * every `sr-only` label on this page is `position: absolute`, and an absolutely
 * positioned box is clipped by an ancestor's overflow only when that ancestor is
 * also its containing block. Without `relative` on the card they resolved
 * against the initial containing block, escaped the new scroller, and made the
 * document 188 pixels taller than the frame while every element on it measured
 * as fitting.
 */
import { createServer } from 'node:http'

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright'
const CHROME = process.env.CHROME
const PORT = Number(process.env.PORT ?? 7861)
const HOST_PORT = Number(process.env.HOST_PORT ?? 4183)
const PROJECT = process.env.PROJECT ?? '/tmp/checklist-probe/proj'
const APP = `http://127.0.0.1:${PORT}/app`
const SIZES = [[220, 300], [320, 200], [460, 360], [900, 700]]

/* `playwright` puts `chromium` on the namespace and `playwright-core` puts it on
   the default export. Both are ordinary things to have on a machine, and a probe
   that only knows one of them fails with `Cannot read properties of undefined`,
   which reads as a broken probe rather than as the wrong package. The trap was
   already written down in `dev/filters.probe.mjs`; this file did not have the
   fallback and cost the time anyway, so it has it now. */
const pw = await import(PLAYWRIGHT)
const chromium = pw.chromium ?? pw.default?.chromium
if (!chromium) throw new Error(`probe: ${PLAYWRIGHT} exports no chromium`)

const ITEMS = [
  'Every claim in the bridge chapter that says the wire is synchronous has to go, including the figure caption, which is the one somebody will quote.',
  'Run the extraction against the new head.',
  'Say who owns the trust chapter.',
  'The vocabulary table and the prose disagree about "mode"; pick one.',
  'Rebase onto main and re-read the diff.',
  'Ask the owner whether the agents chapter still needs the appendix.',
]

const harness = (w, h) => `<!doctype html><body style="margin:0">
<iframe id="f" src="${APP}" style="width:${w}px;height:${h}px;border:0;display:block"
 sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>
<script>
const ctx = { epic: null, project: 'Probe', projectPath: ${JSON.stringify(PROJECT)}, theme: 'light', selection: ['gh#105'], kehikko: { id: 1, name: 'Probe' } }
const f = document.getElementById('f')
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'roadmap.ready') window.greeted = true
  if (e.data && e.data.type === 'roadmap.resize') window.asked = e.data.height
})
f.addEventListener('load', () => {
  setInterval(() => f.contentWindow.postMessage({ type:'roadmap.hello', protocol:2, session:'probe', context: ctx, state: null }, '*'), 200)
})
</script></body>`

let current = harness(900, 700)
const server = createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(current)
})
await new Promise((r) => server.listen(HOST_PORT, '127.0.0.1', r))

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {})
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })

async function open(w, h) {
  current = harness(w, h)
  await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'load' })
  const frame = await (await page.waitForSelector('#f')).contentFrame()
  await page.waitForFunction(() => window.greeted === true, null, { timeout: 15000 })
  await frame.waitForSelector('[data-checklist]', { timeout: 15000 }).catch(() => {})
  /* The pick screen is a real screen and has to be got past, deliberately: this
     app opens on it until somebody chooses, which is the point of it. */
  if (!(await frame.$('section[data-checklist]'))) await frame.click('button[data-checklist]')
  await frame.waitForSelector('section[data-checklist]', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(600)
  return frame
}

let frame = await open(900, 700)
await frame.evaluate(async ({ project, items }) => {
  const ticket = JSON.parse(document.getElementById('ticket').textContent)
  const post = (b) =>
    fetch('/api/checklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-checklist-ticket': ticket },
      body: JSON.stringify(b),
    }).then((r) => r.json())
  const read = (id) =>
    fetch(`/api/checklist?id=${id}&ref=gh%23105&project=${encodeURIComponent(project)}`).then((r) => r.json())
  const lists = await fetch(`/api/checklists?project=${encodeURIComponent(project)}`).then((r) => r.json())
  let id = (lists.lists || []).find((l) => l.name === 'What a change owes')?.id
  if (!id) id = (await post({ op: 'create', name: 'What a change owes', project })).id
  const have = new Set(((await read(id)).held?.rows || []).map((r) => r.item.text))
  for (const text of items) if (!have.has(text)) await post({ op: 'add', id, text, project })
  const again = await read(id)
  if (again.held.rows[1] && !again.held.rows[1].done) {
    await post({ op: 'tick', id, item: again.held.rows[1].item.id, ref: 'gh#105', done: true, project })
  }
}, { project: PROJECT, items: ITEMS })

const measure = () =>
  frame.evaluate(() => {
    const items = [...document.querySelectorAll('li[data-item]')]
    const list = items[0]?.parentElement
    const box = list ? list.getBoundingClientRect() : null
    /* "Fully visible" is measured against the SCROLLER, not the frame, because
       that is what a reader is looking into. Half an item under the fold reads
       as a bug whichever box clipped it. */
    const whole = items.filter((el) => {
      const r = el.getBoundingClientRect()
      return box ? r.top >= box.top - 1 && r.bottom <= box.bottom + 1 : r.top >= -1 && r.bottom <= innerHeight + 1
    })
    return {
      viewport: [innerWidth, innerHeight],
      bodyScrollH: document.body.scrollHeight,
      bodyScrollW: document.body.scrollWidth,
      /* Asked by TRYING it, not by comparing scrollHeights. `documentElement.
         scrollHeight` inside a frame answers with a number left over from
         before the layout settled — it said 557 in a 300-pixel frame whose body
         was measurably 300 — and a probe that reports a scrollbar nobody has is
         worse than one that reports nothing. */
      pageScrolls: (() => {
        const was = window.scrollY
        window.scrollTo(0, 9999)
        const moved = window.scrollY !== was
        window.scrollTo(0, was)
        return moved
      })(),
      listOwnScroller: list ? list.scrollHeight > list.clientHeight + 1 : false,
      items: items.length,
      fullyVisible: whole.length,
      /* Per-row height, which is the other half of "how much of the list can I
         see". Chrome is paid once and a row is paid sixteen times, so a probe
         that reported only the first would miss the larger number every time. */
      itemHeights: items.map((el) => Math.round(el.getBoundingClientRect().height)),
      chromeAboveItems: items[0] ? Math.round(items[0].getBoundingClientRect().top) : null,
      addBoxOnCard: Boolean(document.getElementById('add-item')),
      snap: list ? getComputedStyle(list).scrollSnapType : null,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }
  })

const report = []
for (const [w, h] of SIZES) {
  frame = await open(w, h)
  const at_rest = await measure()
  /* Read HERE and not at the bottom of the loop. `window.asked` is the last
     `roadmap.resize` the harness heard, and the edit page is measured further
     down by clicking into it — so a read after that reports the height the OTHER
     page asked for, under a heading that says this one. It did, for one run, and
     the number was 838 against a state page that wanted 536. */
  const asked = await page.evaluate(() => window.asked ?? null)

  /*
   * The owner's actual sentence, turned into a number: "scrolling the next item
   * to be fully visible when scrolling just a little". So scroll a little — less
   * than one item — let the snap settle, and ask where the top of the scroller
   * has landed. Flush against an item boundary is the whole claim.
   */
  const nudged = await frame.evaluate(async () => {
    const list = document.querySelector('[data-scroller]')
    if (!list) return null
    list.scrollTo({ top: 40, behavior: 'smooth' })
    await new Promise((r) => setTimeout(r, 900))
    const tops = [...list.querySelectorAll('li[data-item]')].map((el) =>
      Math.round(el.getBoundingClientRect().top - list.getBoundingClientRect().top),
    )
    return { scrolledTo: Math.round(list.scrollTop), offBySmallest: Math.min(...tops.map((t) => Math.abs(t))) }
  })

  /*
   * And the same reading on the OTHER page.
   *
   * The card is two pages now — what is ticked, and what can be edited — and a
   * probe that only measured the first would be measuring half the module and
   * would say nothing about the half where all the controls went. See the essay
   * on `ChecklistView`.
   *
   * The switch is found by `data-page-to` rather than by its words, because the
   * words are a size decision (`room.pageSwitch`): below 360 pixels the press is
   * a glyph with `Edit` in its label, and a probe that clicked on the text would
   * find nothing at exactly the size this module is usually run at.
   */
  const editing = await frame.evaluate(async () => {
    const to = document.querySelector('[data-page-to="edit"]')
    if (!to) return null
    to.click()
    await new Promise((r) => setTimeout(r, 300))
    const items = [...document.querySelectorAll('li[data-item]')]
    const box = document.getElementById('add-item')
    return {
      chromeAboveItems: items[0] ? Math.round(items[0].getBoundingClientRect().top) : null,
      addBox: box ? Math.round(box.getBoundingClientRect().height) : null,
      /* The whole strip the box stands in, which is what a reader actually pays
         for: the textarea, the Add press and the gaps between them. */
      addStrip: box?.parentElement ? Math.round(box.parentElement.getBoundingClientRect().height) : null,
      items: items.length,
      moveReachable: Boolean(document.querySelector('[title="Move up"]')),
      rewordReachable: Boolean(document.querySelector('[data-reword]')),
      /* Nothing on this page names a target, which is the decision worth
         watching rather than assuming: an edit is a change to the LIST. */
      targetRow: Boolean(document.querySelector('[data-strip]')),
      pageScrolls: (() => {
        const was = window.scrollY
        window.scrollTo(0, 9999)
        const moved = window.scrollY !== was
        window.scrollTo(0, was)
        return moved
      })(),
    }
  })

  report.push({
    size: `${w}×${h}`,
    asked,
    ...at_rest,
    nudged,
    editing,
    askedEditing: await page.evaluate(() => window.asked ?? null),
  })
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
server.close()

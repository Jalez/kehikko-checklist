/**
 * Whether the top and the bottom of the reading page can be reached, in WebKit.
 *
 *     PORT=9960 HOST_PORT=9961 PROJECT=/path/to/a/project PASSAGE=/path/to/a/file/in/it \
 *       PLAYWRIGHT=/path/to/playwright-core/index.mjs node dev/scroll.probe.mjs
 *
 * `PROJECT` holds several checklists against `EPIC` (default `thesis`) and the
 * file `PASSAGE` names, so that the page draws more than one list. Start the
 * module yourself first, on `PORT`, with `KEHIKOT_ORIGIN=http://127.0.0.1:<HOST_PORT>`
 * so that this probe's page may frame it, and with `KEHIKOT_MODULES_DIR`
 * pointing at a scratch directory — without it a start rewrites the real
 * registration.
 *
 * FRAMED, like `dev/room.probe.mjs` and for its reason, and for one more: the
 * page on its own draws a heading of its own above the lists, which at 220×300
 * leaves the scroller too short to show the defect at all. The sizes below are
 * the frame's.
 * `SHOTS=<dir>` writes a screenshot per size and scheme; `TAG` names them.
 * Exits 1 when any size fails, so it can stand in a script.
 *
 * ## Why a probe and not a component test
 *
 * Scroll snapping is the browser's, and happy-dom has no layout and no
 * scrolling. `test/render.test.tsx` holds the half that can be said there —
 * every list's header is a snap area — and this holds the half that cannot:
 * where the scroller actually comes to rest.
 *
 * ## Why WebKit
 *
 * The desktop app is a WebKit view, and this defect was WebKit's reading of
 * `scroll-snap-type: y proximity`. The scroller's only snap areas were the item
 * rows, so the first snap position was the first ROW of the first list — 48
 * pixels down when the list's name fits on one line, under that name, its label
 * and its Edit press. WebKit treats the start of the scroller as within
 * proximity of a snap position that close (48 and 67 pixels were, in scrollers
 * 163 and 263 pixels tall; 106 was not, and 48 was not in one 83 pixels tall),
 * so offset 0 was not a place the scroller could rest: `scrollTo(0)`, a wheel
 * and a real press on the fold button all came back to 48, and the header could
 * not be brought into view at all (issue #16). It needs a list with a SHORT
 * name to show — a name that wraps to four lines puts the first row out of
 * proximity — which is why it was seen in one project and not in another.
 *
 * Run against `git stash` as well as against the change, like the other probes
 * here: 220×300, 300×200 and 463×300 fail before and pass after.
 *
 * ## What it found that it did not fix
 *
 * A list arriving ABOVE the reader's place while the scroller rests off a snap
 * position moves what is in view: at 300×200, 180 → 220 on a part pick and 87
 * on its release. On a snap position the browser follows the snapped row and
 * nothing in view moves. It is the same before and after this change.
 *
 * And at 220×120 the edit page's box to type in is not in the frame — that
 * page's strip above its list is taller than the frame. Also unchanged.
 *
 * What it reads, at each size:
 *
 *     rest      `scrollTop` once the page has drawn
 *     top       after `scrollTo(0)`, and what is at the scroller's top edge
 *     wheel     after wheeling up from the middle
 *     bottom    after `scrollTo(max)`: the last row's bottom edge against the
 *               scroller's, and whether the strip under it is still in the frame
 *     fold      `scrollTop` across folding and unfolding the first list
 *     pick      `scrollTop` across a part being picked and released (`PART`)
 *     typed     on the edit page: words in the box, the list at its end, and a
 *               context arriving — the words and the scroll are still there
 */
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright-core'
const PORT = Number(process.env.PORT ?? 7860)
const HOST_PORT = Number(process.env.HOST_PORT ?? 4183)
const PROJECT = process.env.PROJECT
const EPIC = process.env.EPIC ?? 'thesis'
const PASSAGE = process.env.PASSAGE ?? null
/** A paper file, relative to the paper as a part names it, that the passage is in. */
const PART = process.env.PART ?? null
const SHOTS = process.env.SHOTS ?? null
const TAG = process.env.TAG ?? 'scroll'
const SIZES = (process.env.SIZES ?? '220x300,220x120,300x200,463x300,900x700')
  .split(',')
  .map((one) => one.split('x').map(Number))
const SCHEMES = (process.env.SCHEMES ?? 'dark,light').split(',')

if (!PROJECT) throw new Error('probe: PROJECT is the project whose checklists to draw')

const pw = await import(PLAYWRIGHT)
const webkit = pw.webkit ?? pw.default?.webkit
if (!webkit) throw new Error(`probe: ${PLAYWRIGHT} exports no webkit`)

const { createServer } = await import('node:http')
let current = ''
const server = createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(current)
})
await new Promise((r) => server.listen(HOST_PORT, '127.0.0.1', r))
const harness = (w, h, scheme) => `<!doctype html><body style="margin:0;background:${scheme === 'dark' ? '#111' : '#eee'}">
<iframe id="f" src="http://127.0.0.1:${PORT}/app" style="width:${w}px;height:${h}px;border:0;display:block"
 sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe></body>`

const context = (theme, picked = false) => ({
  epic: EPIC,
  project: 'Probe',
  projectPath: PROJECT,
  theme,
  selection: [],
  kehikko: { id: 1, name: 'Probe' },
  prompt: null,
  pinned: false,
  passage: PASSAGE ? { path: PASSAGE } : null,
  /* One part, holding the file in front, so picking it leaves the same lists
     drawn: what is read is the scroll, across a pick and its release. */
  parts: PART ? [{ id: 'probe', heading: 'Probe', refs: [], picked, files: [PART] }] : [],
})

/** The scroller's reading. Flowing, the scroller is the document. */
const read = (frame) =>
  frame.evaluate(() => {
    const inner = document.querySelector('[data-scroller]')
    const box = inner ? inner.getBoundingClientRect() : { top: 0, bottom: innerHeight }
    const top = inner ? inner.scrollTop : window.scrollY
    const max = inner
      ? inner.scrollHeight - inner.clientHeight
      : document.documentElement.scrollHeight - innerHeight
    const first = document.querySelector('[data-instance]')
    const name = first?.querySelector('h2')
    const label = first?.querySelector('[data-label]')
    const edit = first?.querySelector('[data-edit]')
    const rows = [...document.querySelectorAll('[data-instance]')]
    const last = rows[rows.length - 1]
    const inside = (el) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5
    }
    const at = document.elementFromPoint(Math.min(40, innerWidth / 2), box.top + 3)
    const all = document.querySelector('[data-all]')
    return {
      scroller: inner ? inner.getAttribute('data-scroller') : 'document',
      snap: inner ? getComputedStyle(inner).scrollSnapType : 'none',
      scrollTop: Math.round(top),
      max: Math.round(max),
      lists: rows.length,
      headerTop: first ? Math.round(first.getBoundingClientRect().top - box.top) : null,
      nameSeen: inside(name),
      labelSeen: inside(label),
      editSeen: inside(edit),
      atTop: at ? `${at.tagName.toLowerCase()} “${(at.textContent ?? '').trim().slice(0, 28)}”` : null,
      lastBottom: last ? Math.round(last.getBoundingClientRect().bottom - box.bottom) : null,
      allSeen: all ? all.getBoundingClientRect().bottom <= innerHeight + 0.5 : false,
    }
  })

const to = async (frame, top) => {
  await frame.evaluate((y) => {
    const inner = document.querySelector('[data-scroller]')
    if (inner) inner.scrollTo(0, y)
    else window.scrollTo(0, y)
  }, top)
  await frame.waitForTimeout(700)
}

const report = []
let failed = false
const browser = await webkit.launch()
try {
  for (const scheme of SCHEMES) {
    for (const [w, h] of SIZES) {
      const page = await browser.newPage({ viewport: { width: w + 40, height: h + 40 }, colorScheme: scheme })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      current = harness(w, h, scheme)
      await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'load' })
      const box = await page.waitForSelector('#f')
      const frame = await box.contentFrame()
      await page.waitForTimeout(800)
      const say = (type, picked = false) =>
        page.evaluate((m) => document.getElementById('f').contentWindow.postMessage(m, '*'), {
          type,
          protocol: 2,
          ...(type === 'kehikot.hello'
            ? { session: 'probe', context: context(scheme), state: null }
            : context(scheme, picked)),
        })
      await say('kehikot.hello')
      await frame.waitForSelector('[data-instance]', { timeout: 15000 })
      await page.waitForTimeout(900)
      const shot = async (name) => {
        if (SHOTS) await box.screenshot({ path: `${SHOTS}/${TAG}-${w}x${h}-${scheme}-${name}.png` })
      }

      const rest = await read(frame)
      await shot('rest')

      await to(frame, 0)
      const top = await read(frame)
      await shot('top')

      /* From the middle, by the wheel: a person's own way up. */
      await to(frame, Math.min(rest.max, 400))
      await page.mouse.move(w / 2, Math.min(h - 50, h / 2))
      for (let i = 0; i < 6; i += 1) {
        await page.mouse.wheel(0, -200)
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(900)
      const wheel = await read(frame)

      /* A little way down and back: a small scroll must not be thrown anywhere. */
      await to(frame, 0)
      await page.mouse.wheel(0, 30)
      await page.waitForTimeout(900)
      const nudged = await read(frame)

      await to(frame, 99999)
      const bottom = await read(frame)
      await shot('bottom')

      /*
       * Every place the scroller will rest in its first and last stretch, asked
       * one offset at a time. Content is out of reach when two neighbouring
       * resting places are further apart than the scroller is tall, or when the
       * first is not 0 or the last is not the end — said as the largest gap.
       */
      const rests = await frame.evaluate(async () => {
        const inner = document.querySelector('[data-scroller]')
        if (!inner) return null
        const max = inner.scrollHeight - inner.clientHeight
        const asked = []
        for (let y = 0; y <= Math.min(max, 360); y += 9) asked.push(y)
        for (let y = Math.max(0, max - 240); y <= max; y += 9) asked.push(y)
        asked.push(max)
        const found = new Set()
        for (const y of asked) {
          inner.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 160))
          found.add(Math.round(inner.scrollTop))
        }
        const head = [...found].filter((y) => y <= 360).sort((x, y) => x - y)
        const tail = [...found].filter((y) => y >= max - 240).sort((x, y) => x - y)
        const gap = (list) => Math.max(0, ...list.slice(1).map((y, i) => y - list[i]))
        return {
          first: head[0],
          last: tail[tail.length - 1],
          max: Math.round(max),
          places: found.size,
          widest: Math.max(gap(head), gap(tail)),
          tall: inner.clientHeight,
        }
      })
      const reach = !rests || (rests.first === 0 && rests.last === rests.max && rests.widest <= rests.tall)

      /* Folding the first list away and back, from the top. */
      await to(frame, 0)
      const fold = []
      const press = frame.locator('[data-fold]').first()
      if (await press.count()) {
        /* A real press, which the browser has to be able to scroll to. Before
           the fix it could not, and that is a reading rather than a crash. */
        try {
          const before = await read(frame)
          await press.click({ timeout: 3000 })
          await page.waitForTimeout(700)
          const folded = await read(frame)
          await frame.locator('[data-fold]').first().click({ timeout: 3000 })
          await page.waitForTimeout(700)
          const unfolded = await read(frame)
          fold.push(before.scrollTop, folded.scrollTop, unfolded.scrollTop)
          if (!unfolded.editSeen || !folded.editSeen || unfolded.scrollTop !== 0) failed = true
        } catch {
          fold.push('the fold press could not be reached')
          failed = true
        }
      }

      /* A context arriving again, mid-list, must move nothing. */
      await to(frame, Math.min(rest.max, 180))
      const settled = await read(frame)
      await say('kehikot.context')
      await page.waitForTimeout(900)
      const again = await read(frame)

      /* A part picked and let go, from the top and from the middle. */
      const pick = []
      if (PART) {
        for (const from of [0, Math.min(rest.max, 180)]) {
          await to(frame, from)
          const before = await read(frame)
          await say('kehikot.context', true)
          await page.waitForTimeout(900)
          const picked = await read(frame)
          await say('kehikot.context', false)
          await page.waitForTimeout(900)
          const released = await read(frame)
          pick.push(`${before.scrollTop} → ${picked.scrollTop} (${picked.lists} lists) → ${released.scrollTop}`)
          if (picked.lists === before.lists && (picked.scrollTop !== before.scrollTop || released.scrollTop !== before.scrollTop)) {
            failed = true
          }
        }
      }

      /*
       * The edit page: words in the box and not sent, the list scrolled to its
       * end, and a context arriving. The words and the scroll are both still
       * there. Nothing is added — the box is typed in and left.
       */
      await to(frame, 0)
      let typed = 'the edit press could not be reached'
      try {
        await frame.locator('[data-edit]').first().click({ timeout: 3000 })
        await frame.waitForSelector('#add-item', { timeout: 5000 })
        await frame.fill('#add-item', 'typed and not sent')
        await to(frame, 99999)
        const edit = () =>
          frame.evaluate(() => {
            const inner = document.querySelector('[data-scroller]')
            const rows = [...document.querySelectorAll('li[data-item]')]
            const last = rows[rows.length - 1]
            const box = document.getElementById('add-item')
            return {
              words: box.value,
              scrollTop: inner ? Math.round(inner.scrollTop) : Math.round(window.scrollY),
              atEnd: inner
                ? Math.round(inner.scrollTop) === Math.round(inner.scrollHeight - inner.clientHeight)
                : true,
              lastPast: inner && last ? Math.round(last.getBoundingClientRect().bottom - inner.getBoundingClientRect().bottom) : null,
              boxSeen: inner ? box.getBoundingClientRect().top >= 0 && box.getBoundingClientRect().bottom <= innerHeight : true,
            }
          })
        const was = await edit()
        await say('kehikot.context')
        await page.waitForTimeout(900)
        const now = await edit()
        typed = `“${now.words}” at ${was.scrollTop} → ${now.scrollTop}, at the end ${now.atEnd}, last row past edge ${now.lastPast}, box seen ${now.boxSeen}`
        if (now.words !== 'typed and not sent' || now.scrollTop !== was.scrollTop) failed = true
        await shot('edit')
      } catch (e) {
        typed = `the edit page could not be read: ${String(e.message).split('\n')[0]}`
        failed = true
      }

      /* Nothing was ticked or added: every press above was a fold, a scroll or Edit. */
      const ok =
        top.scrollTop === 0
        && (top.scroller === 'document' || top.headerTop === 0)
        && top.nameSeen
        && top.editSeen
        && wheel.scrollTop === 0
        && wheel.editSeen
        && bottom.scrollTop === bottom.max
        && bottom.lastBottom <= 0
        && bottom.allSeen
        && reach
        && again.scrollTop === settled.scrollTop
        && errors.length === 0
      if (!ok) failed = true
      report.push({
        size: `${w}×${h}`,
        scheme,
        scroller: rest.scroller,
        snap: rest.snap,
        lists: rest.lists,
        rest: rest.scrollTop,
        'after scrollTo(0)': top.scrollTop,
        'after wheel-up': wheel.scrollTop,
        'at the top edge': top.atTop,
        'name/label/Edit seen': `${top.nameSeen}/${top.labelSeen}/${top.editSeen}`,
        'nudge 30': nudged.scrollTop,
        'bottom/max': `${bottom.scrollTop}/${bottom.max}`,
        'last row past edge': bottom.lastBottom,
        'All checklists seen': bottom.allSeen,
        'resting places': rests
          ? `${rests.first}…${rests.last} of ${rests.max}, ${rests.places} found, widest gap ${rests.widest} in ${rests.tall}`
          : 'the document',
        fold: fold.join(' → '),
        'context again': `${settled.scrollTop} → ${again.scrollTop}`,
        'part picked and released': pick.join('; '),
        'edit page, typed': typed,
        errors: errors.length,
        ok,
      })
      await page.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}

console.log(JSON.stringify(report, null, 2))
if (failed) process.exit(1)

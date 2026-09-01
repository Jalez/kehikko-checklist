/**
 * Does the offer actually arrive, and what does the page get back for it?
 *
 *     PLAYWRIGHT=/path/to/playwright-core CHROME=/path/to/chrome-headless-shell \
 *       node dev/filters.probe.mjs
 *
 * ## What it is for
 *
 * Two claims, and neither can be tested without a host.
 *
 * 1. **The offer arrives, and holds only the rungs that exist.** Standing in a
 *    labelled section it is `section, file, paper`; standing in a file with no
 *    heading above the reader it is `file, paper`; with no document open, and
 *    against an issue, there is no offer at all. `test/scope.test.ts` holds
 *    `offerAt` to a table, and a table cannot tell you that the message left the
 *    frame.
 *
 * 2. **The strip got shorter.** That is the owner's actual goal — "this section
 *    is also unneeded in checklist once it uses the filter button at the modules
 *    container's header as well" — so the number that says whether this was
 *    worth doing is pixels, measured in the container they use.
 *
 * ## Two traps, both of which have cost real time on this canvas
 *
 * **Listening to every `message` event.** A real host frames a dozen modules,
 * and every one of them posts. A probe that recorded them all would read
 * somebody else's offer as this module's and be perfectly convinced.
 *
 * **Comparing `event.source` to `frame.contentWindow`.** It looks like the
 * precise way to do it and it silently drops everything: the frame is
 * cross-origin, so the `Window` this page holds and the one the event carries
 * are two different proxies, and `===` is false for both. Nothing throws — the
 * probe simply records nothing and reads as "the module sent no offer".
 *
 * So this filters on `event.origin`, which is a string, is the module's own
 * origin, and is the one field a page on another origin cannot forge.
 *
 * ## What it found
 *
 * Against the owner's thesis at 220x300, with a two-item list. `before` is the
 * same probe with this change stashed and the module restarted:
 *
 *     where the reader is                  rung       offer                 before  after
 *     main.tex, nothing selected           file       file, paper             55px   37px
 *     3_methods.tex, §Research design      section    section, file, paper    70px   52px
 *     3_methods.tex, §Model selection      section    section, file, paper    70px   52px
 *     nothing open at all                  paper      nothing sent            70px   70px
 *     an issue selected on the canvas      elsewhere  (withdrawn)             37px   37px
 *
 * **Eighteen pixels on every rung below the paper**, at every size — the same 18
 * at 900x700, where the strip goes 73px to 55px. That is one whole line of this
 * page's 16-pixel type, and it is six per cent of the 300-pixel container the
 * owner actually runs this in. It is a flat gain rather than an occasional one
 * because the old strip drew the `Show <wider>` line on EVERY rung below the
 * paper, count or no count: the press had to be reachable even when nothing was
 * hidden behind it, so the line was there even when it had nothing to say.
 *
 * The two rows that do not move are the two that must not. A paper is the top of
 * the ladder and never had a way out to draw; an issue has no ladder at all, and
 * its 37px is the row this module has always drawn.
 *
 * The offer itself: 27 messages recorded over the run, every one of them from
 * `http://127.0.0.1:7860` and none from anywhere else. Choosing `paper` moves the
 * list from "Research design" to "the whole paper" and `file` to "3_methods.tex";
 * a remembered `section` replayed into `main.tex`, which has no labelled heading,
 * comes back on the file rung rather than narrowing by a section that is not
 * there. Before the change the same three choices moved nothing, which is what a
 * probe that passes both ways would have hidden.
 *
 * The `nothing open at all` row is the one to read twice. It says "nothing sent"
 * rather than "(withdrawn)", and that is the fix for the bug the real host found:
 * a paper with no passage under it is a ladder of one, and answering `[]` there
 * tells the host there is nothing to narrow — whereupon it prunes the reader's
 * stored grain. On a reload this module is framed before anything broadcasts a
 * passage, so the filter worked perfectly and was erased every refresh. Driven
 * against the real host at 4181: choose "The whole paper", reload, and the
 * container comes back on the whole paper with the header reading "filter what
 * Checklist shows — narrowed".
 *
 * ## Run it against the change and against the code without it
 *
 * A probe that passes both ways proves nothing. `git stash`, restart the module,
 * run this, and the `strip` column is the before. That is how the numbers above
 * were measured rather than imagined.
 *
 * ## The host origin, which is not obvious
 *
 * The module sends `frame-ancestors 'self' http://127.0.0.1:4181` unless
 * `ROADMAP_ORIGIN` says otherwise, so this probe's own host — on 4185, out of
 * the way of a real one and of `passage.probe.mjs` — is refused before the frame
 * loads, silently, and the only symptom is `window.greeted` never becoming true:
 *
 *     ROADMAP_ORIGIN="http://127.0.0.1:4181 http://127.0.0.1:4185" ./run.sh
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright'
const CHROME = process.env.CHROME
const PORT = Number(process.env.PORT ?? 7860)
const HOST_PORT = Number(process.env.HOST_PORT ?? 4185)
const PROJECT = process.env.PROJECT ?? '/Users/jaakkorajala/Claude/Projects/CS-DEGREE/05_drafts/thesis_latex'
const APP = `http://127.0.0.1:${PORT}/app`
const MODULE_ORIGIN = `http://127.0.0.1:${PORT}`
const EPIC = 'thesis'
const LIST = 'What the thesis owes (probe)'

/* `playwright` puts `chromium` on the namespace and `playwright-core` puts it on
   the default export. Both are ordinary things to have on a machine, and a probe
   that only knew one of them fails with `Cannot read properties of undefined`,
   which reads as a broken probe rather than as the wrong package. */
const pw = await import(PLAYWRIGHT)
const chromium = pw.chromium ?? pw.default?.chromium
if (!chromium) throw new Error(`probe: ${PLAYWRIGHT} exports no chromium`)

/** Where to point. Byte offsets, for the reason `dev/passage.probe.mjs` gives. */
function at(file, needle) {
  const source = readFileSync(`${PROJECT}/${file}`, 'utf8')
  const index = source.indexOf(needle)
  if (index === -1) throw new Error(`probe: "${needle}" is not in ${file} any more`)
  const from = Buffer.byteLength(source.slice(0, index), 'utf8')
  return { path: `${PROJECT}/${file}`, page: null, from, to: from + Buffer.byteLength(needle, 'utf8'), quoted: needle }
}

const whole = (file) => ({ path: `${PROJECT}/${file}`, page: null, from: null, to: null, quoted: '' })

const MOVES = [
  ['main.tex, nothing selected', whole('main.tex'), []],
  ['chapters/3_methods.tex, in §Research design', at('chapters/3_methods.tex', 'This study is an experience-focused'), []],
  ['chapters/3_methods.tex, in §Model selection', at('chapters/3_methods.tex', '\\section{Model selection}'), []],
  ['nothing open at all', null, []],
  ['an issue selected on the canvas', null, ['gh#105']],
]

let passage = MOVES[0][1]
let selection = []
let filters = {}
const context = () => ({
  epic: EPIC,
  project: 'CS-DEGREE',
  projectPath: PROJECT,
  theme: 'light',
  selection,
  passage,
  kehikko: { id: 7, name: 'Thesis' },
  filters,
})

/*
 * The harness. `window.offers` is the whole point of it: every `roadmap.filters`
 * this module posts, in order, with the origin it came from — recorded and then
 * FILTERED on that origin, so a probe run beside a real host cannot read
 * somebody else's offer as ours. See the essay above on why `event.source` is
 * not the test it looks like.
 */
const harness = (w, h) => `<!doctype html><body style="margin:0">
<iframe id="f" src="${APP}" style="width:${w}px;height:${h}px;border:0;display:block"
 sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>
<script>
const f = document.getElementById('f')
window.ctx = ${JSON.stringify(context())}
window.offers = []
window.addEventListener('message', (e) => {
  if (e.origin !== ${JSON.stringify(MODULE_ORIGIN)}) return
  if (!e.data || typeof e.data !== 'object') return
  if (e.data.type === 'roadmap.ready') window.greeted = true
  if (e.data.type === 'roadmap.filters') window.offers.push({ origin: e.origin, groups: e.data.groups })
})
window.send = () => f.contentWindow.postMessage({ type:'roadmap.context', context: window.ctx }, '*')
f.addEventListener('load', () => {
  setInterval(() => f.contentWindow.postMessage({ type:'roadmap.hello', protocol:2, session:'probe', context: window.ctx, state: null }, '*'), 200)
})
</script></body>`

let current = harness(220, 300)
const server = createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(current)
})
await new Promise((r) => server.listen(HOST_PORT, '127.0.0.1', r))

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {})
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })

let listId = null

async function open(w, h) {
  current = harness(w, h)
  /* Never `networkidle`: this page holds a poll open by design. */
  await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'load' })
  const frame = await (await page.waitForSelector('#f')).contentFrame()
  await page.waitForFunction(() => window.greeted === true, null, { timeout: 15000 })
  await frame.waitForSelector('[data-checklist]', { timeout: 15000 }).catch(() => {})
  const opened = await frame.$('section[data-checklist]')
  if (!opened || (listId && (await opened.getAttribute('data-checklist')) !== listId)) {
    if (opened) await frame.click('[data-another]').catch(() => {})
    const button = await frame.$(listId ? `button[data-checklist="${listId}"]` : 'button[data-checklist]')
    if (button) await button.click()
  }
  await frame.waitForSelector('section[data-checklist]', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
  return frame
}

let frame = await open(900, 700)

/* Seeded through the app's own API with the ticket the page carries, rather than
   by writing JSON into the project by hand. */
listId = await frame.evaluate(async ({ project, name }) => {
  const ticket = JSON.parse(document.getElementById('ticket').textContent)
  const post = (b) =>
    fetch('/api/checklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-checklist-ticket': ticket },
      body: JSON.stringify(b),
    }).then((r) => r.json())
  const lists = await fetch(`/api/checklists?project=${encodeURIComponent(project)}`).then((r) => r.json())
  let id = (lists.lists || []).find((l) => l.name === name)?.id
  if (!id) {
    id = (await post({ op: 'create', name, project })).id
    await post({ op: 'add', id, text: 'Every claim in this section has a citation.', project })
    await post({ op: 'add', id, text: 'The prose and the figures agree.', project })
  }
  return id
}, { project: PROJECT, name: LIST })

frame = await open(220, 300)

/**
 * The last offer this module posted, and whether it posted one at all just now.
 *
 * The three answers are the point of the column: an offer, a withdrawal (`[]`),
 * and SILENCE — nothing sent, the last true offer left standing. The third is
 * what a paper with no document open gets, because claiming there is nothing to
 * narrow makes the host erase the reader's stored grain. See `offerAt`.
 */
let counted = 0
const offer = async () => {
  const all = await page.evaluate(() => window.offers.length)
  const fresh = all > counted
  counted = all
  const last = await page.evaluate(() => {
    const one = window.offers[window.offers.length - 1]
    return one ? { origin: one.origin, groups: one.groups } : null
  })
  return { fresh, last }
}

async function say(label) {
  await page.evaluate(({ p, s, f }) => {
    window.ctx = { ...window.ctx, passage: p, selection: s, filters: f }
    window.send()
  }, { p: passage, s: selection, f: filters })
  await page.waitForTimeout(800)
  const rung = await frame.$eval('[data-target]', (n) => n.dataset.rung ?? '—').catch(() => '—')
  const held = await frame.$eval('[data-target]', (n) => n.textContent.trim()).catch(() => '—')
  const count = await frame.$eval('[data-count]', (n) => n.textContent.trim()).catch(() => '—')
  const hidden = await frame.$eval('[data-elsewhere]', (n) => n.textContent.trim()).catch(() => '')
  const strip = await frame.$eval('[data-strip]', (n) => Math.round(n.getBoundingClientRect().height)).catch(() => 0)
  const items = await frame.$$eval('li [data-item], li', (n) => n.length).catch(() => 0)
  const { fresh, last } = await offer()
  const said = !fresh
    ? '(nothing sent — last offer stands)'
    : last?.groups?.length
      ? last.groups.map((g) => `${g.id}[${g.options.map((o) => o.id).join(', ')}] →${g.fallback}`).join(' ')
      : '(withdrawn)'
  console.log(`  ${label.padEnd(44)} ${rung.padEnd(9)} ${held.padEnd(18)} ${count.padEnd(5)} ${String(strip).padStart(4)}px  ${said}`)
  return { rung, held, count, hidden, strip, offer: last, items }
}

console.log(`\n220x300, ${PROJECT}\n`)
console.log(`  ${'where the reader is'.padEnd(44)} ${'rung'.padEnd(9)} ${'held against'.padEnd(18)} count  strip  offer`)

const seen = []
for (const [label, where, picked] of MOVES) {
  passage = where
  selection = picked
  seen.push([label, await say(label)])
}

/* The origin, printed rather than assumed: this is the one field that says the
   offer came from the module and not from something else on the page. */
const origins = await page.evaluate(() => [...new Set(window.offers.map((o) => o.origin))])
console.log(`\n  ${await page.evaluate(() => window.offers.length)} offers recorded, from ${JSON.stringify(origins)}`)

/* And the choice has to actually change the list. Sent the way the host sends
   it — in `context.filters` — because that is the only way it ever arrives. */
passage = MOVES[1][1]
selection = []
console.log('')
filters = {}
const narrow = await say('§Research design, nothing chosen')
filters = { grain: 'paper' }
const wide = await say('§Research design, grain = paper')
filters = { grain: 'file' }
const mid = await say('§Research design, grain = file')

console.log(
  narrow.held !== wide.held && wide.held !== mid.held
    ? '\n  the chosen grain changes what the list is held against'
    : '\n  THE GRAIN CHANGED NOTHING  <-- the offer is drawn and does not work',
)

/* A remembered grain that this ladder cannot honour. `main.tex` has no labelled
   heading, so `section` is not on offer; the container must fall back rather
   than narrow by a rung that is not there. */
passage = whole('main.tex')
filters = { grain: 'section' }
const stale = await say('main.tex, remembering grain = section')
console.log(
  stale.rung === 'file'
    ? '  a remembered rung that is not available falls back to the narrowest that is'
    : `  STALE GRAIN HONOURED  <-- rung is ${stale.rung}`,
)

/* And the same movements with room to spare, because the strip is not something
   only a cramped layout shows. */
filters = {}
frame = await open(900, 700)
console.log('\n900x700\n')
passage = whole('main.tex')
await say('main.tex, nothing selected')
passage = MOVES[1][1]
await say('chapters/3_methods.tex, in §Research design')

await browser.close()
await new Promise((r) => server.close(r))

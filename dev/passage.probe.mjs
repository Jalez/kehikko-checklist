/**
 * Does the container actually follow a reader through a real paper?
 *
 *     PLAYWRIGHT=/path/to/playwright CHROME=/path/to/chrome-headless-shell \
 *       node dev/passage.probe.mjs
 *
 * ## Why a probe and not a test
 *
 * Because every claim this change makes is a claim about a MOVEMENT, and a
 * movement needs a host: `roadmap.context` arriving twice with two different
 * passages, and the page being different afterwards. `test/scope.test.ts` holds
 * the ladder to a table and `test/render.test.tsx` holds the row to its words,
 * and neither can tell you that a real host sending a real byte range into a
 * real `.tex` file puts the right heading on screen. This can, so this is the
 * thing that was actually run.
 *
 * It also runs against the OWNER'S THESIS rather than a fixture, deliberately —
 * `/Users/jaakkorajala/Claude/Projects/CS-DEGREE/05_drafts/thesis_latex`, seven
 * files, `main.tex` plus six chapters. A fixture proves the scanner reads what
 * the fixture author expected. This proves it reads what the person who filed
 * the report is actually looking at.
 *
 * ## What it found
 *
 * Six movements through the owner's own thesis, at 220x300, against a list of
 * two items. Before — the module reacting to `selection` only, `reacts:
 * ['selection']`:
 *
 *     where the reader is                          rung   held against         count
 *     main.tex, nothing selected                   —      thesis (the paper)   0/2
 *     chapters/1_introduction.tex                  —      thesis (the paper)   0/2
 *     chapters/3_methods.tex, in §Research design  —      thesis (the paper)   0/2
 *     chapters/3_methods.tex, in §Model selection  —      thesis (the paper)   0/2
 *     chapters/5_discussion.tex                    —      thesis (the paper)   0/2
 *     nothing open at all                          —      thesis (the paper)   0/2
 *
 *     1 distinct row out of 6 movements
 *
 * Which is the report, reproduced: *"it seems to not care nor does it change the
 * checklist when you go between files in the paper module or jump between
 * sections"*. Ticking an item while standing in §Research design then showed it
 * ticked in §Model selection too, because there was only ever one target.
 *
 * After:
 *
 *     main.tex, nothing selected                   file     main.tex           0/2
 *     chapters/1_introduction.tex                  file     1_introduction.tex 0/2
 *     chapters/3_methods.tex, in §Research design  section  Research design    0/2
 *     chapters/3_methods.tex, in §Model selection  section  Model selection    0/2
 *     chapters/5_discussion.tex                    file     5_discussion.tex   0/2
 *     nothing open at all                          paper    the whole paper    1/2
 *
 *     6 distinct rows out of 6 movements
 *
 * And the half that matters more than the following. Tick one item in
 * §Research design (1/2), walk to §Model selection, and the container reads 0/2
 * with `1 ticked elsewhere in this paper.` A reader who cannot see what was
 * narrowed cannot tell narrowing from a bug, and that line is the whole
 * difference.
 *
 * ## The way out is no longer on this page, so this probe no longer presses it
 *
 * When this was written, the count sat beside a `Show 3_methods.tex` press and
 * the block below drove it: press, land on the file, press again, land on the
 * paper. The ladder is a filter in the container header now — offered as a
 * GRAIN, remembered by the host, and driven through `context.filters` — so
 * `[data-widen]` is not in this page any more, and that block finds nothing and
 * skips. It is left standing rather than deleted because it is the shape of the
 * check, and it now reads as what it is: a control that moved.
 * `dev/filters.probe.mjs` is where the way out is driven, and it measures what
 * this page gained by losing the press — 18 pixels on every rung below the paper.
 *
 * That press is also how a real bug was found rather than reasoned about: it
 * used to land back in the section it had just left, because `{epic,
 * section: null}` on the wire is indistinguishable from a target nobody has
 * narrowed. See `pick` in `src/store/ask.ts` — the rule survived the move, and
 * `holdingAt` in `list/holding.ts` is what obeys it now.
 *
 * The same movements at 900x700 say the same things, which was the other thing
 * worth checking: the ladder is not something only a cramped layout shows.
 *
 * ## Run it against the fix and against the code without it
 *
 * A probe that passes both ways proves nothing. `git stash` the change, restart
 * the module, run this, and watch the six rows above collapse into one. That is
 * how the "before" block was measured rather than imagined.
 *
 * ## Two things it needs that are not obvious
 *
 * **The host origin.** The module sends `frame-ancestors 'self'
 * http://127.0.0.1:4181` unless `ROADMAP_ORIGIN` says otherwise, so this probe's
 * own host — on 4184, out of the way of a real one — is refused before the frame
 * loads, silently, and the only symptom is `window.greeted` never becoming true.
 * Start the module with the port added:
 *
 *     ROADMAP_ORIGIN="http://127.0.0.1:4181 http://127.0.0.1:4184" ./run.sh
 *
 * **Its own list.** This picks a checklist BY ID rather than pressing whichever
 * button is first, because the thesis has the owner's real lists in it and the
 * first version of this probe measured six movements against one of theirs. It
 * creates `What the thesis owes (probe)` if it is not there, and leaves it —
 * remove it with the page's own "Forget" when you are done, rather than editing
 * their `checklists.json`.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright'
const CHROME = process.env.CHROME
const PORT = Number(process.env.PORT ?? 7860)
const HOST_PORT = Number(process.env.HOST_PORT ?? 4184)
const PROJECT = process.env.PROJECT ?? '/Users/jaakkorajala/Claude/Projects/CS-DEGREE/05_drafts/thesis_latex'
const APP = `http://127.0.0.1:${PORT}/app`
const EPIC = 'thesis'
const LIST = 'What the thesis owes (probe)'

const { chromium } = await import(PLAYWRIGHT)

/**
 * Where to point, and how the offsets are found.
 *
 * A passage carries BYTES, so the offsets are computed with `Buffer.byteLength`
 * over the file's own text rather than with string indices. On this document the
 * two agree almost everywhere and disagree wherever somebody wrote `ä` — which
 * is the whole reason `file/open.ts` walks a byte offset back to a code point
 * boundary before decoding, and the whole reason this probe does not take the
 * shortcut.
 */
function at(file, needle) {
  const source = readFileSync(`${PROJECT}/${file}`, 'utf8')
  const index = source.indexOf(needle)
  if (index === -1) throw new Error(`probe: "${needle}" is not in ${file} any more`)
  const from = Buffer.byteLength(source.slice(0, index), 'utf8')
  return { path: `${PROJECT}/${file}`, page: null, from, to: from + Buffer.byteLength(needle, 'utf8'), quoted: needle }
}

const MOVES = [
  ['main.tex, nothing selected', { path: `${PROJECT}/main.tex`, page: null, from: null, to: null, quoted: '' }],
  [
    'chapters/1_introduction.tex, nothing selected',
    { path: `${PROJECT}/chapters/1_introduction.tex`, page: null, from: null, to: null, quoted: '' },
  ],
  ['chapters/3_methods.tex, in §Research design', at('chapters/3_methods.tex', 'This study is an experience-focused')],
  ['chapters/3_methods.tex, in §Model selection', at('chapters/3_methods.tex', '\\section{Model selection}')],
  ['chapters/5_discussion.tex, nothing selected', { path: `${PROJECT}/chapters/5_discussion.tex`, page: null, from: null, to: null, quoted: '' }],
  ['nothing open at all', null],
]

let passage = MOVES[0][1]
const context = () => ({
  epic: EPIC,
  project: 'CS-DEGREE',
  projectPath: PROJECT,
  theme: 'light',
  selection: [],
  passage,
  kehikko: { id: 7, name: 'Thesis' },
})

const harness = (w, h) => `<!doctype html><body style="margin:0">
<iframe id="f" src="${APP}" style="width:${w}px;height:${h}px;border:0;display:block"
 sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>
<script>
const f = document.getElementById('f')
window.ctx = ${JSON.stringify(context())}
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'roadmap.ready') window.greeted = true })
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

/** The id of the probe's own list, filled in by the seeding below. */
let listId = null

async function open(w, h) {
  current = harness(w, h)
  /* Never `networkidle`. This page holds a poll open by design and would never
     go idle, so waiting for it is waiting for the timeout. */
  await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'load' })
  const frame = await (await page.waitForSelector('#f')).contentFrame()
  await page.waitForFunction(() => window.greeted === true, null, { timeout: 15000 })
  await frame.waitForSelector('[data-checklist]', { timeout: 15000 }).catch(() => {})
  /* The pick screen is a real screen and has to be got past: this app opens on
     it until somebody chooses, which is the point of it. */
  /* Picked BY ID and not "whichever button is first". This project has a real
     `checklists.json` in it with the owner's own lists, and the first run of this
     probe picked one of those — six movements against an empty list, which reads
     as the container not following the reader for a reason that is not the one
     being measured. */
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
   by writing JSON into the project by hand — the store's file format is the
   store's business, and a probe that wrote it directly would be a second writer
   to keep in step. */
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

async function say(label) {
  await page.evaluate((p) => {
    window.ctx = { ...window.ctx, passage: p }
    window.send()
  }, passage)
  await page.waitForTimeout(700)
  const target = await frame.$eval('[data-target]', (n) => n.textContent.trim()).catch(() => '—')
  const rung = await frame.$eval('[data-target]', (n) => n.dataset.rung ?? '—').catch(() => '—')
  const count = await frame.$eval('[data-count]', (n) => n.textContent.trim()).catch(() => '—')
  const hidden = await frame.$eval('[data-elsewhere]', (n) => n.textContent.trim()).catch(() => '')
  const out = await frame.$eval('[data-widen]', (n) => n.textContent.trim()).catch(() => '')
  console.log(`  ${label.padEnd(46)} ${rung.padEnd(9)} ${target.padEnd(22)} ${count.padEnd(5)} ${hidden} ${out}`)
  return { rung, target, count, hidden, out }
}

console.log(`\n220x300, ${PROJECT}\n`)
console.log(`  ${'where the reader is'.padEnd(46)} ${'rung'.padEnd(9)} ${'held against'.padEnd(22)} count  hidden / way out`)
const seen = []
for (const [label, where] of MOVES) {
  passage = where
  seen.push([label, await say(label)])
}

/* The half the report is really about: the row has to be DIFFERENT after the
   reader moves. Four movements that all say the same thing is the bug. */
const rows = seen.map(([, r]) => r.target)
const distinct = new Set(rows).size
console.log(`\n  ${distinct} distinct rows out of ${rows.length} movements${distinct > 1 ? '' : '  <-- the container is not following the reader'}`)

/* And the disclosure: tick something in one section, walk to another, and the
   count of what is now hidden has to be on screen. */
passage = MOVES[2][1]
await say('back to §Research design')
const row = await frame.$('li [data-item], li button')
if (row) {
  await row.click().catch(() => {})
  await page.waitForTimeout(600)
}
await say('after ticking one item there')
passage = MOVES[3][1]
const after = await say('then walking to §Model selection')
console.log(
  after.hidden
    ? `\n  narrowing says what it hides: "${after.hidden}" with "${after.out}"`
    : '\n  NOTHING says what the narrowing is hiding  <-- a reader cannot tell this from a bug',
)

/* And the way out has to actually go somewhere. A count of what is hidden beside
   a control that does nothing would be worse than no count at all. */
const climb = await frame.$('[data-widen]')
if (climb) {
  await climb.click()
  await page.waitForTimeout(700)
  await say('after pressing the way out')
  const again = await frame.$('[data-widen]')
  if (again) {
    await again.click()
    await page.waitForTimeout(700)
    await say('and again, to the top of the ladder')
  }
}

/* The same movements in a container with room to spare. Everything above is
   measured at 220x300 because that is the container the owner actually uses and
   the one this module has already been narrowed for; this is the check that the
   ladder is not something only a cramped layout shows. */
frame = await open(900, 700)
console.log('\n900x700\n')
passage = MOVES[1][1]
await say('chapters/1_introduction.tex')
passage = MOVES[2][1]
await say('chapters/3_methods.tex, in §Research design')

await browser.close()
server.close()

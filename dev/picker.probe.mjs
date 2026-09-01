/**
 * What the target picker actually offers, against a real paper on a real disk.
 *
 *     PLAYWRIGHT=/path/to/playwright-core CHROME=/path/to/chrome-headless-shell \
 *       node dev/picker.probe.mjs
 *
 * ## Why this is a third probe rather than a case in `test/outline.test.ts`
 *
 * That file builds a thesis in `mkdtemp` and holds `outlineOf` to it, which is
 * the right shape for the SCAN: where a paper begins, what the fence refuses,
 * what a bound does. None of it can answer the question this change was actually
 * made for, which is:
 *
 * > "In checklist you still can only type something there, you don't get a list
 * > of options to choose from (in the case where the checklist is targeting a
 * > paper it should offer a checklist for different chapters)."
 *
 * That is a question about a SCREEN, in a container, framed by a host, pointed
 * at the owner’s own thesis — nine readable files, fifty-odd headings, written by a
 * person rather than by a fixture. A synthetic directory would pass whatever
 * this module happened to implement. So this frames the app the way
 * `dev/filters.probe.mjs` does, walks it into a chapter, opens the picker and
 * prints what is in it.
 *
 * ## The traps, all of which are already recorded next door
 *
 * **The host origin.** The module sends `frame-ancestors 'self'
 * http://127.0.0.1:4181` unless `ROADMAP_ORIGIN` says otherwise, so this probe's
 * own host — on 4187, out of the way of a real one and of the other two probes —
 * is refused before the frame loads, silently, and the only symptom is
 * `window.greeted` never becoming true:
 *
 *     ROADMAP_ORIGIN="http://127.0.0.1:4181 http://127.0.0.1:4187" ./run.sh
 *
 * **`playwright` versus `playwright-core`.** One puts `chromium` on the
 * namespace and the other on the default export. Handled below, because the
 * failure reads as a broken probe rather than as the wrong package.
 *
 * **Byte offsets, not character offsets.** A passage's `from` and `to` are
 * bytes, which is what `dev/passage.probe.mjs` says and what `utf16At` in
 * `file/open.ts` reconciles. `Buffer.byteLength` of the slice before the needle,
 * every time.
 *
 * **Do not click the switch by its words.** `Edit` and `change` are size
 * decisions (`room.pageSwitch`), and at 220 pixels the page switch is a glyph.
 * Everything below is found by `data-` attribute for that reason.
 *
 * ## What it found
 *
 * Against the owner's thesis at 220×300 and 900×700, standing in
 * `chapters/3_methods.tex`:
 *
 *     files offered   9   main.tex, README_overleaf.md, main_snippet.tex,
 *                         1_introduction.tex … 6_conclusion.tex
 *     unfolded        1   3_methods.tex, which is the file the reader is in
 *     headings in it  19  1 chapter, 9 sections, 9 subsections
 *     typing          still there, at both sizes, with the files above it
 *
 * **Nine and not seven**, and the two extra are the honest cost of listing a
 * directory rather than following `\input`: that folder holds a README and a
 * snippet as well as the document. `file/outline.ts` names this trade — wrong
 * only in the direction of offering a file that is not in the built document,
 * which a reader can see and not press — and this is what it looks like.
 *
 * **The ordering was changed by this probe.** `main.tex` came THIRD on the first
 * run, because `README_overleaf.md` and `main_snippet.tex` sort before it, and
 * the file holding the abstract was buried in a scrolling list in a 220-pixel
 * column. So the file declaring the `\documentclass` leads, and `paperRoot`
 * returns its name for that and no other reason.
 *
 * Pressing a heading holds the list against `chapters:3_methods#sec:meth-design`
 * and the row comes back on the `section` rung. That is the same key a reader
 * standing in that section is given by the ladder — which `sectionId` being
 * shared rather than reimplemented is there to make true, and which this probe
 * exists to check outside a unit test.
 *
 * **It also found a wart, and the row now reads "Research design".** It read
 * `sec:meth-design` first: `scopeOfTarget` prints the id for a section the
 * reader is not STANDING in, which was almost always a widened target before the
 * picker existed and is the ordinary case now — press a heading from a list and
 * the reader's own `\label` was read back at them instead of the words they had
 * just pressed. `TargetRow` names it from the outline the button was drawn from,
 * so the row and the press cannot disagree, and an id the outline does not know
 * falls straight back to the honest id.
 *
 * With no project open, or against an issue, the picker draws no files at all
 * and is exactly the screen it was before this change.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright'
const CHROME = process.env.CHROME
const PORT = Number(process.env.PORT ?? 7860)
const HOST_PORT = Number(process.env.HOST_PORT ?? 4187)
const PROJECT = process.env.PROJECT ?? '/Users/jaakkorajala/Claude/Projects/CS-DEGREE/05_drafts/thesis_latex'
const APP = `http://127.0.0.1:${PORT}/app`
const EPIC = 'thesis'
const LIST = 'What the thesis owes (probe)'
const SIZES = [[220, 300], [900, 700]]

const pw = await import(PLAYWRIGHT)
const chromium = pw.chromium ?? pw.default?.chromium
if (!chromium) throw new Error(`probe: ${PLAYWRIGHT} exports no chromium`)

/** Where to point. Byte offsets, for the reason the essay above gives. */
function at(file, needle) {
  const source = readFileSync(`${PROJECT}/${file}`, 'utf8')
  const index = source.indexOf(needle)
  if (index === -1) throw new Error(`probe: "${needle}" is not in ${file} any more`)
  const from = Buffer.byteLength(source.slice(0, index), 'utf8')
  return { path: `${PROJECT}/${file}`, page: null, from, to: from + Buffer.byteLength(needle, 'utf8'), quoted: needle }
}

let passage = at('chapters/3_methods.tex', '\\section{Model selection}')
let selection = []
let epic = EPIC
let projectPath = PROJECT

const harness = (w, h) => `<!doctype html><body style="margin:0">
<iframe id="f" src="${APP}" style="width:${w}px;height:${h}px;border:0;display:block"
 sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>
<script>
const f = document.getElementById('f')
window.__ctx = () => window.ctx
window.addEventListener('message', (e) => {
  /* On \`origin\` and never on \`event.source\`: a real host frames a dozen modules
     and every one of them posts, and comparing the Window objects is false for
     both because the frame is cross-origin. The trap is written up in
     dev/filters.probe.mjs and it silently records nothing. */
  if (e.origin !== ${JSON.stringify(`http://127.0.0.1:${PORT}`)}) return
  if (e.data && e.data.type === 'roadmap.ready') window.greeted = true
})
f.addEventListener('load', () => {
  setInterval(() => f.contentWindow.postMessage({ type:'roadmap.hello', protocol:2, session:'probe', context: window.ctx, state: null }, '*'), 200)
})
</script></body>`

let size = SIZES[0]
const server = createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(harness(size[0], size[1]))
})
await new Promise((r) => server.listen(HOST_PORT, '127.0.0.1', r))

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {})
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })

const context = () => ({
  epic,
  project: 'CS-DEGREE',
  projectPath,
  theme: 'light',
  selection,
  passage,
  kehikko: { id: 7, name: 'Thesis' },
  filters: {},
})

async function open() {
  await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'load' })
  await page.evaluate((ctx) => {
    window.ctx = ctx
  }, context())
  const frame = await (await page.waitForSelector('#f')).contentFrame()
  await page.waitForFunction(() => window.greeted === true, null, { timeout: 15000 })
  /* The pick screen is a real screen and has to be got past deliberately: this
     app opens on it until somebody chooses, which is the point of it. */
  await frame.waitForSelector('[data-checklist]', { timeout: 15000 }).catch(() => {})
  if (!(await frame.$('section[data-checklist]'))) {
    const named = await frame.$(`button[data-checklist]:has-text(${JSON.stringify(LIST)})`)
    if (named) await named.click()
    else await frame.click('button[data-checklist]')
  }
  await frame.waitForSelector('section[data-checklist]', { timeout: 15000 })
  await page.waitForTimeout(700)
  return frame
}

/* Seeded through the app's own API with the ticket the served page carries,
   rather than by writing JSON into the thesis by hand: the store's file format
   is the store's business and a probe that wrote it directly would be a second
   writer to keep in step. */
let frame = await open()
await frame.evaluate(async ({ project, name }) => {
  const ticket = JSON.parse(document.getElementById('ticket').textContent)
  const lists = await fetch(`/api/checklists?project=${encodeURIComponent(project)}`).then((r) => r.json())
  let id = (lists.lists || []).find((l) => l.name === name)?.id
  if (!id) {
    const made = await fetch('/api/checklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-checklist-ticket': ticket },
      body: JSON.stringify({ op: 'create', name, project }),
    }).then((r) => r.json())
    id = made.id
    await fetch('/api/checklist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-checklist-ticket': ticket },
      body: JSON.stringify({ op: 'add', id, text: 'Say what this chapter owes.', project }),
    })
  }
}, { project: PROJECT, name: LIST })

async function look(frame) {
  /* By attribute, never by words: `change` is a word and the page switch beside
     it is a glyph below 360 pixels. */
  await frame.click('[data-switch]')
  await page.waitForTimeout(900)
  return frame.evaluate(() => {
    const files = [...document.querySelectorAll('[data-pick-file]')].map((el) => el.textContent.trim())
    const open = [...document.querySelectorAll('[data-open-file="open"]')].length
    const sections = [...document.querySelectorAll('[data-pick-section]')].map((el) => el.getAttribute('data-pick-section'))
    const note = document.querySelector('[data-paper]')
    return {
      files,
      unfolded: open,
      headings: sections.length,
      firstHeadings: sections.slice(0, 3),
      typing: Boolean(document.querySelector('[data-type-target]')),
      said: note && !note.getAttribute('data-paper').match(/^\d+$/) ? note.textContent.trim().slice(0, 60) : null,
    }
  })
}

/**
 * Press a heading, and read back what the row then says it is held against.
 *
 * This is the claim the whole change rests on and the one a unit test cannot
 * make: that the id the picker offers is the SAME id a reader standing in that
 * section is given by the ladder. `sectionId` is imported by both rather than
 * reimplemented so that it is true; this is what checks that it is.
 */
async function press(frame, section) {
  await frame.click(`[data-pick-section="${section}"]`)
  await page.waitForTimeout(900)
  return frame.evaluate(() => {
    const row = document.querySelector('[data-target]')
    return { rung: row?.getAttribute('data-rung') ?? null, says: row?.textContent.trim() ?? null }
  })
}

const out = []
for (const s of SIZES) {
  size = s
  frame = await open()
  const seen = await look(frame)
  out.push({
    where: `${s[0]}x${s[1]}, in §Model selection`,
    ...seen,
    pressed: seen.firstHeadings[1] ? await press(frame, seen.firstHeadings[1]) : null,
  })
}

/* And the two cases that must look exactly as they did before this change. */
size = SIZES[0]
selection = ['gh#105']
frame = await open()
out.push({ where: '220x300, an issue selected', ...(await look(frame)) })

selection = []
epic = null
frame = await open()
out.push({ where: '220x300, no epic on the canvas', ...(await look(frame)) })

console.log(JSON.stringify(out, null, 2))
await browser.close()
server.close()

/**
 * Does this module wear the theme the host asked for — including when the person
 * changes it in a session that is already running?
 *
 *     PLAYWRIGHT=/path/to/playwright CHROME=/path/to/chrome-headless-shell \
 *       node dev/theme.probe.mjs
 *
 * ## Why it exists, and what it settled
 *
 * The report was "Checklist doesn't seem to realize I changed the mode from dark
 * to light", and the obvious reading — that this module never applies the
 * theme — is wrong. This probe is what established that, before anything was
 * changed. The fault was upstream: the host sent no context at all to a PINNED
 * container, and the theme travels in the context. It is fixed there.
 *
 * What this does is frame the app with a host that says `dark`, then send a
 * fresh `roadmap.context` saying `light` with no reload, and read the computed
 * colours back out of the frame. It runs
 * the whole thing twice, with the MACHINE set light and then dark, because the
 * only interesting case is the one where the two disagree: a machine set to dark
 * and a host that says light. All four combinations come back as the host asked.
 *
 * What it DID find is the half a stylesheet does not paint. `color-scheme` was
 * never declared, so the scrollbar, the caret and the highlight on selected text
 * followed the machine — a light card with a dark scrollbar down the side of it,
 * which is exactly what "it hasn't noticed" looks like, and which only started
 * to matter when this module grew a scroll area of its own. See
 * `src/wire/theme.ts`.
 *
 * A probe and not a test because the claim is about COMPUTED STYLE under a real
 * cascade with a real media query. happy-dom has neither. `test/theme.test.ts`
 * asserts the classes and the scheme are written down; only a browser can say
 * what they then resolve to.
 */
import { createServer } from 'node:http'

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright'
const CHROME = process.env.CHROME
const PORT = Number(process.env.PORT ?? 7861)
const HOST_PORT = Number(process.env.HOST_PORT ?? 4183)
const PROJECT = process.env.PROJECT ?? '/tmp/checklist-probe/proj'
const APP = `http://127.0.0.1:${PORT}/app`

const { chromium } = await import(PLAYWRIGHT)

const harness = (w, h, theme) => `<!doctype html><body style="margin:0">
<iframe id="f" src="${APP}" style="width:${w}px;height:${h}px;border:0;display:block"
 sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>
<script>
window.theme = ${JSON.stringify(theme)}
const ctx = () => ({ epic: null, project: 'Probe', projectPath: ${JSON.stringify(PROJECT)}, theme: window.theme, selection: ['gh#105'], kehikko: { id: 1, name: 'Probe' } })
const f = document.getElementById('f')
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'roadmap.ready') window.greeted = true })
f.addEventListener('load', () => {
  const hello = () => f.contentWindow.postMessage({ type:'roadmap.hello', protocol:2, session:'probe', context: ctx(), state: null }, '*')
  /* Repeated, because the greeting has to win a race with React mounting and a
     probe that greeted once would be measuring its own flakiness. */
  window.keepGreeting = setInterval(hello, 300)
  hello()
  /* The change, as the host makes it: one context, no reload, no second hello. */
  window.change = (t) => {
    window.theme = t
    clearInterval(window.keepGreeting)
    f.contentWindow.postMessage({ type:'roadmap.context', protocol:2, ...ctx() }, '*')
  }
})
</script></body>`

let current = harness(320, 420, 'dark')
const server = createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(current)
})
await new Promise((r) => server.listen(HOST_PORT, '127.0.0.1', r))

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {})

for (const machine of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: machine })
  current = harness(320, 420, 'dark')
  await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.greeted === true, null, { timeout: 15000 })
  const frame = await (await page.waitForSelector('#f')).contentFrame()
  await page.waitForTimeout(700)

  const read = () =>
    frame.evaluate(() => ({
      classes: document.documentElement.className,
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
      /* The half a stylesheet does not paint: scrollbar, caret, selection. */
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }))

  const asDark = await read()
  await page.evaluate(() => window.change('light'))
  await page.waitForTimeout(500)
  const asLight = await read()
  await page.evaluate(() => window.change('dark'))
  await page.waitForTimeout(500)
  const backToDark = await read()

  console.log(`machine=${machine}`)
  console.log('  host says dark      ', asDark)
  console.log('  host changes to light', asLight)
  console.log('  and back to dark    ', backToDark)
  await page.close()
}

await browser.close()
server.close()

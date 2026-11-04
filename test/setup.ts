import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A document, for the tests that render one.
 *
 * Registered globally rather than per-file because half the value of these tests
 * is that they run the real components — the words on screen are the thing being
 * asserted, and a fake renderer would let a component say something different
 * from what it says in a browser.
 */
GlobalRegistrator.register()

/*
 * The glance's charts measure their box, and happy-dom lays nothing out, so every chart is 0 × 0
 * and Recharts says so on every render. That one sentence is dropped; anything else is said.
 */
const warn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('The width(0) and height(0) of chart')) return
  warn(...args)
}

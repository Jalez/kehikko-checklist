import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { partsOf } from '../list/focus.ts'

/**
 * `context.parts`, from a host's message to the value the page reads.
 *
 * The hook in `src/wire/use-kehikot.ts` parses the context by hand, field by
 * field, so a field the protocol grows does not arrive anywhere until a line
 * there carries it — and every pure function about the focus would go on
 * passing while the page never narrowed. This plays the host on the real
 * bridge, for the greeting and for a later context, and reads the hook's own
 * value.
 *
 * The hook is imported with a query on its path because `test/app.test.tsx`
 * replaces the module by name for its own cases, and that replacement is
 * process-wide; a different specifier is the real file whichever ran first.
 */
// @ts-expect-error a query string, so this is the real module and never app.test.tsx's stand-in
const { useKehikot } = (await import('../src/wire/use-kehikot.ts?real')) as typeof import('../src/wire/use-kehikot.ts')

const realFetch = globalThis.fetch
beforeEach(() => {
  /* The pump polls this app's own server for announcements; there is none. */
  globalThis.fetch = (async () => Response.json({ announcements: [], cursor: 0 })) as unknown as typeof fetch
})
afterEach(() => {
  cleanup()
  mailbox.forget?.()
  globalThis.fetch = realFetch
})

let seen: { parts: string; where: string } = { parts: '', where: '' }
function Probe() {
  const { parts, where } = useKehikot('kehikot.checklist', () => {})
  seen = { parts, where }
  return null
}

const CONTEXT = {
  epic: 'thesis',
  project: 'harbour',
  projectPath: '/Users/somebody/Projects/harbour',
  theme: 'light',
  selection: [],
  passage: null,
  kehikko: null,
}

/* One window for the whole conversation: the bridge binds to whoever greeted
   it, and a context from anybody else is not the host's. */
const HOST = { postMessage: () => {} }

function post(data: unknown) {
  const event = new MessageEvent('message', { data, origin: 'http://localhost:7777' })
  Object.defineProperty(event, 'source', { value: HOST })
  window.dispatchEvent(event)
}
const greet = (more: Record<string, unknown> = {}) =>
  post({ type: MESSAGE.HELLO, protocol: PROTOCOL, session: 'test-1', context: { ...CONTEXT, ...more }, state: null })
const context = (more: Record<string, unknown> = {}) =>
  post({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...CONTEXT, ...more })

const seam = (picked: boolean) => ({ id: 'seam', heading: 'The posting seam', refs: ['gh#10'], picked })

test('the parts in a greeting reach the page, and so does a later change of focus', () => {
  render(<Probe />)
  act(() => greet({ parts: [seam(false)] }))
  expect(seen.where).toBe('hosted')
  expect(partsOf(seen.parts)).toEqual([seam(false)])

  act(() => context({ parts: [seam(true)] }))
  expect(partsOf(seen.parts)).toEqual([seam(true)])

  /* Unpicked again, and then a host that stops sending the field: no focus. */
  act(() => context({ parts: [seam(false)] }))
  expect(partsOf(seen.parts)).toEqual([seam(false)])
  act(() => context())
  expect(seen.parts).toBe('')
})

test('a host that has never heard of parts leaves the page with none', () => {
  render(<Probe />)
  act(() => greet())
  expect(seen.where).toBe('hosted')
  expect(seen.parts).toBe('')
})

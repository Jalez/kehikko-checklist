import { describe, expect, test } from 'bun:test'
import { CHECKLIST_HOLDER, manifestSchema, serviceDescriptor } from 'kehikot-module-protocol'

import { answerAt } from '../doors.ts'
import { MANIFEST } from '../manifest.ts'

/**
 * The service other modules use this one through (protocol 2.83.0): the person's checklists, held
 * against work. Whoever uses it calls the tools named here, so they are held to what the door has.
 */
describe('checklist.holder', () => {
  const descriptor = serviceDescriptor(CHECKLIST_HOLDER, MANIFEST.services?.[CHECKLIST_HOLDER])

  test('is provided, and its descriptor parses with the protocol schema', () => {
    expect(descriptor).not.toBeNull()
    expect(manifestSchema.parse(MANIFEST).services?.[CHECKLIST_HOLDER]).toBeTruthy()
  })

  test('every tool it names is on the door', () => {
    const reply = answerAt('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const names = ((reply?.body as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name)
    for (const tool of Object.values(descriptor!.tools)) expect(names).toContain(tool)
  })
})

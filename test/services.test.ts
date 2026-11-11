import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHECKLIST_HOLDER,
  MODULE_FOLDERS,
  checklistJson,
  checklistJsonIn,
  checklistListsJson,
  foldersOwned,
  holderTakesJson,
  manifestSchema,
  serviceDescriptor,
} from 'kehikot-module-protocol'

import { answerAt } from '../doors.ts'
import { change } from '../list/checklists.ts'
import { ID, MANIFEST } from '../manifest.ts'

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

  test('says its list tool answers JSON (2.85.0)', () => {
    expect(holderTakesJson(descriptor!)).toBe(true)
  })
})

describe('module.folders', () => {
  test('claims .kehikot/checklist, and only that', () => {
    expect(serviceDescriptor(MODULE_FOLDERS, MANIFEST.services?.[MODULE_FOLDERS])).not.toBeNull()
    const owned = foldersOwned([{ module: ID, name: 'Checklist', placed: false, descriptor: MANIFEST.services?.[MODULE_FOLDERS] } as never])
    expect([...owned.keys()]).toEqual(['checklist'])
    expect(owned.get('checklist')?.derived).toBe(false)
  })
})

describe("the list tool's format: 'json'", () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'checklist-json-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function list(args: Record<string, unknown>): { text: string; isError: boolean } {
    const reply = answerAt('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'checklists', arguments: { project: dir, ...args } } }, null)
    const result = (reply?.body as { result: { content: { text: string }[]; isError?: boolean } }).result
    return { text: result.content[0]?.text ?? '', isError: result.isError === true }
  }

  function aHeldList(): { id: string; items: string[] } {
    const made = change({ op: 'create', name: 'What a change owes', by: 'a test' }, dir)
    if (!made.ok) throw new Error(made.error)
    const items: string[] = []
    for (const text of ['A test that fails without it', 'The notes say what changed', 'Docs updated']) {
      const added = change({ op: 'add', id: made.id, text, by: 'a test' }, dir)
      if (!added.ok) throw new Error(added.error)
      items.push(added.held!.rows.at(-1)!.item.id)
    }
    const target = { kind: 'ref', ref: 'gh#105' } as const
    if (!change({ op: 'hold', id: made.id, target, by: 'a test' }, dir).ok) throw new Error('not held')
    /* The person's own tick, from the page; an agent's, through the door, with a note. */
    if (!change({ op: 'tick', id: made.id, item: items[0]!, target, done: true, by: 'owner' }, dir).ok) throw new Error('not ticked')
    if (!change({ op: 'tick', id: made.id, item: items[1]!, target, done: true, state: 'failed', by: 'an agent', viaMcp: true, note: 'no notes file' }, dir).ok) throw new Error('not ticked')
    return { id: made.id, items }
  }

  test('with no checklist: every list, with the refs it is held against', () => {
    const { id } = aHeldList()
    const out = list({ format: 'json' })
    expect(out.isError).toBe(false)
    expect(checklistJsonIn(checklistListsJson, out.text)).toEqual({ lists: [{ id, name: 'What a change owes', held: ['gh#105'] }] })
  })

  test('with a checklist and a ref: its items as answered for that ref', () => {
    const { id, items } = aHeldList()
    const read = checklistJsonIn(checklistJson, list({ format: 'json', checklist: id, ref: 'gh#105' }).text)
    expect(read).toEqual({
      id,
      name: 'What a change owes',
      held: ['gh#105'],
      items: [
        { id: items[0]!, text: 'A test that fails without it', state: 'passed', byPerson: true, by: 'owner' },
        { id: items[1]!, text: 'The notes say what changed', state: 'failed', byPerson: false, by: 'an agent', note: 'no notes file' },
        { id: items[2]!, text: 'Docs updated', state: null, byPerson: false },
      ],
    })
  })

  test('with a checklist and no ref: nothing answered', () => {
    const { id } = aHeldList()
    const read = checklistJsonIn(checklistJson, list({ format: 'json', checklist: id }).text)
    expect(read?.items.map((one) => one.state)).toEqual([null, null, null])
  })

  test('the print stays the default', () => {
    const { id } = aHeldList()
    expect(list({}).text).toStartWith(`Checklists in ${dir}:`)
    expect(list({ checklist: id, ref: 'gh#105' }).text).toStartWith(`"What a change owes" (${id}) held against gh#105`)
  })

  test('an unknown list, or another format, is refused', () => {
    expect(list({ format: 'json', checklist: 'nope' }).isError).toBe(true)
    expect(list({ format: 'yaml' }).isError).toBe(true)
  })
})

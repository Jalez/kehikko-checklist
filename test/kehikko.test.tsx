import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'
import type { Held } from '../list/checklists.ts'
import { anchorOf } from '../list/focus.ts'
import { following } from '../list/holding.ts'
import { labelOf } from '../list/scope.ts'
import { heldAs, readKey, readTarget, targetKey, targetName, type Target } from '../list/targets.ts'
import { EditView } from '../src/view/edit.tsx'
import type { Edit } from '../src/store/ask.ts'
import { room } from '../src/view/room.ts'

/**
 * A list held against one module's container on one kehikko, whichever epic
 * is open (Jalez/kehikko-checklist#27), and a list held against more targets
 * than the old bound of 64 (Jalez/kehikko-checklist#23).
 *
 * The case #27 was filed on, in the owner's words: a list made for Flows,
 * held against one epic's paper, showed on that epic's kehikko only — opening
 * the Journey kehikko on another epic and picking Flows showed nothing. Here
 * the same list is held against Flows on the Journey kehikko once, and is in
 * front on that kehikko for both epics, with each epic's ticks its own, and
 * on no other kehikko.
 */

afterEach(cleanup)

let dir = ''
let registry = ''
const registryBefore = process.env.KEHIKOT_MODULES_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-kehikko-'))
  registry = mkdtempSync(join(tmpdir(), 'checklist-registry-'))
  process.env.KEHIKOT_MODULES_DIR = registry
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(registry, { recursive: true, force: true })
  if (registryBefore === undefined) delete process.env.KEHIKOT_MODULES_DIR
  else process.env.KEHIKOT_MODULES_DIR = registryBefore
})

const FLOWS = 'kehikot.flows'
const JOURNEY = 'journey'
const flows = (epic: string | null = null): Target => ({ kind: 'kehikko', kehikko: JOURNEY, module: FLOWS, epic })

async function aList(name = 'What an epic’s issue flows owe'): Promise<{ list: string; item: string }> {
  const { change } = await import('../list/checklists.ts')
  const made = change({ op: 'create', name, by: 'a test' }, dir)
  if (!made.ok) throw new Error(made.error)
  const added = change({ op: 'add', id: made.id, text: 'Every flow names its issue', by: 'a test' }, dir)
  if (!added.ok) throw new Error(added.error)
  return { list: made.id, item: added.held!.rows[0]!.item.id }
}

async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const { answerAt: answer } = await import('../doors.ts')
  const reply = answer(
    'POST',
    '/mcp',
    new URLSearchParams(),
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: dir, ...args } } },
    null,
  )
  const result = (reply?.body as { result: { content: { text: string }[]; isError?: boolean } }).result
  return { text: result.content[0]?.text ?? '', isError: result.isError === true }
}

describe('a module’s container on a kehikko, as a target (#27)', () => {
  test('is spelled under the kehikko’s key and the module’s id, and reads back as itself', () => {
    expect(targetKey(flows())).toBe('kehikko:journey/kehikot.flows')
    expect(targetKey(flows('epic-a'))).toBe('kehikko:journey/kehikot.flows/epic-a')
    for (const target of [flows(), flows('epic-a')]) expect(readKey(targetKey(target))).toEqual(target)
    /* Not spellings this app writes. */
    expect(readKey('kehikko:journey')).toBeNull()
    expect(readKey('kehikko:journey/kehikot.flows/')).toBeNull()
    expect(readKey('kehikko:journey/kehikot.flows/a/b')).toBeNull()
    expect(readKey('kehikko:Journey Board/kehikot.flows')).toBeNull()
  })

  test('is what a door reads when it is given a kehikko and a module, and nothing when the pair is not one', () => {
    expect(readTarget({ kehikko: JOURNEY, module: FLOWS })).toEqual(flows())
    expect(readTarget({ kehikko: JOURNEY, module: FLOWS, epic: 'epic-a' })).toEqual(flows('epic-a'))
    /* Not a paper nobody asked about: a kehikko with no module is refused whole. */
    expect(readTarget({ kehikko: JOURNEY, epic: 'epic-a' })).toBeNull()
    expect(readTarget({ kehikko: 'Not A Key', module: FLOWS })).toBeNull()
    expect(readTarget({ kehikko: JOURNEY, module: 'Not A Module' })).toBeNull()
    /* A ref still wins, and an epic alone is still its paper. */
    expect(readTarget({ ref: 'gh#1', kehikko: JOURNEY, module: FLOWS })).toEqual({ kind: 'ref', ref: 'gh#1' })
    expect(readTarget({ epic: 'epic-a' })).toEqual({ kind: 'paper', epic: 'epic-a', section: null })
  })

  test('is held as the pair, whichever epic’s run was named', () => {
    expect(heldAs(flows('epic-a'))).toEqual(flows())
    expect(heldAs({ kind: 'ref', ref: 'gh#1' })).toEqual({ kind: 'ref', ref: 'gh#1' })
    expect(targetName(flows())).toBe('kehikot.flows on kehikko journey, whichever epic is open')
  })

  test('is labelled with the kehikko’s name where the page knows it, and belongs to the open epic as a whole', () => {
    expect(labelOf(flows('epic-a'), null, null, { key: JOURNEY, name: 'Journey' })).toBe('flows on Journey · epic-a')
    expect(labelOf(flows(), null, null, { key: 'other', name: 'Review' })).toBe('flows on kehikko journey')
    expect(anchorOf({ target: flows('epic-a') })).toEqual([{ whole: true }])
  })

  test('is in front for whichever epic is open while its module’s container is, and for none with no epic', () => {
    const lists = [{ id: 'a', targets: [targetKey(flows())] }, { id: 'b', targets: ['ref:gh#1'] }]
    expect(following({ kehikko: JOURNEY, modules: ['kehikot.paper', FLOWS], epic: 'epic-a', lists })).toEqual([
      { id: 'a', target: flows('epic-a') },
    ])
    expect(following({ kehikko: JOURNEY, modules: [FLOWS], epic: 'epic-b', lists })).toEqual([{ id: 'a', target: flows('epic-b') }])
    /* Another module picked out, another kehikko, or no epic open: not in front. */
    expect(following({ kehikko: JOURNEY, modules: ['kehikot.paper'], epic: 'epic-a', lists })).toEqual([])
    expect(following({ kehikko: 'review', modules: [FLOWS], epic: 'epic-a', lists })).toEqual([])
    expect(following({ kehikko: JOURNEY, modules: [FLOWS], epic: null, lists })).toEqual([])
  })

  test('the store holds the pair once, keeps each epic’s ticks apart, and refuses a tick that names no epic', async () => {
    const { change, inFront } = await import('../list/checklists.ts')
    const { list, item } = await aList()

    const held = change({ op: 'hold', id: list, target: flows('epic-a'), by: 'a test' }, dir)
    expect(held.ok && held.said).toContain('is now held against kehikot.flows on kehikko journey, whichever epic is open')
    const again = change({ op: 'hold', id: list, target: flows(), by: 'a test' }, dir)
    expect(again.ok && again.said).toContain('is already held against')

    const ticked = change({ op: 'tick', id: list, item, target: flows('epic-a'), done: true, by: 'a test' }, dir)
    expect(ticked.ok).toBe(true)
    const none = change({ op: 'tick', id: list, item, target: flows(), done: true, by: 'a test' }, dir)
    expect(none.ok).toBe(false)
    expect(!none.ok && none.error).toContain('Name the epic')

    const at = (epic: string) =>
      inFront({ ladders: [], selection: [], following: { kehikko: JOURNEY, modules: [FLOWS], epic } }, dir).instances
    expect(at('epic-a').map((one) => [one.checklist.id, one.target, one.done])).toEqual([[list, flows('epic-a'), 1]])
    expect(at('epic-b').map((one) => [one.checklist.id, one.target, one.done])).toEqual([[list, flows('epic-b'), 0]])
    /* On another kehikko, nothing. */
    expect(inFront({ ladders: [], selection: [], following: { kehikko: 'review', modules: [FLOWS], epic: 'epic-a' } }, dir).instances).toEqual([])

    const file = (await import('../list/checklists.ts')).snapshot(dir)!
    expect(file.checklists[list]!.targets).toEqual(['kehikko:journey/kehikot.flows'])
    expect(Object.keys(file.ticks[list]!)).toEqual(['kehikko:journey/kehikot.flows/epic-a'])

    /* Releasing one epic's run releases the pair, and keeps the ticks. */
    const released = change({ op: 'release', id: list, target: flows('epic-b'), by: 'a test' }, dir)
    expect(released.ok && released.said).toContain('is no longer held against kehikot.flows on kehikko journey')
    expect(at('epic-a')).toEqual([])
  })

  test('a tick on an epic’s run of a container holds the list against the container', async () => {
    const { change, targetsOf } = await import('../list/checklists.ts')
    const { list, item } = await aList()
    const ticked = change({ op: 'tick', id: list, item, target: flows('epic-a'), done: true, by: 'a test' }, dir)
    expect(ticked.ok && ticked.said).toContain('is now held against kehikot.flows on kehikko journey, whichever epic is open')
    expect(targetsOf(list, dir).map((one) => one.target)).toEqual([flows()])
  })

  test('/api/here answers with the list for the open epic, whatever the paper rung says', async () => {
    const { change } = await import('../list/checklists.ts')
    const { answerAt: answer } = await import('../doors.ts')
    const { list } = await aList()
    change({ op: 'hold', id: list, target: flows(), by: 'a test' }, dir)
    type Here = { instances: { checklist: { id: string }; target: unknown }[] }

    const query = new URLSearchParams({ project: dir, kehikko: JOURNEY, open: 'epic-b' })
    query.append('module', 'kehikot.paper')
    query.append('module', FLOWS)
    const here = answer('GET', '/api/here', query, null, null)?.body as Here
    expect(here.instances.map((one) => [one.checklist.id, one.target])).toEqual([[list, flows('epic-b')]])

    const elsewhere = new URLSearchParams({ project: dir, kehikko: JOURNEY, open: 'epic-b', module: 'kehikot.paper' })
    expect((answer('GET', '/api/here', elsewhere, null, null)?.body as Here).instances).toEqual([])
  })

  test('an agent holds by key and module — the short name read as the module here — and ticks one epic’s run', async () => {
    mkdirSync(registry, { recursive: true })
    writeFileSync(join(registry, `${FLOWS}.json`), '{}\n')
    const { list, item } = await aList()

    const held = await tool('hold_checklist', { checklist: list, kehikko: JOURNEY, module: 'flows' })
    expect(held.isError).toBe(false)
    expect(held.text).toContain('is now held against kehikot.flows on kehikko journey, whichever epic is open')

    const ticked = await tool('check_item', { checklist: list, item, kehikko: JOURNEY, module: FLOWS, epic: 'epic-a', note: 'read them' })
    expect(ticked.isError).toBe(false)
    expect(ticked.text).toContain('ticked for kehikko:journey/kehikot.flows/epic-a')

    const other = await tool('checklists', { checklist: list, kehikko: JOURNEY, module: FLOWS, epic: 'epic-b' })
    expect(other.text).toContain('0/1 ticked')

    const bare = await tool('check_item', { checklist: list, item, kehikko: JOURNEY, module: FLOWS })
    expect(bare.isError).toBe(true)
    expect(bare.text).toContain('Name the epic')
  })

  test('the edit page offers the modules on this kehikko, and a press holds the list against one of them', () => {
    const edits: Edit[] = []
    const held = {
      checklist: { id: 'list1', name: 'What flows owe', at: '', by: 'the owner', origin: null, items: [], holds: 0, next: 0 },
      target: null,
      rows: [],
      done: 0,
      total: 0,
    } as unknown as Held
    const { container, rerender } = render(
      <EditView
        held={held}
        targets={[]}
        modules={['kehikot.paper', FLOWS]}
        kehikko={{ key: JOURNEY, name: 'Journey' }}
        epic="epic-a"
        selection={[]}
        placed={null}
        outline={null}
        paperKnown={false}
        onEdit={(one) => edits.push(one)}
        onDone={() => {}}
        trouble={null}
        busy={false}
        room={room(900, 700)}
      />,
    )
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    const offer = container.querySelector(`[data-pick-kehikko="${JOURNEY}"]`)
    expect(offer?.textContent).toContain('On Journey, whichever epic is open')
    fireEvent.click(container.querySelector(`[data-pick-target="kehikko:journey/${FLOWS}"]`) as HTMLElement)
    expect(edits).toEqual([{ op: 'hold', id: 'list1', target: flows() }])

    /* Held, it is a row that says where, by the kehikko's name. */
    rerender(
      <EditView
        held={held}
        targets={[{ target: flows(), done: 0 }]}
        modules={['kehikot.paper', FLOWS]}
        kehikko={{ key: JOURNEY, name: 'Journey' }}
        epic="epic-a"
        selection={[]}
        placed={null}
        outline={null}
        paperKnown={false}
        onEdit={(one) => edits.push(one)}
        onDone={() => {}}
        trouble={null}
        busy={false}
        room={room(900, 700)}
      />,
    )
    expect(container.querySelector(`[data-release="kehikko:journey/${FLOWS}"]`)?.textContent).toContain('flows on Journey')
  })

  test('a host that sends no kehikko key is offered no container to hold a list against', () => {
    const held = {
      checklist: { id: 'list1', name: 'x', at: '', by: '', origin: null, items: [], holds: 0, next: 0 },
      target: null,
      rows: [],
      done: 0,
      total: 0,
    } as unknown as Held
    const { container } = render(
      <EditView
        held={held}
        targets={[]}
        modules={[FLOWS]}
        kehikko={{ name: 'Journey' }}
        epic="epic-a"
        selection={[]}
        placed={null}
        outline={null}
        paperKnown={false}
        onEdit={() => {}}
        onDone={() => {}}
        trouble={null}
        busy={false}
        room={room(900, 700)}
      />,
    )
    fireEvent.click(container.querySelector('[data-switch]') as HTMLElement)
    expect(container.querySelector('[data-pick-kehikko]')).toBeNull()
  })
})

describe('how many targets one list is held against (#23)', () => {
  test('a list for every issue is held against far more than 64', async () => {
    const { change, targetsOf } = await import('../list/checklists.ts')
    const { list } = await aList('What an issue owes')
    for (let n = 1; n <= 200; n += 1) {
      const out = change({ op: 'hold', id: list, target: { kind: 'ref', ref: `gh#${n}` }, by: 'an agent' }, dir)
      if (!out.ok) throw new Error(`hold ${n}: ${out.error}`)
    }
    expect(targetsOf(list, dir)).toHaveLength(200)
  })

  test('there is no bound: a list past the old ten thousand is held against one more, and ticked there', async () => {
    const checklists = await import('../list/checklists.ts')
    expect('MAX_TARGETS' in checklists).toBe(false)
    const { change, targetsOf } = checklists
    const { list, item } = await aList('What an issue owes')

    /* Ten thousand and one targets, in the layout-1 file the cap was guarding,
       migrated on the next read rather than held one at a time. */
    const before = checklists.snapshot(dir)!
    rmSync(join(dir, KEHIKOT_DIR, moduleFolder(ID)), { recursive: true, force: true })
    mkdirSync(join(dir, KEHIKOT_DIR, moduleFolder(ID)), { recursive: true })
    before.checklists[list]!.targets = Array.from({ length: 10_001 }, (_, n) => `ref:gh#${n + 1}`)
    writeFileSync(join(dir, KEHIKOT_DIR, moduleFolder(ID), 'checklists.json'), JSON.stringify(before))

    const hold = change({ op: 'hold', id: list, target: { kind: 'ref', ref: 'gh#0' }, by: 'an agent' }, dir)
    expect(hold.ok && hold.said).toContain('is now held against gh#0')
    const tick = change({ op: 'tick', id: list, item, target: { kind: 'ref', ref: 'gh#20000' }, done: true, by: 'an agent' }, dir)
    expect(tick.ok && tick.said).toContain('is now held against gh#20000')
    expect(targetsOf(list, dir)).toHaveLength(10_003)
    expect(checklists.checklists(dir).lists[0]?.targets).toBe(10_003)
  })
})

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer } from '../doors.ts'
import { ASK } from '../project.ts'

/** The door resolves every project path with the host before the store is touched. */

const home = mkdtempSync(join(tmpdir(), 'kehikko-checklist-moved-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))
const was = ASK.options
afterEach(() => {
  ASK.options = was
})

const ID = 'proj-1234abcd'
const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' }
const none = new URLSearchParams()

function host(table: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const path = new URL(url).searchParams.get('path') ?? ''
    return new Response(JSON.stringify(table[path] ?? { ok: true, project: false }), { status: 200 })
  }) as never
}

const create = (project: string) => answer('POST', '/api/checklist', none, { op: 'create', name: 'Release', project }, TICKET)

describe('a project that moved', () => {
  test('a former path is followed: the write lands in the new folder and the answer says so', async () => {
    const now = join(home, 'new')
    const old = join(home, 'old')
    mkdirSync(now)
    ASK.options = { env, fetch: host({ [old]: { ok: true, project: false, movedTo: now, id: ID }, [now]: { ok: true, project: true, id: ID } }) }
    const reply = await create(old)
    expect(reply?.status).toBe(200)
    expect(JSON.stringify(reply?.body)).toContain(`has moved to ${now}`)
    expect(existsSync(join(now, '.kehikot', 'checklist', 'checklists.json'))).toBe(true)
    expect(existsSync(old)).toBe(false)
  })

  test('the same through an agent’s tool call', async () => {
    const now = join(home, 'new')
    const old = join(home, 'old-mcp')
    ASK.options = { env, fetch: host({ [old]: { ok: true, project: false, movedTo: now, id: ID }, [now]: { ok: true, project: true, id: ID } }) }
    const reply = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'checklists', arguments: { project: old } } }, null)
    const text = JSON.stringify(reply?.body)
    expect(text).toContain('Release')
    expect(text).toContain(`has moved to ${now}`)
  })

  test('an unrelated folder at the old path is refused and nothing is written', async () => {
    const stranger = join(home, 'stranger')
    mkdirSync(stranger)
    ASK.options = { env, fetch: host({}) }
    const reply = await create(stranger)
    expect(reply?.status).toBe(400)
    expect(JSON.stringify(reply?.body)).toContain('is not a project open in Kehikot')
    expect(existsSync(join(stranger, '.kehikot'))).toBe(false)
    const tool = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_checklist', arguments: { project: stranger, name: 'x' } } }, null)
    expect(JSON.stringify(tool?.body)).toContain('isError')
    expect(existsSync(join(stranger, '.kehikot'))).toBe(false)
  })

  test('with no host answering, a read is refused and nothing is written', async () => {
    const dir = join(home, 'nohost')
    mkdirSync(dir)
    ASK.options = {
      env,
      fetch: (async () => {
        throw new Error('ECONNREFUSED')
      }) as never,
    }
    expect((await answer('GET', '/api/checklists', new URLSearchParams({ project: dir }), null, null))?.status).toBe(400)
    expect((await create(dir))?.status).toBe(400)
    expect(existsSync(join(dir, '.kehikot'))).toBe(false)
  })
})

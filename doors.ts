import { ID, MANIFEST, VERSION } from './manifest.ts'
import { standingFor } from './derive/standing.ts'
import { shortSha, tickState } from './derive/derive.ts'
import { hostOf } from './derive/refs.ts'
import type { RefState } from './derive/ref-state.ts'
import {
  agentItems,
  checklistFor,
  effectiveList,
  exemptFor,
  humanRefusal,
  ownerMayTick,
  setChecklist,
  type ChecklistOp,
} from './list/store.ts'
import { announce, since } from './list/outbox.ts'
import { checklistView } from './list/view.ts'
import { known, remember, seen, setTick } from './list/ticks.ts'

/**
 * Every door this app answers on that is not the page itself.
 *
 * ## Why this is a file of functions rather than a server
 *
 * It used to be one: `Bun.serve` with a `fetch` handler, started by `run.sh`,
 * serving the page off a string and the store off `/api`. That program was
 * correct and is gone, for a reason that has nothing to do with Bun.
 *
 * A module is ONE ORIGIN or it is nothing. The protocol refuses a manifest whose
 * `entry` points anywhere but the origin that served the manifest, and it is
 * right to — a program that could name somebody else's page would be a program
 * that could have the host frame somebody else. The page is now served by Vite,
 * because a `dist/` served off disk has cost this codebase whole afternoons of a
 * stale page answering 200 with every symptom of a working app and none of the
 * changes. So the page is Vite's, and therefore the manifest, the health check,
 * the MCP door and this app's own store have to be Vite's too — they cannot be a
 * second process on a second port however much tidier that would look.
 *
 * Hence: no listener here. `answer()` takes a method, a path, a query and a body
 * and returns a status and a document, and `vite.config.ts` adapts a node
 * request to it in a dozen lines.
 *
 * ## The store is still this app's own, and that is the whole point
 *
 * `/api/lists`, `/api/known`, `/api/standings` and `/api/tick` read and write two
 * files beside this program. None of it involves a host, and the page is fully
 * drawn before a single bridge message is read. What a host adds is the
 * `RefState` for a reference — which turns four rows from `unasked` into
 * verdicts — and nothing else. The extraction is only a real extraction if that
 * stays true.
 */

/* ------------------------------------------------------------------ *
 * Everything that arrives, bounded before it is looked at
 *
 * Nothing here trusts its caller. The page is one caller, an agent over MCP is
 * another, and a third is whatever else is running on this machine and found
 * the port — this listens on loopback, which is a fence around the machine and
 * not around the programs on it. A string has a length before it has a meaning.
 * ------------------------------------------------------------------ */

const MAX_REF = 80
const MAX_ITEM = 80
const MAX_NOTE = 400
const MAX_FROM = 80
/**
 * How many references one `/api/standings` call may ask about.
 *
 * The protocol caps a selection at `LIMITS.REFS`, which is 32, and this is that
 * number with room to spare rather than that number exactly: the page is not the
 * only caller, and a bound that tracked another program's constant would break
 * quietly the day that constant moved. Each standing is a fresh read of two
 * small files, so the cost is real but linear; what this stops is one request
 * asking for ten thousand of them.
 */
const MAX_REFS_PER_ASK = 64

function str(value: unknown, max: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max)
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/**
 * A caller saying it knows what a reference IS, which the reference cannot say.
 *
 * `gh#105` is an issue or a pull request and the spelling does not tell you
 * which; only a tracker read can, and this app never reads a tracker. So
 * `shapeOf` answers `unsettled` and `standingFor` shows BOTH lists rather than
 * guessing — which is the right default and a poor answer when the caller
 * genuinely knows.
 *
 * The page does know, when it is framed. A host's reading of an epic files a
 * reference into one of four bags, and which bag it was in is the only thing
 * that says what it is — the same fact References reads, from the same place. So
 * the page may pass it here, and this is where it is bounded: anything that is
 * not one of the two words `shapeOf` produces is discarded rather than trusted,
 * because the caller might equally be whatever else on this machine found the
 * port. `unsettled` is deliberately not accepted as an input: it is a conclusion
 * this app reaches by not knowing, not a claim anyone can make on its behalf, and
 * accepting it would let a caller silently overrule a settled `!1848`.
 */
function shape(value: unknown): 'change' | 'work' | undefined {
  return value === 'change' || value === 'work' ? value : undefined
}

/**
 * The ticket a write has to carry.
 *
 * Minted once per process and printed into the page this server serves. It dies
 * with this process, the way a host's own send ticket does, because a secret
 * that outlives the thing that issued it is one nobody can revoke by restarting.
 *
 * What it separates is "this app's own page ticked something" from "something
 * else on this machine guessed the port and posted", and on a loopback server
 * that separation is not otherwise available. Reads are not gated on it — a
 * checklist is not a secret, and gating reads would only mean an agent's curl
 * needs a ticket to look at a page it can already open.
 *
 * ## Why it is worth more here than it was in Journeys, and it is the manifest
 *
 * Journeys wrote, honestly, that its ticket separated less than it looked like:
 * the page was framed opaque, so the server answered every origin with
 * permissive CORS, so any page in any tab could read `/app` and take the ticket
 * off loopback. This module declares `storage: true` and sets no `server.cors`,
 * which is the fix rather than a mitigation — the page has a real origin, its
 * own fetches are same-origin, no CORS header is offered to anybody, and
 * `/app` is unreadable from another origin. So the ticket is back to separating
 * what it was meant to.
 *
 * It is still not an authorization check, and the one thing standing between an
 * agent and the owner's tick is not this: it is `ownerMayTick` and
 * `humanRefusal`, which refuse from opposite sides and say so in words.
 */
export const TICKET = crypto.randomUUID()

/** The word a tick is filed under when the page made it. */
const OWNER = 'the owner, on this app’s own page'

/** What an agent is called when it does not say. */
const AGENT = process.env.CHECKLIST_AGENT ?? process.env.ROADMAP_AGENT ?? 'an agent'

/* ------------------------------------------------------------------ *
 * The agent's door
 * ------------------------------------------------------------------ */

/**
 * The two tools, which are the ones the built-in had: what a change is held to
 * and where it stands, and asserting one item of it.
 *
 * Streamable HTTP, one request one answer — no sessions and no stream, because
 * nothing here pushes. The names are this app's own and are deliberately NOT
 * renamed to follow protocol 2's `epics.list` / `epic.get` spelling. Those are
 * WIRE method names in the vocabulary a host and a module agree on; these are
 * MCP tools over a store whose every file on disk is keyed by a merge request or
 * a pull request. `mr_checklist` names what it is asked about.
 */
function tools() {
  return [
    {
      name: 'mr_checklist',
      description:
        'The steps every merge request and pull request goes through, and for one of them, where it stands. '
        + 'Items a tracker answers are computed here from what a host last handed this app — it never calls a '
        + 'tracker itself, so an item nothing has shown it reads "not asked" rather than being ticked for you. The '
        + 'rest you tick yourself with check_mr. Read this before opening a change, and again before handing it to '
        + 'a person. Works on a GitLab merge request (!1848) and on a GitHub pull request (gh#1888); omit the ref '
        + 'for the bare list.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            description: 'A merge request or pull request, e.g. "!1848", "gh#1888". Omit for the bare list.',
          },
        },
      },
    },
    {
      name: 'check_mr',
      description:
        `Assert something only you can know about a merge request or pull request. As this server started those `
        + `were: ${agentItems().join(', ')} — the list is editable, so call mr_checklist for the one in force rather `
        + `than trusting this sentence, which was written once and cached by your client. The tracker-answered items `
        + `cannot be ticked here — fix the change instead and they follow. Nor can the owner's: an item that asks `
        + `whether a person has agreed to something is refused to you, and the refusal says what to do instead. An `
        + `item that cannot apply on that tracker is refused with the reason. Pass done: false to take a tick back.`,
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'The merge request or pull request, e.g. "!1848", "gh#1888"' },
          item: {
            type: 'string',
            description:
              'The item id, as mr_checklist lists it. Checked against the list as it stands, not as it stood when this server started.',
          },
          note: { type: 'string', description: 'How you know — the test name, what the reviewers said' },
          done: { type: 'boolean', description: 'Defaults to true' },
          agent: { type: 'string' },
        },
        required: ['ref', 'item'],
      },
    },
  ]
}

/** The bare list, in the GitLab wording, with the exemptions spelled out. */
function bareList(): string {
  const list = effectiveList('mr')
  const onList = new Set(list.map((c) => c.id))
  const onGitlab = exemptFor('gitlab')
  const onGithub = exemptFor('github')
  /* Only for items still on the list: an exemption is "this one does not apply
     here", which says nothing about an item nobody is asked for at all, and
     printing one would invent an expectation. */
  const said = (where: string, m: Record<string, string>) =>
    Object.entries(m)
      .filter(([id]) => onList.has(id))
      .map(([id, why]) => `[n/a on a ${where}] ${id}\n      ${why}`)
  return [
    ...list
      .filter((c) => !(c.id in onGitlab))
      .map(
        (c) =>
          `[${c.kind === 'agent' ? 'you' : c.kind === 'human' ? 'the owner' : 'read'}] ${c.id} — ${c.label}\n      ${c.why}`,
      ),
    ...said('GitLab merge request', onGitlab),
    ...said('GitHub pull request', onGithub),
  ].join('\n')
}

/** Where one reference stands, in the marks the built-in's tool already used. */
function standingText(ref: string): string {
  /* Told to read it as a change, because this tool's own name is that claim:
     `mr_checklist` is asked about a merge request or a pull request, so a `gh#`
     number arriving here is one — which the reference alone could never say, and
     which the page, asked about the same number, does not assume. */
  const s = standingFor(ref, 'change')
  const lines = s.rows.map((row) => {
    if (row.exempt) return `[-] ${row.id} — not here: ${row.exempt}`
    if (row.orphan) return `[o] ${row.id} — ${row.why}`
    if (row.kind === 'derived') {
      const mark = row.state === 'done' ? 'x' : row.state === 'failed' ? '!' : row.state === 'pending' ? ' ' : '?'
      /* Three different answers, kept apart. "Nothing has shown this app a
         tracker state" is not "the tracker had nothing to say", and telling an
         agent to go and look at a pipeline that was never read sends it round a
         loop that cannot help. */
      const why =
        row.state === 'unasked'
          ? ' (not asked: nothing has shown this app what a tracker says about it)'
          : row.state === 'unknown'
            ? ' (nothing answers this here)'
            : ''
      return `[${mark}] ${row.id} — ${row.label}${why}${row.detail ? ` — ${row.detail}` : ''}`
    }
    const mark = row.state === 'done' ? 'x' : row.state === 'stale' ? '~' : ' '
    const moved = row.state === 'stale' ? ` — STALE, ${row.note}` : ''
    const who = row.at ? `  (${row.by}${row.note && row.state !== 'stale' ? `: ${row.note}` : ''})` : ''
    return `[${mark}] ${row.id} — ${row.label}${moved}${who}`
  })
  const head = s.seen
    ? `${s.ref} — ${s.noun}, tracker state as ${s.seen.from} had it ${s.seen.ago} ago`
    : `${s.ref} — ${s.noun}`
  const tail = s.cannotSee ? `\n\n${s.cannotSee}` : ''
  return `${head}\n${lines.join('\n')}${tail}`
}

/** Tick one item, as an agent — which is the half an agent is allowed. */
function assert(input: { ref: string; item: string; note?: string; done?: boolean; agent?: string }): string {
  const ref = input.ref
  const item = input.item
  const host = hostOf(ref)
  if (input.done === false) {
    /* Untick is not gated on the item applying here: a tick filed before an
       exemption existed still has to be removable. */
    const out = setTick({ ref, item, done: false, agent: input.agent || AGENT })
    if (!out.ok) throw new Error(out.error)
    return `${ref}: ${item} unticked.`
  }
  /* Checked against the list as it is NOW, not as it stood when this server
     started. The names in the tool's own description cannot be corrected in a
     client that has already cached them, so the refusal has to be the thing that
     tells the truth. */
  const live = effectiveList('mr')
  const found = live.find((x) => x.id === item)
  if (!found) {
    /* Asked of the issue list too, and only to answer BETTER. An owner-ticked
       item lives there, so an agent reaching for it would otherwise be told
       "there is no such item" — which is true of this list and useless, since the
       item plainly exists and is on the page in front of them. */
    const elsewhere = effectiveList('issue').find((x) => x.id === item)
    if (elsewhere?.kind === 'human') throw new Error(humanRefusal(ref, item))
    const tickable = checklistFor(host)
      .filter((x) => x.kind === 'agent')
      .map((x) => x.id)
    const rest = tickable.length
      ? `What you can tick on this one is ${tickable.join(', ')}`
      : 'Nothing on this checklist is yours to tick on this tracker: every item an agent could assert is marked as not applying here, each with its reason'
    throw new Error(
      `${ref}: there is no "${item}" on the checklist. ${rest} — the list is editable, so it may have changed since this session started. mr_checklist has the whole of it, including anything you have already ticked that is no longer on it.`,
    )
  }
  if (found.kind === 'derived') {
    throw new Error(
      `${ref}: ${item} is read off the tracker, not ticked here — mr_checklist shows what it currently answers. Fix the change and it follows.`,
    )
  }
  /* The refusal that is the whole of the gate.

     An item asking whether a person has agreed to something, which the party
     doing the asking can tick, is not a gate — it is a formality with a box
     beside it. So there is no note, no flag and no override here: the answer has
     to arrive from somewhere this tool cannot reach, and in this app that
     somewhere is a press on its own page, over its own origin, holding a ticket
     this process handed out. Saying who ticks it and where matters as much as
     the refusal, or an agent meets a dead end and works around it. */
  if (found.kind === 'human') throw new Error(humanRefusal(ref, item))
  const exempt = exemptFor(host)[item]
  if (exempt) throw new Error(`${ref}: ${item} does not apply here. ${exempt}`)
  const head = seen(ref)?.state.sha
  const out = setTick({ ref, item, done: true, agent: input.agent || AGENT, note: input.note, sha: head })
  if (!out.ok) throw new Error(out.error)
  const now = new Map(out.ticks.map((t) => [t.item, t]))
  const mine = checklistFor(host)
    .filter((x) => x.kind === 'agent')
    .map((x) => x.id)
  const left = mine.filter((i) => tickState(i, now.get(i), head) !== 'done')
  const pinned = head ? ` Pinned to ${shortSha(head)}.` : ''
  return `${ref}: ${item} ticked.${pinned}${left.length ? ` Still yours to do: ${left.join(', ')}.` : ' Your half is done.'}`
}

/** A status and a document. Nothing here writes bytes; the adapter does that. */
export interface Reply {
  status: number
  /** `null` means "answer with no body", which is what a notification gets. */
  body: unknown
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function mcp(rpc: Rpc): Reply {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })
  const text = (s: string, isError = false) =>
    reply({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) })

  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions:
        'What a change is held to before it is somebody else’s problem. This app holds the lists and the ticks; '
        + 'it never calls a tracker, so the items read from one are computed from what a host last handed it, and '
        + 'say so when nothing has.',
    })
  }
  /* A notification carries no id and is answered with nothing. */
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })

  if (rpc.method === 'tools/call') {
    const name = String(rpc.params?.name ?? '')

    /*
     * Every tool call is written down for this app's own page to announce.
     *
     * Here rather than inside each tool, and BEFORE the call is made, for one
     * reason: what is being announced is that an agent reached through this
     * door, which is true whether the tool went on to succeed, refuse or throw.
     * A record written only on success would be a notification panel that shows
     * an agent's wins and is silent about the eight refusals in between, which
     * is the least useful half of what happened.
     *
     * The wording therefore says what was CALLED, not what resulted. This app
     * is not going to relay somebody's refusal message onto a shared panel —
     * that sentence names who may do the thing instead, and it belongs to the
     * agent that asked, not to whoever is looking at a canvas.
     *
     * `announce` cannot throw and must not: the work is already done by the
     * time anything below runs, and an exception here would turn a recorded
     * tick into a transport error the agent retries.
     */
    announce({
      tool: name,
      refs: [str((rpc.params?.arguments ?? {}).ref, MAX_REF)].filter(Boolean),
      message: `an agent called ${name.slice(0, 60)} on the checklist`,
      /* `info`. A tool call is a thing that happened and not a thing that needs
         anybody. `attention` on every one of them would be a panel where the
         loud level means nothing. */
      level: 'info',
    })

    const args = (rpc.params?.arguments ?? {}) as {
      ref?: unknown
      item?: unknown
      note?: unknown
      done?: unknown
      agent?: unknown
    }
    try {
      if (name === 'mr_checklist') {
        const ref = str(args.ref, MAX_REF)
        return text(ref ? standingText(ref) : bareList())
      }
      if (name === 'check_mr') {
        const ref = str(args.ref, MAX_REF)
        const item = str(args.item, MAX_ITEM)
        if (!ref || !item) return text('check_mr needs a ref and an item', true)
        return text(
          assert({
            ref,
            item,
            note: str(args.note, MAX_NOTE) || undefined,
            done: args.done === false ? false : true,
            agent: str(args.agent, MAX_FROM) || undefined,
          }),
        )
      }
    } catch (e) {
      /* A refusal is an answer, and the sentence is the useful half — every one
         of them names who may do the thing instead. So it comes back as a tool
         error the agent reads, not as a transport failure it retries. */
      return text(e instanceof Error ? e.message : String(e), true)
    }
    const shown = name.length > 60 ? `${name.slice(0, 60)}…` : name
    return text(`no tool "${shown}" here`, true)
  }

  return {
    status: 404,
    body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } },
  }
}

/**
 * Every door but the page, as one function.
 *
 * `null` means "this path is not ours", and the caller passes it on to Vite —
 * which is how the page, the client module and Vite's own hot-reload socket keep
 * working without being enumerated here.
 */
export function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Reply | null {
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION, items: effectiveList('mr').length })

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc)
  }

  /* Both lists, as this app now holds them, with what shipped travelling beside
     what is in force. */
  if (path === '/api/lists' && method === 'GET') return ok(checklistView())

  /* Every reference this app has anything recorded about, so a reader coming
     back to it with nothing selected is not staring at an empty box wondering
     what it knows. */
  if (path === '/api/known' && method === 'GET') return ok({ ok: true, refs: known() })

  /*
   * What has come through the MCP door since the page last looked.
   *
   * Read-only and ungated, like every other read here: it says which of this
   * app's own tools an agent called, which is less than `/api/lists` already
   * gives away. See `list/outbox.ts` for why this exists at all — the half of
   * this app that knows a tool was called has no wire, and the half with a wire
   * does not know.
   */
  if (path === '/api/announcements' && method === 'GET') {
    const cursor = Number(query.get('since') ?? '0')
    return ok({ ok: true, ...since(Number.isFinite(cursor) && cursor >= 0 ? cursor : 0) })
  }

  if (method === 'POST' && path.startsWith('/api/')) {
    /* The gate on every write, and it is one line because the whole argument for
       it is in `TICKET` above. An agent's door is `/mcp` and is deliberately
       above this check: an MCP client is not a browser, has no page to have been
       handed a ticket, and requiring one there would mean the door could never be
       opened by the thing it exists for. */
    if (ticket !== TICKET) return bad('that press did not come from this app’s own page', 403)
    if (!body) return bad('that was not a request')

    if (path === '/api/lists') {
      if (typeof body.op !== 'string') return bad('that is not an edit')
      return ok(setChecklist({ ...(body as unknown as ChecklistOp), by: OWNER }))
    }

    if (path === '/api/standings') {
      const asked = Array.isArray(body.refs) ? body.refs.slice(0, MAX_REFS_PER_ASK) : []
      const from = str(body.from, MAX_FROM) || 'this page'
      const standings = []
      for (const wanted of asked) {
        const row = (wanted ?? {}) as { ref?: unknown; state?: unknown; shape?: unknown }
        const ref = str(row.ref, MAX_REF)
        if (!ref) continue
        /* A state that came with the question is remembered before it is used.
           This is the ONLY way a tracker fact ever reaches this app, and it is
           stamped with when and from where so that everything printing it can say
           how old it is rather than stating it flat. */
        if (row.state && typeof row.state === 'object' && !Array.isArray(row.state)) {
          remember(ref, row.state as RefState, from)
        }
        standings.push(standingFor(ref, shape(row.shape)))
      }
      return ok({ ok: true, standings })
    }

    if (path === '/api/tick') {
      const ref = str(body.ref, MAX_REF)
      const item = str(body.item, MAX_ITEM)
      if (!ref || !item) return bad('a tick needs a reference and an item')
      /* The mirror of `check_mr`'s refusal, and narrow in the same way. The agent
         half is asserted over MCP so the agent's name goes on it, and the derived
         half is read from a tracker; a page that could tick either would be a way
         to hand-wave both. So this admits exactly one kind, and the refusal says
         which of the other two it met — those have opposite remedies. */
      const may = ownerMayTick(item)
      if (!may.ok) return bad(may.error, 403)
      const out = setTick({
        ref,
        item,
        done: body.done !== false,
        agent: OWNER,
        note: str(body.note, MAX_NOTE) || undefined,
        sha: seen(ref)?.state.sha ?? null,
      })
      if (!out.ok) return { status: 500, body: out }
      /* Answered with the whole standing rather than with the tick, so the page
         paints from what the server decided rather than toggling itself green on
         a write that may have failed halfway. */
      return ok({ ok: true, standing: standingFor(ref) })
    }
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

export { MANIFEST }

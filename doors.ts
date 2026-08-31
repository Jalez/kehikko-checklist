import { ID, MANIFEST, VERSION } from './manifest.ts'
import {
  MAX_ID,
  MAX_NAME,
  MAX_NOTE,
  MAX_TEXT,
  change,
  checklists,
  held,
  targetsOf,
  type Op,
} from './list/checklists.ts'
import { announce, since } from './list/outbox.ts'
import { MAX_TARGET_PART, readTarget, targetKey, targetName, type Target } from './list/targets.ts'

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
 * ## What is behind these doors now, which is much less than it was
 *
 * There used to be a derived half: `/api/standings` took a tracker reading a
 * host had handed over, ran a `derive()` function against a hardcoded list, and
 * answered with seven verdicts per row. It is gone with the hardcoded lists —
 * see `list/checklists.ts` for why. What remains is a store of checklists
 * somebody wrote and the ticks made on them, per target, and every door here
 * reads or writes exactly that.
 */

/* ------------------------------------------------------------------ *
 * Everything that arrives, bounded before it is looked at
 *
 * Nothing here trusts its caller. The page is one caller, an agent over MCP is
 * another, and a third is whatever else is running on this machine and found
 * the port — this listens on loopback, which is a fence around the machine and
 * not around the programs on it. A string has a length before it has a meaning.
 * ------------------------------------------------------------------ */

const MAX_FROM = 80

/**
 * As long as a project path may be: the protocol package's own `LIMITS.PATH`.
 *
 * Bounded here as well as in `store.ts`, and the two are not redundant. This one
 * stops an unbounded string being carried around and interpolated into a refusal
 * sentence somebody is going to read; that one decides whether the path names a
 * folder this app will write under. A string has a length before it has a
 * meaning.
 */
const MAX_PROJECT = 4096

function str(value: unknown, max: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max)
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/**
 * Which project a request is about, bounded — or null, meaning none was named.
 *
 * ## Why every door takes one, and why none of them defaults
 *
 * This app's store moved into the project: `<projectPath>/.kehikot/checklist/checklists.json`.
 * So "which checklists" is not answerable without "whose", and the string that
 * answers it arrives on the request. The page reads it from
 * `roadmap.context.projectPath` and passes it on; an agent over MCP says it in
 * the `project` argument and is refused without one.
 *
 * The refusal is the part worth defending, because a default was available and
 * every default on offer is wrong. The argument is made at length in the
 * Learning module's `quiz/projects.ts` and it holds here unchanged:
 *
 * - `process.cwd()` is THIS module's own directory, not the caller's. It would
 *   file every checklist under `/Users/…/kehikko-checklist`, where no page would
 *   ever show one and no project would ever carry one.
 * - "The only project that exists, if there is exactly one" is correct until the
 *   day there are two, at which point lists silently start landing in whichever
 *   was seen first.
 * - Nothing at all — one store beside the program — is the arrangement being
 *   removed, and it is precisely what let one project's checklists sit on screen
 *   while somebody was working in another.
 *
 * So it is refused, in a sentence saying what to pass. A refusal an agent can
 * act on costs one round trip; a wrong default costs somebody their work in a
 * folder they will never open.
 *
 * The path is NOT resolved here. `store.ts` does that, with `realpathSync`, and
 * fences what it resolves to inside the project it claims to be inside —
 * because this is a string off a request that is about to become a directory.
 */
function project(value: unknown): string | null {
  const raw = str(value, MAX_PROJECT)
  return raw || null
}

/** What a caller is told when it did not say which project. Written once, read by every door. */
const NO_PROJECT =
  'this needs project: the absolute path of the project folder these checklists belong to, e.g. '
  + '"/Users/you/Projects/thing". Checklists live inside the project they are about, in its .kehikot/checklist '
  + 'folder, so there is no such thing as "the checklists" without one — and this app will not guess at which '
  + 'project was meant, because a guess writes somebody’s list into a repository they will never look in.'

/**
 * The ticket a write has to carry.
 *
 * Minted once per process and printed into the page this server serves. It dies
 * with this process, the way a host's own send ticket does, because a secret
 * that outlives the thing that issued it is one nobody can revoke by restarting.
 *
 * What it separates is "this app's own page pressed something" from "something
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
 * `/app` is unreadable from another origin.
 *
 * It is still not an authorization check, and under the new model there is
 * nothing here it is the last line of defence for: every item on every list is
 * one somebody typed, an agent may tick any of them, and what makes that safe is
 * that the tick says who made it and can be taken back with one press. See the
 * essay on `tickSchema` in `list/checklists.ts` for what happened to the gate
 * that used to be the answer to this paragraph.
 */
export const TICKET = crypto.randomUUID()

/** The word a change is filed under when the page made it. */
const OWNER = 'the owner, on this app’s own page'

/** What an agent is called when it does not say. */
const AGENT = process.env.CHECKLIST_AGENT ?? process.env.ROADMAP_AGENT ?? 'an agent'

/* ------------------------------------------------------------------ *
 * The agent's door
 * ------------------------------------------------------------------ */

/**
 * How a tool says which target it means, written once because several tools
 * would otherwise say it several slightly different ways.
 *
 * The three arguments are the two kinds of target `list/targets.ts` defines: a
 * tracker reference, or an epic and optionally a section of the paper it is
 * aimed at. They are separate arguments rather than one opaque string so that a
 * caller cannot spell a target wrong and have it silently become a new one —
 * `epic` without `ref` is unambiguous, and a typo in a section id produces a new
 * section rather than a new kind of thing.
 */
/**
 * How every tool says which project it means, written once for the same reason
 * the target properties are.
 *
 * On every tool and required by every tool, including the read. A read that
 * defaulted would answer with some other project's lists, which is worse than
 * refusing: an agent shown the wrong checklist has no way to tell, and will tick
 * items off it.
 */
const PROJECT_PROPERTY = {
  project: {
    type: 'string',
    description:
      'The absolute path of the project folder these checklists belong to, e.g. "/Users/you/Projects/thing". '
      + 'Checklists live inside the project, in its .kehikot/checklist folder, so every call needs to say which '
      + 'project. This is the same path the host shows for the open project.',
  },
} as const

const TARGET_PROPERTIES = {
  ref: {
    type: 'string',
    description:
      'The issue, merge request or pull request this list is being held against, e.g. "gh#105", "!44", "#12". '
      + 'Give this OR an epic, not both.',
  },
  epic: {
    type: 'string',
    description: 'The epic whose paper this list is being held against, as list_epics spells it. Give this OR a ref.',
  },
  section: {
    type: 'string',
    description:
      'Optional, and only with an epic: a place inside the paper. Use a name that is stable in the source — a '
      + "\\label{}, a chapter file's name, an id an outline already uses. NOT a page number and NOT the words of a "
      + 'heading: both of those move every time somebody edits the document, and ticks keyed to them would end up '
      + 'describing different prose. Omit it to hold the list against the whole paper, which is a different target '
      + 'from any section in it.',
  },
} as const

/**
 * The seven tools, which are the whole of what an agent can do here.
 *
 * Streamable HTTP, one request one answer — no sessions and no stream, because
 * nothing here pushes.
 *
 * ## What is NOT here, and why
 *
 * `mr_checklist` and `check_mr` are gone. They named a merge request because the
 * list they read was a merge request's, hardcoded in this program; there is no
 * such list now and a tool named after one would be a tool about nothing. The
 * six `*_paper_item` tools are gone the same way — a paper's list was a second
 * KIND of list, and there is one kind now, so a second family of tools for it
 * would be two names for one thing.
 *
 * There is no `forget_checklist` either, and that omission is deliberate rather
 * than an oversight. Removing a list takes every tick anybody ever made on it,
 * against every target, and it is the one irreversible act in this app. It is
 * available on the page, behind a two-press arm, where a person is doing it to
 * their own material. An agent that wanted it can say so and be told no by
 * somebody.
 */
function tools() {
  return [
    {
      name: 'checklists',
      description:
        'Every checklist this app holds, or one of them in full. Nothing here ships a list: each one was created by '
        + 'a person or by an agent, so what comes back is exactly what somebody has written down and no more. Give a '
        + 'checklist id to read that list; add a ref or an epic to see what has been ticked on it FOR that target, '
        + 'which is where the ticks actually live — the same list held against two issues keeps two separate sets. '
        + 'Read this before starting work and again before saying you are done.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id. Omit to list every checklist.' },
          ...TARGET_PROPERTIES,
        },
        required: ['project'],
      },
    },
    {
      name: 'create_checklist',
      description:
        'Start a new checklist under a name. Only do this when you have looked at what already exists and none of it '
        + 'is the list you mean — two lists that say nearly the same thing is the failure this app is most likely to '
        + 'suffer, because nothing stops anybody making one. The name is what a person picks it by, so say what the '
        + 'list is for rather than what it is: "what a merge request owes before review", not "checklist 2".',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          name: { type: 'string', description: `What this list is for. Up to ${MAX_NAME} characters.` },
          agent: { type: 'string', description: 'Your own name, so the list says who started it' },
        },
        required: ['project', 'name'],
      },
    },
    {
      name: 'add_checklist_item',
      description:
        'Add one line to a checklist. It goes on the end, which is where a new thing belongs until somebody says '
        + 'otherwise — move_checklist_item is how it gets somewhere else. Write what is owed, in a line somebody else '
        + 'could act on. The id it comes back with is how you address it afterwards; the words and the position both '
        + 'move. Adding an item adds it for every target this list is held against, because it is the LIST that '
        + 'changed.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id, as the checklists tool prints it' },
          text: { type: 'string', description: `What is owed. Up to ${MAX_TEXT} characters.` },
          agent: { type: 'string', description: 'Your own name, so the list says who wrote the line' },
        },
        required: ['project', 'checklist', 'text'],
      },
    },
    {
      name: 'check_item',
      description:
        'Tick one item FOR ONE TARGET, or take a tick back with done: false. This is the tool the module exists for: '
        + 'a tick belongs to the checklist, the item and the target together, so ticking item 3 for gh#105 says '
        + 'nothing at all about gh#106. You may tick these — every item here is a line somebody wrote down and you '
        + 'are often the one who did the work. The record says it was you and that it came through this door, and a '
        + 'person can take it back with one press, so tick what you have actually done and leave what you cannot '
        + 'judge, saying that you did.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id' },
          item: { type: 'string', description: 'The item id, as the checklists tool prints it beside the line' },
          ...TARGET_PROPERTIES,
          note: { type: 'string', description: 'How you know — the test name, what you changed, where it is' },
          done: { type: 'boolean', description: 'Defaults to true' },
          agent: { type: 'string' },
        },
        required: ['project', 'checklist', 'item'],
      },
    },
    {
      name: 'reword_checklist_item',
      description:
        'Change what one item says, keeping its id, its position and every tick made on it against every target. For '
        + 'sharpening a line somebody wrote in a hurry. To say a different thing, add a different item.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id' },
          item: { type: 'string', description: 'The item id' },
          text: { type: 'string', description: `The new wording. Up to ${MAX_TEXT} characters.` },
          agent: { type: 'string' },
        },
        required: ['project', 'checklist', 'item', 'text'],
      },
    },
    {
      name: 'move_checklist_item',
      description:
        'Put one item somewhere else in the order. The order of a hand-written list is a person’s judgement about '
        + 'what comes first, so move something because the work has an order, not to tidy. Positions count from 1, as '
        + 'the checklists tool prints them; a number past the end means the end.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id' },
          item: { type: 'string', description: 'The item id' },
          position: { type: 'integer', description: 'Where it should end up, counting from 1' },
          agent: { type: 'string' },
        },
        required: ['project', 'checklist', 'item', 'position'],
      },
    },
    {
      name: 'drop_checklist_item',
      description:
        'Take one item off a checklist for good, along with every tick made on it against every target. This is not '
        + 'the same as ticking it and it is not reversible from here — an item that was done is ticked, and an item '
        + 'that turned out not to be owed is dropped. If you are unsure which, leave it and say so.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id' },
          item: { type: 'string', description: 'The item id' },
          agent: { type: 'string' },
        },
        required: ['project', 'checklist', 'item'],
      },
    },
  ]
}

/* ------------------------------------------------------------------ *
 * The answers, in words
 * ------------------------------------------------------------------ */

/** Every checklist in one project, for an agent that was not told which one. */
function listsText(where: string): string {
  const { lists, trouble } = checklists(where)
  if (trouble) return trouble
  if (!lists.length) {
    return (
      `There are no checklists in ${where} yet. Nothing is wrong: this app ships no lists at all, and a project `
      + 'that has never had one has no .kehikot/checklist/checklists.json in it. create_checklist starts the '
      + 'first, and then add_checklist_item puts lines on it.'
    )
  }
  return [
    `Checklists in ${where}:`,
    ...lists.map(
      (list) =>
        `  ${list.id} — "${list.name}" (${list.items} item${list.items === 1 ? '' : 's'}, held against `
        + `${list.targets} target${list.targets === 1 ? '' : 's'}, started by ${list.by})`,
    ),
    '',
    'Ticks live per (checklist, target, item): ask again with a ref or an epic to see what is ticked for it.',
  ].join('\n')
}

/** One checklist, with the ticks for a target where one was named. */
function listText(id: string, target: Target | null, where: string): string {
  const { held: on, trouble } = held(id, target, where)
  if (trouble) return trouble
  if (!on) {
    return (
      `There is no checklist "${id}" in ${where}. Checklists are addressed by the id the checklists tool prints `
      + 'beside each name, and they belong to one project — a list made in another project is not here. Call '
      + 'checklists with just the project to see what exists.'
    )
  }
  const head = target
    ? `"${on.checklist.name}" (${on.checklist.id}) held against ${targetName(target)} — ${on.done}/${on.total} ticked`
    : `"${on.checklist.name}" (${on.checklist.id}) — ${on.total} item${on.total === 1 ? '' : 's'}, no target named, so nothing below is ticked or unticked`
  if (!on.rows.length) {
    return `${head}\nThis list has no items yet. add_checklist_item puts the first line on it.`
  }
  const lines = on.rows.map((row, at) => {
    const done = row.done
    const who = done ? `  (${done.by}${done.viaMcp ? ', over MCP' : ''}${done.note ? `: ${done.note}` : ''})` : ''
    return `${at + 1}. [${done ? 'x' : ' '}] ${row.item.id} — ${row.item.text}${who}`
  })
  const others = targetsOf(id, where).filter((row) => !target || targetKey(row.target) !== targetKey(target))
  const tail = others.length
    ? `\n\nAlso held against: ${others.map((row) => `${targetName(row.target)} (${row.done} ticked)`).join(', ')}`
    : ''
  return `${head}\n${lines.join('\n')}${tail}`
}

/**
 * Every write, bounded and then handed to the one function that decides.
 *
 * The bounds are here and the rules are in `list/checklists.ts`: a string has a
 * length before it has a meaning, and the question of whether an item exists
 * belongs where the items are. The refusal sentence always comes from the store,
 * so the page and this door cannot end up telling somebody two different things
 * about the same press.
 */
function call(name: string, args: Record<string, unknown>, where: string): string {
  const by = str(args.agent, MAX_FROM) || AGENT

  if (name === 'create_checklist') {
    const listName = str(args.name, MAX_NAME)
    if (!listName) {
      throw new Error(
        'create_checklist needs a name saying what the list is for. Nothing here ships a list, so the name is the '
        + 'only thing that tells the next person what this one is.',
      )
    }
    const out = change({ op: 'create', name: listName, by, viaMcp: true }, where)
    if (!out.ok) throw new Error(out.error)
    return `${out.said}.\n\n${listText(out.id, null, where)}`
  }

  const id = str(args.checklist, MAX_ID)
  if (!id) {
    throw new Error(
      `${name} needs the id of the checklist, which the checklists tool prints beside each name. It is not the name `
      + '— a name can be changed and an id cannot.',
    )
  }
  const item = str(args.item, MAX_ID)
  if (name !== 'add_checklist_item' && !item) {
    throw new Error(
      `${name} needs the id of the item, which the checklists tool prints beside each line. It is not the line's `
      + 'words and it is not its position — both of those move, and an id does not.',
    )
  }

  let op: Op
  let target: Target | null = null

  if (name === 'add_checklist_item') {
    const text = str(args.text, MAX_TEXT)
    if (!text) throw new Error('add_checklist_item needs text: the line to add, saying what is owed.')
    op = { op: 'add', id, text, by, viaMcp: true }
  } else if (name === 'reword_checklist_item') {
    const text = str(args.text, MAX_TEXT)
    if (!text) {
      throw new Error(
        'reword_checklist_item needs text: the new wording. To take an item off the list, use drop_checklist_item.',
      )
    }
    op = { op: 'reword', id, item, text, by, viaMcp: true }
  } else if (name === 'move_checklist_item') {
    /* A position that is not a number is refused rather than defaulted. The
       store clamps a number that is out of range, because "past the end" is a
       clear intention; there is no clear intention behind `position: "up"`, and
       reading it as 1 would silently move the item to the top of somebody's
       list. */
    const raw = args.position
    const position = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    if (!Number.isFinite(position)) {
      throw new Error(
        'move_checklist_item needs position: a whole number saying where the item should end up, counting from 1 as '
        + 'the checklists tool prints them. Nothing was moved.',
      )
    }
    op = { op: 'move', id, item, to: Math.trunc(position) - 1, by, viaMcp: true }
  } else if (name === 'drop_checklist_item') {
    op = { op: 'drop', id, item, by, viaMcp: true }
  } else {
    /* check_item, and the one operation that involves a target at all. */
    target = readTarget(args)
    if (!target) {
      throw new Error(
        'check_item needs to say WHAT is being ticked off: a ref (an issue, merge request or pull request, e.g. '
        + '"gh#105") or an epic whose paper this is, optionally with a section of it. A tick belongs to the '
        + 'checklist, the item and the target together — the same list held against two pieces of work keeps two '
        + 'separate sets of ticks — so there is nothing to record without one. Names may not be empty, longer than '
        + `${MAX_TARGET_PART} characters, or contain a space or a slash.`,
      )
    }
    op = {
      op: 'tick',
      id,
      item,
      target,
      done: args.done !== false,
      by,
      viaMcp: true,
      note: str(args.note, MAX_NOTE) || undefined,
    }
  }

  const out = change(op, where)
  if (!out.ok) throw new Error(out.error)
  return `${out.said}.\n\n${listText(id, target, where)}`
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
        'Checklists somebody wrote, and what has been ticked off against one issue, merge request, pull request or '
        + 'paper. Nothing here ships a list and nothing is computed: every item is a line a person or an agent typed, '
        + 'and every tick belongs to a checklist, an item and a target together.',
    })
  }
  /* A notification carries no id and is answered with nothing. */
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })

  if (rpc.method === 'tools/call') {
    const name = String(rpc.params?.name ?? '')
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>

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
     * `announce` cannot throw and must not: the work may already be done by the
     * time anything below runs, and an exception here would turn a recorded tick
     * into a transport error the agent retries.
     *
     * The epic is the one the CALL named, where it named one.
     * `roadmap.notifications@1` files every line under an epic, and a call about
     * a paper knows which one — a better answer than the canvas's, because an
     * agent working one paper while somebody reads another would otherwise file
     * a true sentence under the wrong heading. A call about a ref names no epic
     * and falls back to the canvas's in `src/wire/emit.ts`.
     */
    const named = readTarget(args)
    const ref = named?.kind === 'ref' ? named.ref : ''
    announce({
      tool: name,
      refs: ref ? [ref] : [],
      epic: named?.kind === 'paper' ? named.epic : null,
      message: named
        ? `an agent called ${name.slice(0, 60)} on a checklist for ${targetName(named)}`
        : `an agent called ${name.slice(0, 60)} on a checklist`,
      /* `info`. A tool call is a thing that happened and not a thing that needs
         anybody. `attention` on every one of them would be a panel where the
         loud level means nothing. */
      level: 'info',
    })

    try {
      /* Every tool here reads or writes a store that lives inside a project, so
         the project is checked once, above the dispatch, rather than seven times
         inside it. Refused rather than defaulted — see `project()` above for why
         every available default is wrong. */
      const where = project(args.project)
      if (!where) return text(NO_PROJECT, true)

      if (name === 'checklists') {
        const id = str(args.checklist, MAX_ID)
        if (!id) return text(listsText(where))
        /* A target is optional here and refused only when it was GIVEN and is
           not a name. Asking about a list with no target is a perfectly good
           question — "what does this list say" — and answering it with a
           complaint about a ref nobody sent would be a refusal of the wrong
           thing. */
        const gave = args.ref !== undefined || args.epic !== undefined
        const target = gave ? readTarget(args) : null
        if (gave && !target) {
          return text(
            'checklists was given something that is not a target. It takes a ref like "gh#105" or "!44", or an epic '
            + `slug with an optional section — no spaces, no slashes, no more than ${MAX_TARGET_PART} characters — or `
            + 'nothing at all, in which case it answers with the list and no ticks.',
            true,
          )
        }
        return text(listText(id, target, where))
      }
      if (
        name === 'create_checklist'
        || name === 'add_checklist_item'
        || name === 'check_item'
        || name === 'reword_checklist_item'
        || name === 'move_checklist_item'
        || name === 'drop_checklist_item'
      ) {
        return text(call(name, args, where))
      }
    } catch (e) {
      /* A refusal is an answer, and the sentence is the useful half — every one
         of them names what to do instead. So it comes back as a tool error the
         agent reads, not as a transport failure it retries. */
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
  /*
   * The health check, which no longer counts anything.
   *
   * It used to answer with how many checklists were in the store, because there
   * was one store and this process owned it. There is no such store now: the
   * lists live in whichever project somebody is looking at, and a number here
   * would have to be a number for SOME project — a project this door was not
   * told about and would have to pick. A health check that picked one would be
   * reporting on a folder nobody asked about, and would report `ok: false` for a
   * project that simply has no checklists yet.
   *
   * So it answers about the PROGRAM, which is the only thing it can vouch for:
   * this app is running, here is its id and its version. Whether a particular
   * project's file is readable is a question `/api/checklists?project=…` answers
   * honestly, with the path in the sentence.
   */
  if (path === '/healthz') {
    return ok({ ok: true, id: ID, version: VERSION })
  }

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc)
  }

  /* Every checklist that exists — which is what the pick-or-create screen is
     drawn from, and the first thing the page asks for. */
  if (path === '/api/checklists' && method === 'GET') {
    const { lists, trouble, nowhere } = checklists(project(query.get('project')))
    /* `nowhere` travels beside the lists rather than as a refusal, because it is
       not one: the page draws its own screen for it, and a 400 here would make
       an ordinary state — no project open — look like the page had asked
       something wrong. */
    return ok({ ok: true, lists, trouble, nowhere })
  }

  /*
   * One checklist, held against one target.
   *
   * The target rides in the query rather than the path because it has two or
   * three parts and a path would have to encode them into one — which is exactly
   * the ambiguity `list/targets.ts` builds its key to avoid. Reads are ungated
   * like every other read here; a checklist is not a secret.
   */
  if (path === '/api/checklist' && method === 'GET') {
    const id = str(query.get('id'), MAX_ID)
    if (!id) return bad('that did not say which checklist. Ask /api/checklists for the ids.')
    const gave = query.has('ref') || query.has('epic')
    const target = gave
      ? readTarget({ ref: query.get('ref'), epic: query.get('epic'), section: query.get('section') })
      : null
    if (gave && !target) {
      return bad(
        'that is not a target. A checklist is held against an issue, a merge request, a pull request, or the paper '
        + `an epic is aimed at: names may not be empty, longer than ${MAX_TARGET_PART} characters, or contain a space `
        + 'or a slash.',
      )
    }
    const where = project(query.get('project'))
    const { held: on, trouble, nowhere } = held(id, target, where)
    if (!on) {
      return ok({
        ok: false,
        nowhere,
        error:
          trouble
          ?? (nowhere
            ? 'no project is open, so there is nowhere to read a checklist from.'
            : `there is no checklist "${id}" in this project.`),
      })
    }
    return ok({ ok: true, held: on, targets: targetsOf(id, where), trouble, nowhere })
  }

  /*
   * What has come through the MCP door since the page last looked.
   *
   * Read-only and ungated, like every other read here: it says which of this
   * app's own tools an agent called, which is less than `/api/checklists`
   * already gives away. See `list/outbox.ts` for why this exists at all — the
   * half of this app that knows a tool was called has no wire, and the half with
   * a wire does not know.
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

    if (path === '/api/checklist') {
      /* The project comes off the body on a write and off the query on a read,
         which is the ordinary split rather than a special case: a POST already
         carries a document, and putting one field of it in the URL would make
         the same fact arrive two ways. Refused here rather than deep inside the
         store, so that "which project" is answered before "what edit". */
      const where = project(body.project)
      if (!where) return bad(NO_PROJECT)
      const op = str(body.op, 16)
      const id = str(body.id, MAX_ID)
      const item = str(body.item, MAX_ID)
      const text = str(body.text, MAX_TEXT)
      const by = OWNER

      if (op === 'create') return ok(change({ op: 'create', name: str(body.name, MAX_NAME), by }, where))
      if (!id) return bad('that edit did not say which checklist it was about.')
      if (op === 'rename') return ok(change({ op: 'rename', id, name: str(body.name, MAX_NAME), by }, where))
      if (op === 'forget') return ok(change({ op: 'forget', id, by }, where))
      if (op === 'add') return ok(change({ op: 'add', id, text, by }, where))
      if (op === 'reword') return ok(change({ op: 'reword', id, item, text, by }, where))
      if (op === 'drop') return ok(change({ op: 'drop', id, item, by }, where))
      if (op === 'move') {
        const to = typeof body.to === 'number' && Number.isFinite(body.to) ? body.to : null
        if (to === null) return bad('a move needs a position to move to, and nothing was moved.')
        return ok(change({ op: 'move', id, item, to, by }, where))
      }
      if (op === 'tick') {
        const target = readTarget(body)
        if (!target) {
          return bad(
            'that tick did not say what it was against. A tick belongs to a checklist, an item and a target '
            + 'together — the same list held against two pieces of work keeps two separate sets of ticks.',
          )
        }
        return ok(
          change(
            {
              op: 'tick',
              id,
              item,
              target,
              done: body.done !== false,
              by,
              note: str(body.note, MAX_NOTE) || undefined,
            },
            where,
          ),
        )
      }
      /* Named rather than shrugged at, because the page and this store are one
         program: an op this door does not know is this app's own bug and the
         next person to read a log is the one who has to find it. */
      return bad(
        `there is no "${op}" to do to a checklist — it is create, rename, forget, add, reword, move, drop or tick.`,
      )
    }
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

export { MANIFEST }

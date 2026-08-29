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
import {
  MAX_ID,
  MAX_NOTE as MAX_PAPER_NOTE,
  MAX_TEXT,
  epicKey,
  paper,
  papersWritten,
  setPaper,
  type PaperOp,
} from './list/papers.ts'
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
/**
 * How long an epic slug may be before this app stops reading it.
 *
 * The protocol's own `LIMITS.EPIC_SLUG`, written here as a number rather than
 * imported, for the same reason `MAX_REFS_PER_ASK` is: a bound that tracked
 * another program's constant would move the day that constant moved, silently,
 * in a file whose whole job is to be the fence. `list/papers.ts` keeps its own
 * copy of the same number and refuses on it too — two fences, because this one
 * guards the door and that one guards the file.
 */
const MAX_EPIC_ARG = 80

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

    /*
     * The paper half, and it is a different KIND of list rather than more of
     * the same one.
     *
     * `mr_checklist` and `check_mr` are about a change, and every item on them
     * either computes from a tracker or is one of a fixed set somebody argued
     * over. These five are about a PAPER — the document an epic is aimed at —
     * and every item on them was typed by a person, because what a paper is
     * missing is not a property of a merge request and no program here can work
     * it out. So an agent may add to this list, reword it, reorder it and take
     * things off it, none of which it may do to the derived one; and it may
     * tick, which the derived list's owner item refuses it, for the reason set
     * out in `list/papers.ts`.
     *
     * Everything is keyed by the epic's slug. There is no ref anywhere in this
     * family, deliberately: a paper outlives every change made to it.
     */
    {
      name: 'paper_checklist',
      description:
        'The hand-written checklist for the paper an epic is aimed at: what a person has said is still owed by the '
        + 'document, in the order they put it in, with what has been ticked and by whom. None of it is derived — no '
        + 'tracker has an opinion about what a paper is missing — so this is the only place it is written down. Read '
        + 'it before working on a paper, and again before saying you are done. Omit the epic to see which papers have '
        + 'a list at all.',
      inputSchema: {
        type: 'object',
        properties: {
          epic: {
            type: 'string',
            description: 'The epic slug, as list_epics spells it. Omit to see every paper that has a list.',
          },
        },
      },
    },
    {
      name: 'add_paper_item',
      description:
        'Add one line to a paper checklist. It goes on the end, which is where a new thing belongs until somebody '
        + 'says otherwise — move_paper_item is how it gets somewhere else. Write what is owed, in a line somebody '
        + 'else could act on. The id it comes back with is how you address it afterwards; the words and the position '
        + 'both move.',
      inputSchema: {
        type: 'object',
        properties: {
          epic: { type: 'string', description: 'The epic slug, as list_epics spells it' },
          text: { type: 'string', description: `What is owed. Up to ${MAX_TEXT} characters.` },
          agent: { type: 'string', description: 'Your own name, so the list says who wrote the line' },
        },
        required: ['epic', 'text'],
      },
    },
    {
      name: 'check_paper_item',
      description:
        'Tick one item on a paper checklist, or take a tick back with done: false. You MAY tick these — unlike the '
        + "owner's item on a change, which is refused to you and always will be. A paper item is a task somebody "
        + 'wrote down, and you are often the one who did it. The record says it was you and that it came through '
        + 'this door, and the person can take it back with one press, so tick what you have actually done and leave '
        + 'what you cannot judge.',
      inputSchema: {
        type: 'object',
        properties: {
          epic: { type: 'string', description: 'The epic slug' },
          id: { type: 'string', description: 'The item id, as paper_checklist prints it beside the line' },
          note: { type: 'string', description: 'How you know — what you changed, where it is' },
          done: { type: 'boolean', description: 'Defaults to true' },
          agent: { type: 'string' },
        },
        required: ['epic', 'id'],
      },
    },
    {
      name: 'reword_paper_item',
      description:
        'Change what one item on a paper checklist says, keeping its id, its position and its tick. For sharpening a '
        + 'line somebody wrote in a hurry. To say a different thing, add a different item.',
      inputSchema: {
        type: 'object',
        properties: {
          epic: { type: 'string', description: 'The epic slug' },
          id: { type: 'string', description: 'The item id, as paper_checklist prints it' },
          text: { type: 'string', description: `The new wording. Up to ${MAX_TEXT} characters.` },
          agent: { type: 'string' },
        },
        required: ['epic', 'id', 'text'],
      },
    },
    {
      name: 'move_paper_item',
      description:
        'Put one item somewhere else in the order. The order of a hand-written list is a person’s judgement about '
        + 'what comes first, so move something because the work has an order, not to tidy. Positions count from 1, as '
        + 'paper_checklist prints them; a number past the end means the end.',
      inputSchema: {
        type: 'object',
        properties: {
          epic: { type: 'string', description: 'The epic slug' },
          id: { type: 'string', description: 'The item id, as paper_checklist prints it' },
          position: { type: 'integer', description: 'Where it should end up, counting from 1' },
          agent: { type: 'string' },
        },
        required: ['epic', 'id', 'position'],
      },
    },
    {
      name: 'drop_paper_item',
      description:
        'Take one item off a paper checklist for good, along with any tick on it. This is not the same as ticking it '
        + 'and it is not reversible from here — an item that was done is ticked, and an item that turned out not to '
        + 'be owed is dropped. If you are unsure which, leave it and say so.',
      inputSchema: {
        type: 'object',
        properties: {
          epic: { type: 'string', description: 'The epic slug' },
          id: { type: 'string', description: 'The item id, as paper_checklist prints it' },
          agent: { type: 'string' },
        },
        required: ['epic', 'id'],
      },
    },
  ]
}

/* ------------------------------------------------------------------ *
 * The paper half, in words
 * ------------------------------------------------------------------ */

/** One paper's list, in the marks the change tools already use. */
function paperText(epic: string): string {
  const p = paper(epic)
  if (p.trouble) return `${epic}: ${p.trouble}`
  if (!p.items.length) {
    return (
      `${epic} has no hand-written checklist yet. Nothing is wrong — this list is only ever what somebody typed, `
      + 'so an empty one means nobody has written anything down about this paper. add_paper_item starts it.'
    )
  }
  const lines = p.items.map((item, at) => {
    const mark = item.done ? 'x' : ' '
    const who = item.done
      ? `  (${item.done.by}${item.done.viaMcp ? ', over MCP' : ''}${item.done.note ? `: ${item.done.note}` : ''})`
      : ''
    return `${at + 1}. [${mark}] ${item.id} — ${item.text}${who}`
  })
  return `${epic} — hand-written, ${p.done}/${p.total} ticked\n${lines.join('\n')}`
}

/** Which papers have a list at all, for an agent that was not told which epic. */
function paperWrittenText(): string {
  const written = papersWritten()
  if (!written.length) {
    return (
      'No paper has a hand-written checklist yet. These lists are keyed by the epic a paper is aimed at, and every '
      + 'line on one was typed by a person — so there being none means nobody has written anything down, not that '
      + 'this app failed to look. add_paper_item with an epic slug starts one.'
    )
  }
  return [
    'Papers with a hand-written checklist:',
    ...written.map((w) => `  ${w.epic} — ${w.done}/${w.total} ticked`),
  ].join('\n')
}

/**
 * Every paper write, bounded and then handed to the one function that decides.
 *
 * The bounds are here and the rules are in `list/papers.ts`, which is the same
 * split `check_mr` uses: a string has a length before it has a meaning, and the
 * question of whether an item exists belongs where the items are. The refusal
 * sentence always comes from the store, so the page and this door cannot end up
 * telling somebody two different things about the same press.
 */
function paperCall(name: string, args: Record<string, unknown>): string {
  const epic = epicKey(str(args.epic, MAX_EPIC_ARG))
  if (!epic) {
    throw new Error(
      `${name} needs the slug of the epic whose paper this is — the one list_epics prints. It cannot be empty, `
      + `longer than ${MAX_EPIC_ARG} characters, or contain a space or a slash.`,
    )
  }
  const by = str(args.agent, MAX_FROM) || AGENT
  const id = str(args.id, MAX_ID)
  if (name !== 'add_paper_item' && !id) {
    throw new Error(
      `${name} needs the id of the item, which paper_checklist prints beside each line. It is not the line's words `
      + 'and it is not its position — both of those move, and an id does not.',
    )
  }

  let op: PaperOp
  if (name === 'add_paper_item') {
    const text = str(args.text, MAX_TEXT)
    if (!text) throw new Error('add_paper_item needs text: the line to add, saying what the paper still owes.')
    op = { op: 'add', epic, text, by, viaMcp: true }
  } else if (name === 'reword_paper_item') {
    const text = str(args.text, MAX_TEXT)
    if (!text) {
      throw new Error(
        'reword_paper_item needs text: the new wording. To take an item off the list, use drop_paper_item.',
      )
    }
    op = { op: 'reword', epic, id, text, by, viaMcp: true }
  } else if (name === 'check_paper_item') {
    op = {
      op: 'tick',
      epic,
      id,
      done: args.done !== false,
      by,
      viaMcp: true,
      note: str(args.note, MAX_PAPER_NOTE) || undefined,
    }
  } else if (name === 'move_paper_item') {
    /* A position that is not a number is refused rather than defaulted. The
       store clamps a number that is out of range, because "past the end" is a
       clear intention; there is no clear intention behind `position: "up"`, and
       reading it as 1 would silently move the item to the top of somebody's
       list. */
    const raw = args.position
    const position = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    if (!Number.isFinite(position)) {
      throw new Error(
        'move_paper_item needs position: a whole number saying where the item should end up, counting from 1 as '
        + 'paper_checklist prints them. Nothing was moved.',
      )
    }
    op = { op: 'move', epic, id, to: Math.trunc(position) - 1, by, viaMcp: true }
  } else {
    op = { op: 'drop', epic, id, by, viaMcp: true }
  }

  const out = setPaper(op)
  if (!out.ok) throw new Error(`${epic}: ${out.error}`)
  return `${out.said}.\n\n${paperText(epic)}`
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
    /*
     * Which paper the call was about, where the call named one.
     *
     * The change tools carry a ref and no epic; the paper tools carry an epic
     * and no ref. `roadmap.notifications@1` files every line under an epic, and
     * until now the only epic this app could offer was the CANVAS's — read by
     * the page at the moment it emits, which is the nearest honest answer when
     * the door itself has none. A paper tool does have one, and it is a better
     * answer than the canvas's: an agent working a paper list over MCP is very
     * often doing it while somebody's canvas sits on another epic entirely, and
     * filing that work under whatever they happened to be looking at would put
     * a true sentence under the wrong heading.
     */
    const said = epicKey(str((rpc.params?.arguments ?? {}).epic, MAX_EPIC_ARG))

    announce({
      tool: name,
      refs: [str((rpc.params?.arguments ?? {}).ref, MAX_REF)].filter(Boolean),
      epic: said,
      message: said
        ? `an agent called ${name.slice(0, 60)} on ${said}'s paper checklist`
        : `an agent called ${name.slice(0, 60)} on the checklist`,
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
      epic?: unknown
      id?: unknown
      text?: unknown
      position?: unknown
    }
    try {
      if (name === 'mr_checklist') {
        const ref = str(args.ref, MAX_REF)
        return text(ref ? standingText(ref) : bareList())
      }
      if (name === 'paper_checklist') {
        /* An epic that is not a name at all is told so rather than falling back
           to the whole listing: a caller that meant to ask about one paper and
           got a directory would read it as "there is nothing on mine". */
        if (args.epic !== undefined && args.epic !== null && args.epic !== '') {
          const epic = epicKey(str(args.epic, MAX_EPIC_ARG))
          if (!epic) {
            return text(
              'paper_checklist was given something that is not an epic slug. It takes the name list_epics prints — '
              + `no spaces, no slashes, no more than ${MAX_EPIC_ARG} characters — or nothing at all, which lists `
              + 'every paper that has a checklist.',
              true,
            )
          }
          return text(paperText(epic))
        }
        return text(paperWrittenText())
      }
      if (
        name === 'add_paper_item'
        || name === 'check_paper_item'
        || name === 'reword_paper_item'
        || name === 'move_paper_item'
        || name === 'drop_paper_item'
      ) {
        return text(paperCall(name, args))
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

  /*
   * The hand-written list for one paper, and which papers have one.
   *
   * Two doors rather than one with a nullable argument, because the two answer
   * different questions and the page asks them at different moments: with an
   * epic open it wants that paper's list, and with no epic open it wants to know
   * whether there is anything written down anywhere — which is what the no-paper
   * screen offers instead of an empty box. Reads are ungated like every other
   * read here; a checklist is not a secret.
   */
  if (path === '/api/paper' && method === 'GET') {
    const epic = epicKey(query.get('epic'))
    if (!epic) {
      return bad(
        'a hand-written checklist is kept against the paper an epic is aimed at, so this needs an epic slug: no '
        + `spaces, no slashes, no more than ${MAX_EPIC_ARG} characters.`,
      )
    }
    return ok({ ok: true, paper: paper(epic) })
  }

  if (path === '/api/papers' && method === 'GET') return ok({ ok: true, written: papersWritten() })

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

    /*
     * The owner editing their own paper list, which is every operation on it
     * rather than a tick alone.
     *
     * The mirror of `/api/lists`: one door, one `op`, and the deciding is in
     * `setPaper` so that the page and the MCP door cannot apply two different
     * rules to the same list. What differs from the derived side is who may do
     * what, and here the answer is "the owner may do all of it" — this is their
     * list, and there is no derived half of it for a press to hand-wave.
     */
    if (path === '/api/paper') {
      const epic = epicKey(body.epic)
      if (!epic) {
        return bad(
          'that edit did not say which paper it was about. A hand-written checklist is kept against the epic a paper '
          + 'is aimed at.',
        )
      }
      const op = str(body.op, 16)
      const id = str(body.id, MAX_ID)
      const text = str(body.text, MAX_TEXT)
      const by = OWNER
      if (op === 'add') return ok(setPaper({ op: 'add', epic, text, by }))
      if (op === 'reword') return ok(setPaper({ op: 'reword', epic, id, text, by }))
      if (op === 'tick') {
        return ok(setPaper({ op: 'tick', epic, id, done: body.done !== false, by, note: str(body.note, MAX_PAPER_NOTE) || undefined }))
      }
      if (op === 'move') {
        const to = typeof body.to === 'number' && Number.isFinite(body.to) ? body.to : null
        if (to === null) return bad('a move needs a position to move to, and nothing was moved.')
        return ok(setPaper({ op: 'move', epic, id, to, by }))
      }
      if (op === 'drop') return ok(setPaper({ op: 'drop', epic, id, by }))
      /* Named rather than shrugged at, because the page and this list are one
         program: an op this door does not know is this app's own bug and the
         next person to read a log is the one who has to find it. */
      return bad(`there is no "${op}" to do to a paper checklist — it is add, reword, tick, move or drop.`)
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

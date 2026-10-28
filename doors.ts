import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { MODULE_ID } from 'kehikot-module-protocol'
import { establishBuild, mintTicket, refuseTicket, registryDir, type Reply } from 'kehikot-module-protocol/serve'

import { ID, MANIFEST, VERSION } from './manifest.ts'
import { resolveProject } from './project.ts'
import {
  MAX_ID,
  MAX_NAME,
  MAX_NOTE,
  MAX_TEXT,
  change,
  checklists,
  held,
  holds,
  inFront,
  targetsOf,
  type ItemInFront,
  type Op,
} from './list/checklists.ts'
import { moduleNamed } from './list/aim.ts'
import {
  angleLine,
  angleOf,
  ITEM_TYPES,
  NO_TASKS,
  TASKS_KNOWN,
  nothingLine,
  ROLES,
  rolesFromMine,
  rolesPhrase,
  typeName,
  undecidedLine,
  type Angle,
  type ItemType,
  type RefsRead,
  type Role,
} from './list/standing.ts'
import { stateOf, TICK_STATES, type TickState } from './list/shapes.ts'
import { evidenceSchema, FACT_NAMES, FACTS, type Fact } from './list/evidence.ts'
import { announce, since } from './list/outbox.ts'
import { discard, preview, purge, restore, SCOPES, usage, usageText, type Finished, type Rule } from './list/storage.ts'
import { fileOfSection, ladderKey, rungsOf, scopeOf, targetOf } from './list/scope.ts'
import { MAX_TARGET_PART, part, readTarget, ruleRefusal, targetKey, targetName, type Target } from './list/targets.ts'
import { filesNamed, placeIn, placeNamed, placeOf } from './file/open.ts'
import { outlineOf } from './file/outline.ts'
import { MAX_RUN_REFS, runsFor, setHidden, type RunItem } from './list/runs.ts'
import { FROM_A_RUN, RUN_STATE_WORDS, runItemText } from './list/run-words.ts'

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
/** How many places one reading-page request may name. The protocol's own bound on what a container shows, plus the reader's passage. */
const MAX_DOCS = 17

/** How many different files' lists one whole-paper answer names the place of. */
const MAX_HELD_FILES = 128
/** How many held targets the `checklists` tool names for one list before it counts the rest. */
const NAMED_TARGETS = 50
/** How many held targets the edit page is sent as chips before it is sent a count. */
const SHOWN_TARGETS = 300
/** How many finished refs the page may hand over with one Storage request: several tracker readings' worth. */
const MAX_FINISHED = 20_000

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
 * This app's store moved into the project: `<projectPath>/.kehikot/checklist/` (`lists.json` and `targets/`, see `list/book.ts`).
 * So "which checklists" is not answerable without "whose", and the string that
 * answers it arrives on the request. The page reads it from
 * `kehikot.context.projectPath` and passes it on; an agent over MCP says it in
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
export const TICKET = mintTicket()

/**
 * What this process is built from: this module's version, the checkout's commit, and when the
 * process started. `doors()` says it in the manifest, at `/healthz`, in the page and on every
 * answer, which is how a page notices that the server answering it is not the one that served it.
 */
export const BUILD = establishBuild({ version: VERSION, dir: import.meta.dirname })

/** The word a change is filed under when the page made it. */
const OWNER = 'the owner, on this app’s own page'

/** What an agent is called when it does not say. */
const AGENT = process.env.CHECKLIST_AGENT ?? process.env.KEHIKOT_AGENT ?? 'an agent'

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

/**
 * How a reading tool says which angle an item is read from: one role, or the
 * person's own roles as the host reads them, or neither — then any role. This
 * door reads no tracker, so it cannot know a person's roles itself.
 */
const ANGLE_PROPERTIES = {
  role: {
    type: 'string',
    enum: ['assignee', 'reviewer', 'author', 'any'],
    description:
      'The angle: read the item as its assignee, reviewer or author, or "any" role. Defaults to the person\'s own '
      + 'roles from my_roles, and to any role when neither is given.',
  },
  my_roles: {
    type: 'array',
    items: { type: 'string' },
    description:
      'The person\'s roles on the item as the host\'s tracker reading says them (kehikko\'s read_tracker prints '
      + '"my roles:"): reviewer-asked, reviewer-done, author, assignee. Used when role is not given.',
  },
  type: {
    type: 'string',
    enum: ['issue', 'mr', 'pr'],
    description:
      'What kind of item the ref is, when its spelling does not say: gh#41 is an issue or a pull request, and '
      + 'this door reads no tracker. !7 is a merge request and #12 a GitLab issue by their spelling.',
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
    description:
      'The epic whose paper this list is being held against, as list_epics spells it. Give this OR a ref. With '
      + 'kehikko and module, the epic whose run of that container is being ticked or read instead. With types, '
      + 'the epic whose refs the list applies to, instead of the whole project\'s.',
  },
  /*
   * Types of item × roles, of the project or of one epic: a rule, held once
   * and in front of every such item. See the fourth kind in `list/targets.ts`
   * and `list/standing.ts`.
   */
  types: {
    type: 'array',
    items: { type: 'string', enum: [...ITEM_TYPES] },
    description:
      'hold_checklist only, instead of a ref, a paper or a container: the TYPES of item the list applies to, '
      + 'across the project — "issue", "mr" (merge request), "pr" (pull request), "paper", "task" (a GitLab task, '
      + 'which is not an issue here). With roles, and with epic to narrow it to the refs that epic names. The list is '
      + 'then in front of a person on any such item, including ones opened later, read from that role. Which type a '
      + 'ref is, is the host\'s tracker reading\'s to say.'
      + `${TASKS_KNOWN ? '' : ` "task" is not available yet: ${NO_TASKS}`} Ticks stay per item: to tick one, give its ref.`,
  },
  roles: {
    type: 'array',
    items: { type: 'string', enum: [...ROLES] },
    description:
      'hold_checklist only, with types: the roles the list is for — "assignee", "reviewer", "author", or "any" '
      + '(every role, the default). A role is the person\'s angle on an item, not a fact about it.',
  },
  every: {
    type: 'string',
    enum: ['issue', 'change'],
    description:
      'The older spelling of types: "issue" is types ["issue"], "change" is types ["mr", "pr"], for any role.',
  },
  /*
   * A module's container on one kehikko, whichever epic is open
   * (Jalez/kehikko-checklist#27): the target for a list about how a module's
   * work is run in every epic. See the third kind in `list/targets.ts`.
   */
  kehikko: {
    type: 'string',
    description:
      'With module, instead of a ref or a paper: the key of one kehikko (context.kehikko.key — the canvas\'s '
      + 'identity, not its name or number), to hold the list against that module\'s container there whichever '
      + 'epic is open. It is then in front of a person on that kehikko whenever the container is, for every epic. '
      + 'Ticks are per epic: to tick or read one epic\'s run, give that epic too.',
  },
  module: {
    type: 'string',
    description:
      'With kehikko: the module whose container it is, by the id the host spells, e.g. "kehikot.flows" — its '
      + 'short name, "flows", is read as that id when one module here has it.',
  },
  section: {
    type: 'string',
    description:
      'Optional, and only with an epic: a file of the paper or one heading in it, by the id this app prints for '
      + 'it. A file is its path without the extension and with ":" for "/" — "chapters:3_methods" — spelled from '
      + "the paper's own folder or from the project's. A heading is that, then \"#\", then the heading's "
      + '\\label{} — "chapters:3_methods#sec:meth-design". A bare label, a page number or the words of a heading '
      + 'is NOT one: an id that names no file or heading on disk is refused, because a list held against it '
      + 'would be shown nowhere. If you do not know the id, give path (with from and to) and this app works it '
      + 'out. Omit it to hold the list against the whole paper, which is a different target from any section in it.',
  },
  /*
   * The passage arguments, which are how an agent asks about the place a person
   * is actually standing rather than about the whole paper.
   *
   * They exist because the page grew the same ability and the two doors have to
   * be answerable in the same terms. A person moving between chapters of their
   * thesis sees the checklist follow them; an agent that could only ask about
   * the whole paper would be looking at a different list from the one on the
   * owner's screen, and would tick against a target nobody is reading.
   *
   * `path` and `section` are two spellings of one thing and `section` wins when
   * both are given, deliberately: a named section is somebody's decision and a
   * path is this program's derivation from one, and a derivation must not
   * overrule a decision. See `resolve()` below.
   */
  path: {
    type: 'string',
    description:
      'Optional, and only with an epic: the file of the paper being looked at — "chapters/3_methods.tex" as the '
      + "paper's own folder spells it, the same file from the project folder, or its absolute path. This app "
      + 'opens the file and works out which section the offsets below fall in, so you do not have to know the '
      + 'section id. A path that is not a file of this project is refused; it is never read as the whole paper. '
      + "Where the paper's folder and the project both have that relative path, the paper's is taken and the "
      + 'answer says so. Ignored if section is given.',
  },
  from: {
    type: 'number',
    description:
      'Optional, with path: the first BYTE of what is being looked at in that file. Give both from and to, or '
      + 'neither — with neither, the target is the file rather than a section in it.',
  },
  to: {
    type: 'number',
    description: 'Optional, with path and from: one byte past the last.',
  },
} as const

/**
 * The target a set of arguments names, with a passage resolved into a section
 * where one was given.
 *
 * One function for the MCP door and the page's own read door, so an agent and a
 * person cannot end up naming the same place two ways — which is the split this
 * module keeps everywhere: a door bounds, a store decides, and target identity
 * is decided once.
 *
 * A `ref` short-circuits everything below it. That is not a special case, it is
 * the whole guarantee that non-document targets are untouched by this change: an
 * issue has no file, no offsets and no sections, and nothing here so much as
 * stats a disk on the way to answering about one.
 */
function resolve(args: Record<string, unknown>, where: string | null): Target | null {
  const named = readTarget(args)
  if (!named || named.kind !== 'paper' || named.section) return named
  /* `pick` says the caller DECIDED this target rather than leaving it to be
     derived. It exists for one case that is otherwise inexpressible: a reader
     who widened to the whole paper sends `{epic, section: null}`, which looks
     exactly like a target nobody has narrowed yet, and without this the path
     below would resolve them straight back into the section they climbed out of.
     A derivation must never overrule a decision. Only the page sends it; an
     agent naming an epic and a path plainly wants the path read. */
  if (args.pick) return named
  const path = str(args.path, MAX_PROJECT)
  if (!path) return named
  const from = typeof args.from === 'number' && Number.isFinite(args.from) ? Math.trunc(args.from) : null
  const to = typeof args.to === 'number' && Number.isFinite(args.to) ? Math.trunc(args.to) : null
  /* A half-range is refused rather than half-honoured, which is the protocol's
     own rule for a passage: "a half-range is not a coarser answer, it is a
     malformed one". Answered by staying on the file rung, since that is the
     coarser answer the caller would have got by sending neither. */
  const range = from !== null && to !== null && to > from ? { from, to } : null
  const placed = placeOf(where, path, range?.from ?? null, range?.to ?? null)
  const scope = scopeOf(named.epic, placed)
  return targetOf(scope) ?? named
}

/**
 * `resolve` for the agent's door, where a target nothing can show is refused
 * rather than answered about.
 *
 * The page names a target by pressing one this app offered, and a host relays a
 * passage some module set. An agent TYPES one, and has no page on which to
 * notice that the list it held never appeared — it reads "is now held against"
 * and reports the work done. So the two ways a typed target used to go quietly
 * wrong are both answered here with a sentence instead:
 *
 * - **A `path` that is not a file.** `resolve` reads that as "no narrowing" and
 *   answers about the whole paper, which is right for a passage and wrong for a
 *   decision: seven chapters held by path became one hold on the paper and six
 *   "is already held". Here the path is looked for in the paper's own folder as
 *   well as the project's (`placeIn`), and refused when it is in neither.
 * - **A `section` that names nothing.** Any string that passed `part()` was a
 *   new target. Here it has to name a file or a heading that is on disk
 *   (`placeNamed`), and the target is the id this app mints for that place
 *   whichever folder it was spelled from.
 *
 * ## What is still nameable without being on disk
 *
 * A target this list is ALREADY held against. `list/targets.ts` says a stored
 * target is never checked, "because a target with ticks on it is a record of
 * work done and not a claim about today's document", and that holds: a heading
 * renamed since, or a hold made before this refusal existed, can still be read,
 * ticked, unticked and released by the name it was stored under. So the stored
 * names are asked FIRST, before the disk: a hold stored as `chapters:3_methods`
 * beside a file whose id is now `.kehikot:paper:<epic>:chapters:3_methods`
 * would otherwise resolve to the second and never be nameable again. What is
 * refused is minting a new one, and `minting` — a hold — is the one call that
 * asks the disk first, so that spelling held anew lands where a reader arrives.
 */
function aimed(args: Record<string, unknown>, where: string, id: string, minting: boolean): Aimed | null {
  const named = readTarget(args)
  if (!named) return null
  /* A container on a kehikko is no place in a file. Its module is read in the
     one form ids are compared in, so "flows" said by an agent is the
     `kehikot.flows` the host lists in its containers, where one module here
     is called that. */
  if (named.kind === 'kehikko') {
    return { target: { ...named, module: moduleNamed(named.module, modulesHere()) ?? named.module }, also: null }
  }
  /* Types × roles is no place in a file either, and its epic is a name, never read off disk. */
  if (named.kind === 'rule') return { target: named, also: null }
  if (named.kind === 'ref' || named.section) return settle(named, where, id, minting, 'paper')
  const path = str(args.path, MAX_PROJECT)
  if (!path) return { target: named, also: null }
  /* A half-range stays on the file rung, exactly as in `resolve`. */
  const from = typeof args.from === 'number' && Number.isFinite(args.from) ? Math.trunc(args.from) : null
  const to = typeof args.to === 'number' && Number.isFinite(args.to) ? Math.trunc(args.to) : null
  const range = from !== null && to !== null && to > from ? { from, to } : null
  const placed = placeIn(where, named.epic, path, range?.from ?? null, range?.to ?? null)
  if (!placed) {
    throw new Error(
      `"${path.slice(0, 200)}" is not a file this app can open in this project or in the folder of the paper `
      + `${named.epic} is aimed at (a ${named.epic}/ folder under .kehikot/), so nothing was held or ticked against it — a `
      + 'path that is not a file is refused rather than read as the whole paper. Give the path as either folder '
      + 'spells it, or the absolute path; or leave path out to mean the whole paper.',
    )
  }
  return {
    target: targetOf(scopeOf(named.epic, placed)) ?? named,
    also: placed.other
      ? `"${path.slice(0, 200)}" is a file both in the folder of the paper ${named.epic} is aimed at and in the `
        + `project (${placed.other}). The paper’s was taken, because that is the one the paper shows. To mean the `
        + `project’s instead, give its absolute path: "${join(where, placed.other)}".`
      : null,
  }
}

/** A target, and — where the words that named it name a second file as well — the sentence saying which was taken. */
interface Aimed {
  target: Target
  also: string | null
}

/**
 * A named target, held to the one standard both doors keep: a section either
 * is one this list is already held against, by the exact name it was stored
 * under, or names a file or a heading on disk. Throws the refusal otherwise.
 *
 * A reference and the whole paper pass untouched: neither is a place in a file.
 * `first` is `placeNamed`'s — the agent's door means the paper's folder, the
 * page presses an id this app minted from the project.
 */
function settle(named: Target, where: string, id: string, minting: boolean, first: 'paper' | 'project'): Aimed {
  if (named.kind !== 'paper' || !named.section) return { target: named, also: null }
  const stored = holds(id, named, where)
  if (stored && !minting) return { target: named, also: null }
  const found = placeNamed(where, named.epic, named.section, first)
  if (found && 'section' in found) {
    return {
      target: { kind: 'paper', epic: named.epic, section: found.section },
      also:
        found.other && first === 'paper'
          ? `"${named.section}" names a file in the folder of the paper ${named.epic} is aimed at and one in the `
            + `project (${found.other}). The paper’s was taken, as ${found.section}, because that is the one the `
            + `paper shows. To mean the project’s instead, give path: "${join(where, found.other)}".`
          : null,
    }
  }
  if (stored) return { target: named, also: null }
  if (found && 'long' in found) {
    throw new Error(
      `"${named.section}" is on disk, but the id this app mints for it is spelled from the project folder `
      + `("${found.long}") and does not fit: a target’s name is at most ${MAX_TARGET_PART} characters, with no `
      + 'space or slash. So nothing was held or ticked against it. Leave the "#" part off to mean the file, or '
      + 'leave section out to mean the whole paper.',
    )
  }
  if (found) {
    throw new Error(
      `${found.file} has no heading with the id "${named.section.slice(named.section.indexOf('#') + 1)}", so `
      + 'nothing was held or ticked against it: a list held against a heading that is not there is shown '
      + 'nowhere. '
      + (found.headings.length
        ? `Its headings are: ${found.headings.join(', ')}`
          + (found.total > found.headings.length
            ? ` — the first ${found.headings.length} of ${found.total}, the rest are not listed here`
            : '')
          + '. Give one of those as section, or leave the "#" part off to mean the whole file.'
        : 'This app found no headings in that file; leave the "#" part off to mean the whole file.'),
    )
  }
  throw new Error(
    `"${named.section}" names no file or heading of this project or of the paper ${named.epic} is aimed at, so `
    + 'nothing was held or ticked against it: a list held against a section that is not there is shown nowhere. '
    + 'A section is the id this app prints — a file is its path without the extension and with ":" for "/", '
    + 'e.g. "chapters:3_methods", and a heading is that plus "#" and its \\label{}, e.g. '
    + '"chapters:3_methods#sec:meth-design". A bare label is not one. Or give path (with from and to) instead '
    + 'and this app works the id out.',
  )
}

/** How many epics' refs one request may say it read: one per epic a standing hold names, which is a few. */
const MAX_EPICS_READ = 16

/**
 * What the page's tracker reading said about the refs in front, off the
 * query: `type` is `<ref>\t<issue|mr|pr>`, `roles` is `<ref>\t<role,role>`
 * (the person's roles there, as `rolesFromMine` reads `myRoles`; a ref with
 * no `roles` row has none known), `epic-read` an epic whose refs the page
 * read, and `in-epic` `<epic>\t<ref>` for each ref in front that epic names.
 * Bounded to the refs in front and read leniently: a row that does not parse
 * is a ref whose type or roles are not known, which the page then says.
 */
function refsRead(query: URLSearchParams, selection: readonly string[]): RefsRead {
  const front = new Set(selection)
  /* No prototype: a ref or an epic is a name somebody spelled, and `__proto__` is one. */
  const types: Record<string, ItemType> = Object.create(null)
  for (const row of query.getAll('type').slice(0, MAX_KINDS)) {
    const [ref, type] = str(row, MAX_PROJECT).split('\t')
    if (ref && front.has(ref) && (['issue', 'mr', 'pr'] as string[]).includes(type ?? '')) types[ref] = type as ItemType
  }
  const roles: Record<string, Role[]> = Object.create(null)
  for (const row of query.getAll('roles').slice(0, MAX_KINDS)) {
    const [ref, said] = str(row, MAX_PROJECT).split('\t')
    if (!ref || !front.has(ref)) continue
    roles[ref] = rolesFromMine((said ?? '').split(',').filter(Boolean)) ?? []
  }
  const epics: Record<string, string[]> = Object.create(null)
  for (const row of query.getAll('epic-read').slice(0, MAX_EPICS_READ)) {
    const epic = part(row)
    if (epic) epics[epic] = []
  }
  for (const row of query.getAll('in-epic').slice(0, MAX_KINDS * 4)) {
    const [epic, ref] = str(row, MAX_PROJECT).split('\t')
    if (epic && ref && front.has(ref) && Object.hasOwn(epics, epic) && !epics[epic]!.includes(ref)) epics[epic]!.push(ref)
  }
  return { types, roles, epics }
}

/**
 * A rule off a page's body: `{ types, roles, epic }`, bounded, or null when it
 * is not that shape. Which words are types and roles is the store's to say.
 */
function ruleBody(value: unknown): { types: string[]; roles: string[]; epic: string | null } | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as { types?: unknown; roles?: unknown; epic?: unknown }
  const list = (words: unknown) =>
    Array.isArray(words) ? words.slice(0, 8).map((word) => (typeof word === 'string' ? str(word, 16) : '')).filter(Boolean) : null
  const types = list(one.types)
  const roles = one.roles === undefined ? ['any'] : list(one.roles)
  if (!types || !roles) return null
  return { types, roles, epic: typeof one.epic === 'string' && one.epic ? str(one.epic, MAX_TARGET_PART) : null }
}

/** How many refs' kinds one request may say: as many refs as it may name. */
const MAX_KINDS = 256

/** How many module ids one request may say are here, and how many a refusal offers. */
const MAX_MODULES = 64

/**
 * The modules on this machine, by id, without this one: what an agent is
 * offered when it names a module that is not one.
 *
 * Read off the registry a host sweeps — one file per module, the file's name
 * its id — because this door has no canvas to ask. The page has one, and sends
 * the modules its host reported beside the op (`heard`); both doors add these.
 * Names only: no registration is opened.
 */
function modulesHere(): string[] {
  let names: string[]
  try {
    names = readdirSync(registryDir())
  } catch {
    return []
  }
  const ids = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((id) => MODULE_ID.test(id) && id !== ID)
  return [...new Set(ids)].sort().slice(0, MAX_MODULES)
}

/** The module ids a page said its host reported, bounded before they are looked at. */
function heard(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_MODULES).map((one) => (typeof one === 'string' ? str(one, MAX_TARGET_PART) : '')).filter(Boolean)
}

/**
 * The nine tools, which are the whole of what an agent can do here.
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
/*
 * There is deliberately no `import_checklist` tool, and the absence is a
 * decision rather than an omission.
 *
 * The store answers `{ op: 'import', from, id }`, and the argument that makes
 * that safe is not in the store: it is that `from` is a path A PERSON JUST
 * PICKED, in a dialog the host drew, out of projects this module cannot
 * enumerate. That protection lives entirely in the page's route to it.
 *
 * An agent holding this tool would supply `from` itself. It would then be a
 * tool that reads an arbitrary folder on this machine and reports whether there
 * are checklists in it — an existence oracle over the disk, reachable from a
 * loopback port, wearing the name of a copy operation. Every other tool here
 * takes `project` because the caller is already working in one; `from` is
 * different in kind, because nothing about the work says which project it is.
 *
 * If an agent should ever be able to do this, the thing to give it is not this
 * tool: it is a way for a person to hand over the second path, which is what
 * `projects.pick` already is for the page.
 */
/**
 * What each tool says it does, in MCP's own hints. Destructive is where something is removed or
 * overwritten: a tick taken back, an item's words replaced or dropped, a hold released. Adding and
 * reordering lose nothing.
 */
const ANNOTATIONS: Record<string, Record<string, boolean>> = {
  checklists: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  create_checklist: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  /* With release: true it stops holding the list against a target, so it can remove one. Every tick is kept. */
  hold_checklist: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  checklist_for: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  add_checklist_item: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  add_item_for: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  /* With done: false it takes a tick back, and the tick's record goes with it. A person's tick is refused. */
  check_item: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  reword_checklist_item: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  move_checklist_item: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  drop_checklist_item: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  storage: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

function tools() {
  return listed().map((tool) => ({ ...tool, annotations: ANNOTATIONS[tool.name] }))
}

function listed() {
  return [
    {
      name: 'checklists',
      description:
        'Every checklist this app holds, what applies to one item, or one list in full. Nothing here ships a list: '
        + 'each one was created by a person or by an agent. A list APPLIES to types of item × roles (issues as '
        + 'reviewer, merge requests for any role, papers…), across the project or one epic, and may also be held '
        + 'against particular items by hand; an item can have lines of its own on top. Give a ref (or an epic, for '
        + 'its paper) and no checklist to get every checklist that applies to that item from an angle — role, or the '
        + 'person\'s own my_roles — with what is ticked there. Give a checklist id to read that list, and a ref or an '
        + 'epic with it to see what is ticked on it FOR that item — two issues keep two separate sets. Read this '
        + 'before starting work and again before saying you are done.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id. Omit to list every checklist, or — with a ref or an epic — to read what applies to that item.' },
          ...TARGET_PROPERTIES,
          ...ANGLE_PROPERTIES,
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
      name: 'hold_checklist',
      description:
        'Say what a checklist applies to. Mostly: types and roles — types ["mr"] with roles ["reviewer"] puts it in '
        + 'front of a person on every merge request they read as reviewer, including ones opened later (types: '
        + 'issue, mr, pr, paper, task — a GitLab task; roles: assignee, reviewer, author, any; with epic, only the refs '
        + 'that epic names). '
        + 'Each item still keeps its own ticks. As an exception, hold it against one item by hand — an issue, merge '
        + 'request or pull request (ref); a paper, one of its files or one heading in it; or one module\'s container '
        + 'on one kehikko, whichever epic is open. With release: true, take a rule or a hold away; every tick made '
        + 'there is kept and comes back if it applies again. A list that applies to nothing is shown nowhere. On a '
        + 'paper, give path (and from/to) to mean the file or heading being looked at, exactly as check_item does.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id, as the checklists tool prints it' },
          ...TARGET_PROPERTIES,
          release: { type: 'boolean', description: 'true to stop holding it against this target. Defaults to false.' },
          agent: { type: 'string' },
        },
        required: ['project', 'checklist'],
      },
    },
    {
      name: 'checklist_for',
      description:
        'Two questions. (1) With a ref (or an epic, for its paper) and no module: the checklists FOR that item — every '
        + 'list whose types × roles apply to it from an angle (role, or the person\'s own my_roles; any role when '
        + 'neither is given), the lists held against it by hand, and its own lines, with what is ticked there. Read-'
        + 'only. (2) With a checklist and module: say which module’s work that checklist is for, or — with module: '
        + 'null — that it is for every module’s. Several modules can show the same place in a paper; said to be for '
        + 'one module, a list is in front of a PERSON only while that module’s container is among the ones they '
        + 'picked out, or while they have picked none. Nothing else about the list changes.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'With module: the checklist id, as the checklists tool prints it' },
          ref: TARGET_PROPERTIES.ref,
          epic: TARGET_PROPERTIES.epic,
          ...ANGLE_PROPERTIES,
          module: {
            type: ['string', 'null'],
            description:
              'The module’s id as the host spells it, e.g. "kehikot.screenplay" — its short name, "screenplay", is '
              + 'read as that id when one module here has it. Or null, to say the list is for every module’s work '
              + 'again. Leave it out to ask what applies to a ref or an epic instead.',
          },
          agent: { type: 'string' },
        },
        required: ['project'],
      },
    },
    {
      name: 'add_item_for',
      description:
        'Add a line for ONE item only — an issue, merge request or pull request (ref), or the paper an epic is '
        + 'aimed at (epic) — on top of the checklists that apply to it. It is shown under them as "Only for <ref>", '
        + 'is ticked with check_item like any line (the checklist id comes back with it), and is kept whatever '
        + 'happens to the other lists. For something every such item owes, add it to a checklist that applies to '
        + 'the type instead.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          ref: { type: 'string', description: 'The issue, merge request or pull request, e.g. "gh#105", "!44". Or give epic.' },
          epic: { type: 'string', description: 'Instead of ref: the epic whose paper the line is for.' },
          text: { type: 'string', description: `What this one item still owes. Up to ${MAX_TEXT} characters.` },
          agent: { type: 'string', description: 'Your own name, so the line says who wrote it' },
        },
        required: ['project', 'text'],
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
        'Answer one item FOR ONE TARGET: state passed (the default), failed or na (not applicable), with a note '
        + 'saying how you know; or take your answer back with done: false. This is the tool the module exists for: '
        + 'a tick belongs to the checklist, the item and the target together, so answering item 3 for gh#105 says '
        + 'nothing at all about gh#106. The record says it was you and that it came through this door. A tick a '
        + 'PERSON set on the page is theirs: you cannot change or remove it, and you are told so — say what you '
        + 'found in your own words instead. Answer what you have actually checked and leave what you cannot judge '
        + 'unchecked, saying that you did.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          checklist: { type: 'string', description: 'The checklist id' },
          item: { type: 'string', description: 'The item id, as the checklists tool prints it beside the line' },
          ...TARGET_PROPERTIES,
          state: {
            type: 'string',
            enum: [...TICK_STATES],
            description: 'passed (the default), failed, or na for not applicable. Not allowed with done: false.',
          },
          note: { type: 'string', description: 'How you know — the test name, what you changed, where it is' },
          done: { type: 'boolean', description: 'Defaults to true. false takes your answer back and has no state.' },
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
    {
      name: 'storage',
      description:
        'How much space this project’s checklists take on disk, per checklist: bytes, how many targets each is held '
        + 'against, released targets whose ticks are kept, ticks, and the last activity. Read-only. There is no '
        + 'limit on how many targets a list is held against; when the folder grows, a PERSON decides what to purge, '
        + 'on the page under View → Storage. No tool purges.',
      inputSchema: { type: 'object', properties: { ...PROJECT_PROPERTY }, required: ['project'] },
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
      + 'that has never had one has no .kehikot/checklist/lists.json in it. create_checklist starts the '
      + 'first, and then add_checklist_item puts lines on it.'
    )
  }
  const own = lists.filter((list) => list.only)
  const named = lists.filter((list) => !list.only)
  return [
    `Checklists in ${where}:`,
    ...named.map(
      (list) =>
        `  ${list.id} — "${list.name}" (${list.items} item${list.items === 1 ? '' : 's'}, started by ${list.by}; `
        + (list.for ? `for ${list.for}’s work; ` : '')
        + heldPhrase(list),
    ),
    ...(own.length
      ? [
          '',
          'Lines added for one item alone (add_item_for), each on a list of that item\'s own:',
          ...own.map((list) => `  ${list.id} — "${list.name}" (${list.items} item${list.items === 1 ? '' : 's'})`),
        ]
      : []),
    '',
    'Ticks live per (checklist, item): ask again with a ref or an epic, and no checklist, to see what applies to it '
    + 'and what is ticked there.',
  ].join('\n')
}

/**
 * What one list is held against, for the listing: its standing holds by name
 * (`every issue`), then its targets by name or, past a few, by count.
 */
function heldPhrase(list: { held: Target[]; targets: number; applies?: Target[] }): string {
  const standing = (list.applies ?? []).map(targetName)
  const named = list.held.length
    ? list.held.map(targetName)
    : list.targets
      ? [`${list.targets} target${list.targets === 1 ? '' : 's'} — ask with its id to see them`]
      : []
  if (!standing.length && !named.length) {
    return 'applies to nothing yet, so shown nowhere — hold_checklist with types and roles puts it in front of somebody)'
  }
  return `${standing.length ? `applies to ${standing.join('; ')}` : ''}${standing.length && named.length ? '; ' : ''}${named.length ? `only for ${named.join(', ')}` : ''})`
}

/** What each state looks like in the listing: x passed, ! failed, - not applicable, a space unchecked. */
const MARKS: Record<TickState | 'unchecked', string> = { passed: 'x', failed: '!', na: '-', unchecked: ' ' }

/** `passed N · failed N · n/a N · unchecked N`, the same words every time so a caller can read it. */
function countsLine(counts: { passed: number; failed: number; na: number; unchecked: number }): string {
  return `passed ${counts.passed} · failed ${counts.failed} · n/a ${counts.na} · unchecked ${counts.unchecked}`
}

/** A state word from a caller, or null when it is none of the three. Absent means passed. */
function stateFrom(value: unknown): TickState | null | undefined {
  if (value === undefined) return undefined
  return (TICK_STATES as readonly unknown[]).includes(value) ? (value as TickState) : null
}
const STATE_REFUSAL = 'state is one of passed, failed or na (not applicable). Nothing was changed.'

/** One line of a list as an agent reads it: position, state, id, words, evidence, who. */
function rowLine(row: { item: { id: string; text: string; fact?: Fact }; done: { by: string; viaMcp?: boolean; note?: string; evidence?: { said: string }; state?: TickState } | null }, at: number): string {
  const done = row.done
  const who = done
    ? `  (${done.by}${done.viaMcp ? ', over MCP' : ''}${done.note ? `: ${done.note}` : ''}`
      + `${done.evidence ? `; ticked on "${done.evidence.said}"` : ''})`
    : ''
  /* The fact an item is checked against, so an agent knows which part of the
     issue or change to read before ticking it. This door reads no tracker,
     so what the fact SAYS is the agent's to find out. */
  const fact = row.item.fact ? `  [evidence: the tracker's ${FACT_NAMES[row.item.fact]}]` : ''
  return `${at + 1}. [${MARKS[stateOf(done)]}] ${row.item.id} — ${row.item.text}${fact}${who}`
}

/**
 * The angle a reading tool was handed: `role`, else the person's own roles
 * from `my_roles`, else any role — this door reads no tracker, so it cannot
 * find a person's roles itself. Null with the refusal when `role` is not one.
 */
function angleFrom(args: Record<string, unknown>): { angle: Angle; mine: Role[] | null } | { refusal: string } {
  if (args.role !== undefined && args.role !== null && args.role !== '') {
    if (typeof args.role !== 'string' || !(['assignee', 'reviewer', 'author', 'any'] as string[]).includes(args.role)) {
      return { refusal: 'role is one of assignee, reviewer, author or any. Leave it out to read from the person\'s own roles (my_roles).' }
    }
    return { angle: angleOf(args.role), mine: null }
  }
  const said = Array.isArray(args.my_roles) ? args.my_roles.filter((one): one is string => typeof one === 'string').slice(0, 8) : null
  return { angle: 'auto', mine: said ? rolesFromMine(said) : null }
}

/**
 * What applies to one item — a ref, or the paper an epic is aimed at — read
 * from an angle: every list whose types × roles cover it, every list held
 * against it by hand, and its own lines, each with what is ticked there. The
 * same question the reading page asks (`inFront`), answered in words.
 */
function appliesText(where: string, target: Target, args: Record<string, unknown>): string {
  const angled = angleFrom(args)
  if ('refusal' in angled) throw new Error(angled.refusal)
  if (target.kind !== 'ref' && target.kind !== 'paper') {
    throw new Error('what applies is asked about one item: a ref (e.g. "gh#105", "!44") or an epic, for its paper.')
  }
  const ref = target.kind === 'ref' ? target.ref : null
  const epic = target.kind === 'paper' ? target.epic : null
  const said = typeof args.type === 'string' && (['issue', 'mr', 'pr'] as string[]).includes(args.type) ? (args.type as ItemType) : null
  const read: RefsRead = {
    types: ref && said ? { [ref]: said } : {},
    roles: ref && angled.mine ? { [ref]: angled.mine } : {},
    epics: {},
  }
  const { instances, items, undecided, trouble } = inFront(
    { ladders: [], selection: ref ? [ref] : [], whole: epic, read, angle: angled.angle, paper: epic },
    where,
  )
  if (trouble) return trouble
  const item = items[0] as ItemInFront
  const name = ref ?? `the paper ${epic}`
  const kind = item.type ? ` (${item.type === 'paper' ? 'a paper' : `a ${typeName(item.type)}`})` : ''
  const mine = instances.filter((one) => (ref ? one.target?.kind === 'ref' && one.target.ref === ref : one.target?.kind === 'paper'))
  const rules = mine.filter((one) => !one.checklist.only)
  const own = mine.filter((one) => one.checklist.only)
  const block = (one: (typeof mine)[number]) => {
    const why = one.checklist.only
      ? 'lines just for this item'
      : one.through?.length
        ? `applies to ${one.through.map(targetName).join('; ')}`
        : `held for ${targetName(one.target as Target)} by hand`
    return [
      `  ${one.checklist.id} — "${one.checklist.name}" (${why}) — ${countsLine(one.counts)}`,
      ...(one.rows.length ? one.rows.map((row, at) => `    ${rowLine(row, at)}`) : ['    (no lines yet)']),
    ].join('\n')
  }
  const head = `${angleLine(item.as, name)}${kind}${angled.angle === 'auto' && !angled.mine && !args.role ? ' — no role was given, so any role' : ''}:`
  const parts = [head]
  if (rules.length || own.length) {
    parts.push(...rules.map(block), ...own.map(block))
  } else {
    parts.push(`  ${nothingLine(name, item.as)}`)
  }
  if (ref) {
    const runs = runsFor(where, [ref]).runs[ref] ?? []
    if (runs.length) parts.push('', ...runsBlock(runs))
  }
  const unsure = undecidedLine(undecided)
  if (unsure) parts.push('', `${unsure} Pass type to say what it is.`)
  if (item.elsewhere.length) {
    parts.push(
      '',
      `Lists for ${rolesPhrase(item.elsewhere).replace(/^as /, '')} apply to ${name} too: ask again with role `
      + `${item.elsewhere.map((role) => `"${role}"`).join(' or ')} to read from that angle.`,
    )
  }
  parts.push(
    '',
    'Tick a line with check_item, naming the checklist id above and this item. add_item_for adds a line just for '
    + 'this item; hold_checklist with types and roles makes a list apply to every item of a type.',
  )
  return parts.join('\n')
}

/**
 * The automatic items for one ref, as an agent reads them: what each run said, marked automatic,
 * in the marks a listing uses ([x] passed, [!] failed, [ ] anything else) with the state in words.
 * They cannot be ticked with check_item: the run ticks them.
 */
function runsBlock(runs: readonly RunItem[]): string[] {
  const mark = (one: RunItem) => (one.state === 'passed' ? 'x' : one.state === 'failed' ? '!' : ' ')
  return [
    `  Automatic, ${FROM_A_RUN} (ticked by the run, not by hand; check_item cannot tick them):`,
    ...runs.map(
      (one) =>
        `    [${mark(one)}] ${runItemText(one.label)} — ${RUN_STATE_WORDS[one.state].toLowerCase()}`
        + `${one.exit !== null ? `, exit ${one.exit}` : ''} (automatic, published in .kehikot/${one.from}/)`
        + `${one.hidden ? ' — hidden on the page by a person' : ''}`,
    ),
  ]
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
  const head = target?.kind === 'rule'
    ? `"${on.checklist.name}" (${on.checklist.id}) — ${on.total} item${on.total === 1 ? '' : 's'}, `
      + `${holds(id, target, where) ? 'applies' : 'does NOT apply'} to ${targetName(target)}. Ticks are per item, so nothing below is `
      + 'ticked or unticked: ask with a ref to see what is ticked for it.'
    : target
    ? `"${on.checklist.name}" (${on.checklist.id}) held against ${targetName(target)} — ${on.done}/${on.total} ticked\n${countsLine(on.counts)}`
    : `"${on.checklist.name}" (${on.checklist.id}) — ${on.total} item${on.total === 1 ? '' : 's'}, no target named, so nothing below is ticked or unticked`
  if (!on.rows.length) {
    return `${head}\nThis list has no items yet. add_checklist_item puts the first line on it.`
  }
  const lines = on.rows.map((row, at) => rowLine(row, at))
  /*
   * Where else this list is held, with what is ticked there. Every target the
   * list is ASSIGNED to, whether or not anything is ticked on it — an agent
   * reading `0/12` for one chapter should be able to see that the same list
   * is held against six others, and that the person will see it in each.
   */
  const all = targetsOf(id, where)
  const others = all.filter((row) => !target || targetKey(row.target) !== targetKey(target))
  /* The most recently held first when there are many: a list held against every issue
     a project ever had is named by count past `NAMED_TARGETS`, not printed whole. */
  /* Rules (types × roles) are always named, first: there are at most a few. */
  const standing = others.filter((row) => row.target.kind === 'rule')
  const each = others.filter((row) => row.target.kind !== 'rule')
  const named = [...standing, ...(each.length > NAMED_TARGETS ? each.slice(-NAMED_TARGETS).reverse() : each)]
  const more = others.length - named.length
  const byHand = named.filter((row) => row.target.kind !== 'rule')
  const tail = others.length
    ? (standing.length
      ? `\n\nApplies to: ${standing.map((row) => targetName(row.target)).join('; ')} (each item keeps its own ticks)`
      : '')
      + (byHand.length || more
        ? `\n\n${target ? 'Also held' : 'Held'} against: ${byHand.map((row) => `${targetName(row.target)} (${row.done} ticked)`).join(', ')}`
          + (more ? `, and ${more} more (${others.length - standing.length} in all; the ${byHand.length} named are the most recently held)` : '')
        : '')
    : target
      ? ''
      : '\n\nApplies to nothing yet, so nobody sees it anywhere: hold_checklist with types and roles puts it in front of somebody.'
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

  if (name === 'add_item_for') {
    const text = str(args.text, MAX_TEXT)
    if (!text) throw new Error('add_item_for needs text: the line this one item still owes.')
    const ref = part(args.ref)
    const epic = ref ? null : part(args.epic)
    if (!ref && !epic) {
      throw new Error(
        'add_item_for needs the item: a ref (an issue, merge request or pull request, e.g. "gh#105") or an epic, for '
        + 'its paper. Nothing was added.',
      )
    }
    const target: Target = ref ? { kind: 'ref', ref } : { kind: 'paper', epic: epic as string, section: null }
    const out = change({ op: 'add-for', target, text, by, viaMcp: true }, where)
    if (!out.ok) throw new Error(out.error)
    return `${out.said}.\n\n${appliesText(where, target, args)}`
  }

  if (name === 'checklist_for' && !('module' in args)) {
    /* The first question: what applies to this item. Read-only. */
    const ref = part(args.ref)
    const epic = ref ? null : part(args.epic)
    if (!ref && !epic) {
      throw new Error(
        'checklist_for needs a ref (or an epic, for its paper) to say which checklists are for that item — or a '
        + 'checklist and module, to say whose work a checklist is for. Nothing was changed.',
      )
    }
    return appliesText(where, ref ? { kind: 'ref', ref } : { kind: 'paper', epic: epic as string, section: null }, args)
  }

  const id = str(args.checklist, MAX_ID)
  if (!id) {
    throw new Error(
      `${name} needs the id of the checklist, which the checklists tool prints beside each name. It is not the name `
      + '— a name can be changed and an id cannot.',
    )
  }
  if (name === 'hold_checklist') {
    /* The same passage resolution as `check_item`, so an agent that was told
       what is owed "here" can hold a list here without spelling the section id
       this program mints. */
    const typed = args.types !== undefined || args.every !== undefined
    const aim = aimed(args, where, id, args.release !== true)
    if (!aim && typed) throw new Error(`hold_checklist: ${ruleRefusal(args)} Nothing was changed.`)
    if (!aim) {
      throw new Error(
        'hold_checklist needs to say WHAT to hold the list against: types (with roles) for every item of a type, a ref (an issue, merge request or pull request, '
        + 'e.g. "gh#105"), an epic whose paper this is, optionally with a section of it or a path into it, or a '
        + 'kehikko\'s key and a module, for that module\'s container there whichever epic is open, or every: "issue" '
        + 'or "change" (with epic to mean only that epic\'s), for every such ref. What a '
        + 'list is held against is where a person sees it, so there is nothing to do without one.',
      )
    }
    const op: Op = { op: args.release === true ? 'release' : 'hold', id, target: aim.target, by, viaMcp: true }
    const out = change(op, where)
    if (!out.ok) throw new Error(out.error)
    return `${out.said}.${aim.also ? `\n\n${aim.also}` : ''}\n\n${listText(id, null, where)}`
  }

  if (name === 'checklist_for') {
    /* `null` says every module's, as on the page's door. Anything else has to
       be a string naming one: left out, empty or not a string is refused
       rather than read as null, so a call that lost the id clears nothing. */
    const present = modulesHere()
    const module = args.module === null ? null : typeof args.module === 'string' ? str(args.module, MAX_TARGET_PART) : ''
    if (module === '') {
      throw new Error(
        'checklist_for needs module: the id of the module whose work the list is for, e.g. "kehikot.screenplay", or '
        + 'null to say it is for every module’s work again. Nothing was changed. '
        + (present.length ? `The modules here are: ${present.join(', ')}.` : 'No other module is registered here to offer.'),
      )
    }
    const out = change({ op: 'for', id, module, present, by, viaMcp: true }, where)
    if (!out.ok) throw new Error(out.error)
    return `${out.said}.\n\n${listText(id, null, where)}`
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
  let also: string | null = null

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
    /* check_item, and the one operation that involves a target at all. It gets
       the same passage resolution the reading tool does, so an agent that asked
       "what is owed here" and then ticks something is ticking against the place
       it was answered about rather than against the whole paper. */
    const aim = aimed(args, where, id, false)
    if (!aim) {
      throw new Error(
        'check_item needs to say WHAT is being ticked off: a ref (an issue, merge request or pull request, e.g. '
        + '"gh#105"), an epic whose paper this is, optionally with a section of it, or a kehikko\'s key, a module '
        + 'and the epic whose run of that container it is. A tick belongs to the '
        + 'checklist, the item and the target together — the same list held against two pieces of work keeps two '
        + 'separate sets of ticks — so there is nothing to record without one. Names may not be empty, longer than '
        + `${MAX_TARGET_PART} characters, or contain a space or a slash.`,
      )
    }
    target = aim.target
    also = aim.also
    const state = stateFrom(args.state)
    if (state === null) throw new Error(`check_item: ${STATE_REFUSAL}`)
    if (state !== undefined && args.done === false) {
      throw new Error('check_item: done: false takes an answer back and has no state. Nothing was changed.')
    }
    op = {
      op: 'tick',
      id,
      item,
      target,
      done: args.done !== false,
      ...(state ? { state } : {}),
      by,
      viaMcp: true,
      note: str(args.note, MAX_NOTE) || undefined,
    }
  }

  const out = change(op, where)
  if (!out.ok) throw new Error(out.error)
  return `${out.said}.${also ? `\n\n${also}` : ''}\n\n${listText(id, target, where)}`
}

/* A status and a document — the protocol's `Reply`. Nothing here writes bytes; `doors()` does that. */
export type { Reply }

/**
 * A tool name that asks to purge, restore or delete storage. There is no such tool, and the
 * refusal says why rather than "no tool": an agent that went looking for one should learn
 * that this is a person's decision, and where the person makes it.
 */
const PERSON_ONLY = /purge|restore|discard|delete_?backup|clean_?up|prune/i
export const PURGE_IS_A_PERSONS =
  'Purging checklist storage is a person’s decision, so no tool here does it and none ever will. Read what the '
  + 'folder takes up with the storage tool, and tell the person: they purge, with a preview first, on the '
  + 'Checklist page under View → Storage.'

/** The host's tracker reading as the page hands it over: closed or merged refs, and when. Bounded, never trusted. */
function finishedFrom(value: unknown): Finished[] | null {
  if (!Array.isArray(value)) return null
  return value.slice(0, MAX_FINISHED).flatMap((one) => {
    const row = (typeof one === 'object' && one !== null ? one : {}) as { ref?: unknown; at?: unknown }
    const ref = part(row.ref)
    if (!ref) return []
    const at = typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at)) ? new Date(row.at).toISOString() : null
    return [{ ref, at }]
  })
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
     * `kehikot.notifications@1` files every line under an epic, and a call about
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
      epic: named?.kind === 'paper' ? named.epic : named?.kind === 'kehikko' ? named.epic : null,
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

      if (name === 'storage') return text(usageText(where))
      if (PERSON_ONLY.test(name)) return text(PURGE_IS_A_PERSONS, true)
      if (name === 'checklists') {
        const id = str(args.checklist, MAX_ID)
        const ref = part(args.ref)
        const epic = part(args.epic)
        if (!id && (ref || epic)) {
          /* No checklist and an item: what applies to it, from the angle. */
          return text(appliesText(where, ref ? { kind: 'ref', ref } : { kind: 'paper', epic: epic as string, section: null }, args))
        }
        if (!id) return text(listsText(where))
        /* A target is optional here and refused only when it was GIVEN and is
           not a name. Asking about a list with no target is a perfectly good
           question — "what does this list say" — and answering it with a
           complaint about a ref nobody sent would be a refusal of the wrong
           thing. */
        const gave = args.ref !== undefined || args.epic !== undefined || args.kehikko !== undefined
        const aim = gave ? aimed(args, where, id, false) : null
        if (gave && !aim) {
          return text(
            'checklists was given something that is not a target. It takes a ref like "gh#105" or "!44", or an epic '
            + `slug with an optional section — no spaces, no slashes, no more than ${MAX_TARGET_PART} characters — or `
            + 'nothing at all, in which case it answers with the list and no ticks.',
            true,
          )
        }
        return text(`${aim?.also ? `${aim.also}\n\n` : ''}${listText(id, aim?.target ?? null, where)}`)
      }
      if (
        name === 'create_checklist'
        || name === 'hold_checklist'
        || name === 'checklist_for'
        || name === 'add_checklist_item'
        || name === 'add_item_for'
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
/**
 * The door. Every project path in a request — `project` in the query, in the body or in a
 * tool's arguments, and the `from` of an import — is put to the host first
 * (`resolveProject`); what is worked on is the path it gives back, never the one that was
 * sent, and a folder the host does not vouch for is refused before anything is read or made.
 * A move that was followed is said in the answer.
 */
export async function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Promise<Reply | null> {
  const notes: string[] = []
  const refuse = (why: string): Reply =>
    path === '/mcp' ? mcpRefusal(body, why) : bad(why)
  const resolve = async (named: unknown): Promise<{ path: unknown } | Reply> => {
    if (typeof named !== 'string' || !named.trim()) return { path: named }
    const at = await resolveProject(named)
    if (!at.ok) return refuse(at.error)
    if (at.followed) notes.push(at.followed)
    return { path: at.path }
  }

  let asked = query
  let sent = body
  if (path.startsWith('/api/') && query.has('project')) {
    const got = await resolve(query.get('project'))
    if (!('path' in got)) return got
    asked = new URLSearchParams(query)
    asked.set('project', got.path as string)
  }
  if (path.startsWith('/api/') && sent) {
    for (const key of ['project', 'from']) {
      if (!(key in sent)) continue
      const got = await resolve(sent[key])
      if (!('path' in got)) return got
      sent = { ...sent, [key]: got.path }
    }
  }
  if (path === '/mcp' && method === 'POST' && sent?.method === 'tools/call') {
    const params = (sent.params ?? {}) as { arguments?: Record<string, unknown> }
    if (params.arguments && 'project' in params.arguments) {
      const got = await resolve(params.arguments.project)
      if (!('path' in got)) return got
      sent = { ...sent, params: { ...params, arguments: { ...params.arguments, project: got.path } } }
    }
  }

  const reply = answerAt(method, path, asked, sent, ticket)
  if (!reply || notes.length === 0) return reply
  const said = reply.body as Record<string, unknown> | null
  if (path === '/mcp' && said && typeof said === 'object') {
    const result = said.result as { content?: { type: string; text: string }[] } | undefined
    if (result?.content) result.content = [...result.content, ...notes.map((text) => ({ type: 'text', text }))]
  } else if (said && typeof said === 'object' && !Array.isArray(said)) {
    said.movedFrom = notes
  }
  return reply
}

function mcpRefusal(body: Record<string, unknown> | null, why: string): Reply {
  return {
    status: 200,
    body: { jsonrpc: '2.0', id: (body?.id as number | string | undefined) ?? null, result: { content: [{ type: 'text', text: why }], isError: true } },
  }
}

/** The door below the check: `where` and `from` are already paths the host vouched for. Tests of what the doors DO start here. */
export function answerAt(
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
   * Everything in front of the reader: every checklist held against where they
   * are standing or what they have selected, each with the ticks for that
   * target. The reading page's one request.
   *
   * ## Where the reader is standing is answered HERE, and not on a door of its own
   *
   * The obvious build was `/api/where`: the page sends the passage, gets back a
   * file and a section, and then asks for the lists. Two round trips, and — the
   * part that decided it — two answers that can disagree. Between the first and
   * the second the reader moves, the second is about a place the first never
   * named, and the container prints one chapter's lists under another chapter.
   * That is the "two halves quietly disagreeing" failure this workspace keeps
   * finding, built in on purpose.
   *
   * So the passage rides on this request, the ladder is built before the store
   * is read, and `placed` comes back beside the instances: one answer, about
   * one place, or none. Nothing here writes, and nothing here CHOOSES: which
   * lists come back is `showing` in `list/holding.ts` reading what a person
   * assigned, and a position nothing was assigned to comes back empty.
   *
   * `refs` is every reference in front of the reader, space separated, which
   * is safe because `part()` refuses whitespace inside a reference.
   *
   * ## Several documents, one request
   *
   * `path`/`from`/`to` name ONE place, and are kept: an agent at the MCP door
   * and every test written against this door say it that way. `doc` may be
   * repeated and names one place each — `path`, `from` and `to` tab separated,
   * the same flattening the page's own wire holds a passage as — because a
   * kehikko can have several containers each showing a place in the paper and
   * every one of them is in front. Each is placed, each gets a ladder, and
   * `inFront` walks them all. `placed` stays the FIRST place, which the page
   * sends as the reader's own passage; `positions` is every place resolved, in
   * the order asked, so a row can be labelled with the words of whichever
   * heading it belongs to.
   */
  if (path === '/api/here' && method === 'GET') {
    const where = project(query.get('project'))
    const epic = part(query.get('epic'))
    const one = str(query.get('path'), MAX_PROJECT)
    const asked: { path: string; from: number | null; to: number | null }[] = []
    if (one) {
      asked.push({
        path: one,
        from: query.has('from') ? Number(query.get('from')) : null,
        to: query.has('to') ? Number(query.get('to')) : null,
      })
    }
    for (const doc of query.getAll('doc').slice(0, MAX_DOCS)) {
      const [docPath, docFrom, docTo] = str(doc, MAX_PROJECT).split('\t')
      if (!docPath) continue
      const from = docFrom ? Number(docFrom) : null
      const to = docTo ? Number(docTo) : null
      asked.push({ path: docPath, from: Number.isFinite(from) ? from : null, to: Number.isFinite(to) ? to : null })
    }
    const positions = where ? asked.map((at) => placeOf(where, at.path, at.from, at.to)) : []
    /* `whole=1`: every list held against this epic's paper, wherever in it.
       The page asks it while parts of the epic are picked out, and narrows
       the answer itself — `list/focus.ts`. Nobody is standing anywhere then,
       so there is no `placed`; `positions` are the files the lists are held
       against, added below once the lists are known. */
    const whole = query.get('whole') === '1' ? epic : null
    const placed = whole ? null : (positions[0] ?? null)
    /* One ladder per place, and the paper rung once even with no place at
       all: a reader with an epic and no document open is still standing on
       the whole paper, which is what `scopeOf(epic, null)` says. */
    const ladders = positions.length
      ? positions.map((at) => ladderKey(rungsOf(scopeOf(epic, at))))
      : [ladderKey(rungsOf(scopeOf(epic, null)))]
    const selection = str(query.get('refs'), MAX_PROJECT)
      .split(' ')
      .map(part)
      .filter((one): one is string => one !== null)
    /* The kehikko the page is on, the modules whose containers are in front
       there, and the open epic — sent apart from `epic`, which the page leaves
       out when the paper is not in front, because a list held against a
       container follows the open epic whatever is picked out. */
    const kehikko = part(query.get('kehikko'))
    const modules = heard(query.getAll('module'))
    const following = kehikko && modules.length ? { kehikko, modules, epic: part(query.get('open')) } : null
    const read = refsRead(query, selection)
    /* The angle the items are read from, and whether the paper is one of them: the page says so when a reader
       is in it or parts of it are picked, and then a list for papers is asked about. */
    const angle = angleOf(query.get('angle'))
    const paper = query.get('paper') === '1' ? epic : null
    const { instances, items, undecided, trouble, nowhere } = inFront({ ladders, selection, whole, following, read, angle, paper }, where)
    /*
     * And for the whole paper, the file each list is held against, as a place.
     *
     * A target is stored as a file's ID, and a part of the epic lists
     * DOCUMENTS, by path. The page ties the two together with the protocol's
     * rule and nothing of its own (`anchorOf` in `list/focus.ts`), which needs
     * the path — and an id cannot be turned back into one, so the disk is
     * asked which file spells it (`filesNamed`). A row is labelled from the
     * same place. An id no file spells any more has no place, and its list is
     * in no part.
     */
    if (whole && where) {
      const known = new Set(positions.flatMap((one) => (one ? [one.file] : [])))
      const ids = [...new Set(instances.flatMap((one) => (one.target?.kind === 'paper' && one.target.section ? [fileOfSection(one.target.section)] : [])))]
      for (const id of ids.slice(0, MAX_HELD_FILES)) {
        for (const file of filesNamed(where, id)) {
          if (known.has(file)) continue
          known.add(file)
          positions.push({ file, section: null, title: null })
        }
      }
    }
    return ok({ ok: true, placed, positions, instances, items, undecided, trouble, nowhere, whole: whole !== null })
  }

  /*
   * One checklist, held against one target — or on its own, which is what the
   * edit page opens it as.
   *
   * The target rides in the query rather than the path because it has two or
   * three parts and a path would have to encode them into one — which is exactly
   * the ambiguity `list/targets.ts` builds its key to avoid. Reads are ungated
   * like every other read here; a checklist is not a secret.
   */
  if (path === '/api/checklist' && method === 'GET') {
    const id = str(query.get('id'), MAX_ID)
    if (!id) return bad('that did not say which checklist. Ask /api/checklists for the ids.')
    const where = project(query.get('project'))
    const gave = query.has('ref') || query.has('epic') || query.has('kehikko')
    const target = gave
      ? resolve(
        {
          ref: query.get('ref'),
          epic: query.get('epic'),
          kehikko: query.get('kehikko'),
          module: query.get('module'),
          section: query.get('section'),
          path: query.get('path'),
          /* `undefined` and not `Number(null)`, which is zero. A zero-to-zero
             range is a half-answer this door would then have to un-invent, and
             `resolve` would be reading a claim nobody made. */
          from: query.has('from') ? Number(query.get('from')) : undefined,
          to: query.has('to') ? Number(query.get('to')) : undefined,
          pick: query.get('pick') === '1',
        },
        where,
      )
      : null
    if (gave && !target) {
      return bad(
        'that is not a target. A checklist is held against an issue, a merge request, a pull request, the paper '
        + 'an epic is aimed at, or a module\'s container on one kehikko (its key and the module\'s id): '
        + `names may not be empty, longer than ${MAX_TARGET_PART} characters, or contain a space `
        + 'or a slash.',
      )
    }
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
    /* `placed` is answered from the passage even when a section was named: the
       target is what the ticks belong to and `placed` is where the reader's
       document actually is, and an agent asking both may want both. */
    const passage = str(query.get('path'), MAX_PROJECT)
    const placed = passage
      ? placeOf(
        where,
        passage,
        query.has('from') ? Number(query.get('from')) : null,
        query.has('to') ? Number(query.get('to')) : null,
      )
      : null
    /* The edit page draws a chip per target. Past `SHOWN_TARGETS` it is sent the most
       recently held and the count, and says how many more there are. */
    const all = targetsOf(id, where)
    return ok({
      ok: true,
      held: on,
      targets: all.length > SHOWN_TARGETS ? all.slice(-SHOWN_TARGETS) : all,
      heldTotal: all.length,
      placed,
      trouble,
      nowhere,
    })
  }

  /*
   * The paper's files and their headings, which is what the target picker
   * offers instead of a text box.
   *
   * ## Why this is a second door, when `/api/checklist` argues against one
   *
   * The essay above says the passage rides on the checklist request rather than
   * getting a door of its own, because two round trips give two answers that can
   * disagree — the reader moves between them and the page prints one heading
   * over another heading's ticks. That argument stands and this does not
   * contradict it, because an outline is not in that pair.
   *
   * What can disagree is a claim about WHERE THE READER IS against the ticks
   * drawn under it. An outline is a claim about what EXISTS: the files of a
   * paper and the headings in them. It is not drawn as a heading, nothing is
   * derived from it, and a stale one costs a picker that offers a section
   * somebody has just renamed — whereupon pressing it holds the list against a
   * target with no ticks on it, which is exactly what pressing a section with no
   * ticks does anyway.
   *
   * The reason it must not ride on `/api/checklist` is cost. That request runs
   * on every context, and a context arrives after every selection change
   * anywhere on the canvas; this one opens every file of a paper. Folding the
   * two together would read the whole thesis several times a second in order to
   * answer a question nobody had asked yet. So it is asked once, when the reader
   * opens the picker, and `src/app.tsx` holds the answer until they move.
   *
   * Ungated like every other read here. It says which headings are in a paper
   * this caller can already read every checklist of.
   */
  if (path === '/api/outline' && method === 'GET') {
    const where = project(query.get('project'))
    const passage = str(query.get('path'), MAX_PROJECT)
    /* Null rather than a refusal for both of the ordinary absences — no project
       open, no document under the reader. The picker draws no files and says one
       short line; a 400 would make an everyday state look like the page had
       asked something wrong, which is the same argument `nowhere` makes above. */
    return ok({ ok: true, outline: where && passage ? outlineOf(where, passage) : null })
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
  /*
   * What the folder takes up. Ungated like every other read; it says less than
   * `/api/checklists` already does. Which targets are finished needs the
   * tracker reading the PAGE has, so the page asks by POST with it (below).
   */
  /*
   * The automatic "Tests pass" items for the refs in front: every module's published run results
   * (`list/runs.ts`), the newest run of each label per ref, each saying whether a person hid it.
   * Ungated like every other read; it says what is already in the project's own `.kehikot/`.
   */
  if (path === '/api/runs' && method === 'GET') {
    const refs = str(query.get('refs'), MAX_PROJECT)
      .split(' ')
      .map(part)
      .filter((one): one is string => one !== null)
      .slice(0, MAX_RUN_REFS)
    return ok({ ok: true, ...runsFor(project(query.get('project')), refs) })
  }

  if (path === '/api/storage' && method === 'GET') {
    return ok({ ok: true, ...usage(project(query.get('project'))) })
  }

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
    /* `refuseTicket` marks the refusal, so a page that is merely older than this process — the
       server restarted under it — is told so by its own `ask()` instead of being called a stranger. */
    const refused = refuseTicket(ticket, TICKET, 'that press did not come from this app’s own page')
    if (refused) return refused
    if (!body) return bad('that was not a request')

    /*
     * Storage: usage with the tracker's reading, a purge's preview, the purge,
     * and a backup put back or deleted. Behind the ticket like every write, so
     * only this app's own page can reach it — the MCP door is `/mcp`, and no
     * tool there purges (`PURGE_IS_A_PERSONS`).
     */
    if (path === '/api/storage') {
      const where = project(body.project)
      if (!where) return bad(NO_PROJECT)
      const op = str(body.op, 16)
      const finished = finishedFrom(body.finished)
      if (op === 'usage') return ok({ ok: true, ...usage(where, finished) })
      const rule = { scope: str(body.scope, 16) as Rule['scope'], days: typeof body.days === 'number' ? body.days : Number.NaN }
      if (op === 'preview') {
        const out = preview(where, rule, finished)
        return ok(out.ok ? { ok: true, plan: out.value } : out)
      }
      if (op === 'purge') {
        if (body.confirm !== true) return bad('a purge has to be confirmed, after its preview. Nothing was purged.')
        const out = purge(where, { rule, digest: str(body.digest, 64), keep: body.keep !== false }, finished)
        return ok(out.ok ? { ok: true, said: out.value.said, backup: out.value.backup, ...usage(where, finished) } : out)
      }
      if (op === 'restore' || op === 'discard') {
        const name = str(body.name, 64)
        const out = op === 'restore' ? restore(where, name) : discard(where, name)
        return ok(out.ok ? { ok: true, said: out.value, ...usage(where, finished) } : out)
      }
      return bad(`there is no "${op}" in Storage — it is usage, preview, purge, restore or discard. Scopes: ${SCOPES.join(', ')}.`)
    }

    /*
     * Hide an automatic item, or show it again — the one thing a person does to one. There is no
     * tick here and no op for one: a run's item is ticked by the run (`list/runs.ts`).
     */
    if (path === '/api/runs') {
      const where = project(body.project)
      if (!where) return bad(NO_PROJECT)
      const op = str(body.op, 16)
      const ref = part(body.ref)
      const label = str(body.label, 200)
      if (!ref || !label) return bad('that did not say which item: a ref and the run’s label.')
      if (op !== 'hide' && op !== 'show') {
        return bad(`there is no "${op}" for a test run’s item — it is hide or show. It is ticked by the run, never by hand.`)
      }
      return ok(setHidden(where, ref, label, op === 'hide'))
    }

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

      if (op === 'create') {
        const rule = ruleBody(body.rule)
        return ok(change({ op: 'create', name: str(body.name, MAX_NAME), ...(rule ? { rule } : {}), by }, where))
      }
      /* A line for one item alone: the item is the target the body names, a ref or a paper. */
      if (op === 'add-for') {
        const target = readTarget(body)
        if (!target) return bad('that did not say which item the line is for: a ref, or an epic for its paper.')
        return ok(change({ op: 'add-for', target, text, by }, where))
      }
      /*
       * An import, which is the one write that names two projects.
       *
       * Answered above the "which checklist" check below, because its `id` names
       * a list in the OTHER project rather than in this one — the same reason
       * the store answers it above its own lookup.
       *
       * `from` goes through `project()` exactly as `where` does, and that is the
       * point rather than a convenience. This door has no idea that a person
       * picked `from` out of the host's dialog, and must not behave as though it
       * did: a path from a picker and a path from a context are the same kind of
       * string, get the same bounds here, and meet the same fence in `store.ts`.
       * A door that trusted one of them more would be a fence with a gate in it.
       */
      if (op === 'import') {
        const from = project(body.from)
        if (!from) {
          return bad(
            'that import did not say which project to copy from. This app cannot work it out on its own — it is '
            + 'told one project and may read what it was told, so the project a list comes from is one somebody '
            + 'picked.',
          )
        }
        if (!id) return bad('that import did not say which checklist to copy.')
        return ok(change({ op: 'import', from, id, by }, where))
      }
      if (!id) return bad('that edit did not say which checklist it was about.')
      if (op === 'rename') return ok(change({ op: 'rename', id, name: str(body.name, MAX_NAME), by }, where))
      if (op === 'forget') return ok(change({ op: 'forget', id, by }, where))
      if (op === 'applies') {
        if (!Array.isArray(body.rules)) return bad('that did not say what the list applies to: a list of types × roles.')
        const rules = body.rules.slice(0, 16).map(ruleBody)
        if (rules.some((one) => one === null)) return bad('one of those rules was not types × roles. Nothing was changed.')
        return ok(change({ op: 'applies', id, rules: rules as NonNullable<ReturnType<typeof ruleBody>>[], by }, where))
      }
      if (op === 'for') {
        /* `null` says the list is every module's again. Anything else has to
           be a module's id, and an empty one is refused rather than read as
           null, so a page that lost the id cannot quietly clear it. */
        const module = body.module === null ? null : str(body.module, MAX_TARGET_PART)
        if (module === '') return bad('that did not say which module the list is for. It is a module’s id, or null.')
        return ok(change({ op: 'for', id, module, present: [...heard(body.present), ...modulesHere()], by }, where))
      }
      if (op === 'add') return ok(change({ op: 'add', id, text, by }, where))
      if (op === 'reword') return ok(change({ op: 'reword', id, item, text, by }, where))
      if (op === 'drop') return ok(change({ op: 'drop', id, item, by }, where))
      if (op === 'cite') {
        /* `null` says the line names no fact any more; anything else has to be
           one of the facts the page offers, and a word that is not one is
           refused rather than dropped, so a typo cannot quietly clear one. */
        const fact = body.fact === null ? null : (FACTS as readonly unknown[]).includes(body.fact) ? (body.fact as Fact) : undefined
        if (fact === undefined) {
          return bad(`that did not name a tracker fact. It is one of ${FACTS.join(', ')}, or nothing.`)
        }
        return ok(change({ op: 'cite', id, item, fact, by }, where))
      }
      if (op === 'move') {
        const to = typeof body.to === 'number' && Number.isFinite(body.to) ? body.to : null
        if (to === null) return bad('a move needs a position to move to, and nothing was moved.')
        return ok(change({ op: 'move', id, item, to, by }, where))
      }
      /*
       * The page's targets meet the agent's standard (`settle`): a file or a
       * heading has to be one this list is already held against or one that is
       * on disk, so this door cannot mint a target the other refuses. The page
       * makes three kinds — a reference, the whole paper, and a file or heading
       * off the outline, which was read off disk — so its own presses pass. A
       * release is not held to it: letting go of a name mints nothing.
       */
      if (op === 'hold' || op === 'release') {
        const named = readTarget(body)
        if (!named) {
          return bad(
            `that ${op} did not say which target. A checklist is held against an issue, a merge request, a pull `
            + 'request, types of item × roles, or a paper, one of its files or one heading in it.',
          )
        }
        let target = named
        if (op === 'hold') {
          try {
            target = settle(named, where, id, true, 'project').target
          } catch (refusal) {
            return bad(refusal instanceof Error ? refusal.message : String(refusal))
          }
        }
        return ok(change({ op, id, target, by }, where))
      }
      if (op === 'tick') {
        const named = readTarget(body)
        if (!named) {
          return bad(
            'that tick did not say what it was against. A tick belongs to a checklist, an item and a target '
            + 'together — the same list held against two pieces of work keeps two separate sets of ticks.',
          )
        }
        let target = named
        try {
          target = settle(named, where, id, false, 'project').target
        } catch (refusal) {
          return bad(refusal instanceof Error ? refusal.message : String(refusal))
        }
        const state = stateFrom(body.state)
        if (state === null) return bad(`that tick named a state that is not one: ${STATE_REFUSAL}`)
        return ok(
          change(
            {
              op: 'tick',
              id,
              item,
              target,
              done: body.done !== false,
              ...(state ? { state } : {}),
              by,
              note: str(body.note, MAX_NOTE) || undefined,
              /* Parsed, and dropped when it does not parse: evidence is a record
                 the page offers beside a tick, and a tick is not refused for
                 a malformed record of what the tracker said. */
              evidence: evidenceSchema.safeParse(body.evidence).data,
            },
            where,
          ),
        )
      }
      /* Named rather than shrugged at, because the page and this store are one
         program: an op this door does not know is this app's own bug and the
         next person to read a log is the one who has to find it. */
      return bad(
        `there is no "${op}" to do to a checklist — it is create, import, rename, applies, for, forget, hold, release, add, add-for, reword, cite, move, drop or tick.`,
      )
    }
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

export { MANIFEST }

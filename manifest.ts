import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.checklist'
export const VERSION = '2.0.0'

/**
 * The port this app would rather have, said once and beside the id it belongs
 * with.
 *
 * A constant here for the same reason `EXTENSION` below is one, and against the
 * same failure: 7860 used to be a literal in two places — `--port "${PORT:-7860}"`
 * at the bottom of `run.sh` and `Number(process.env.PORT ?? 7860)` in
 * `register.ts` — with nothing keeping them in step, and a third copy sitting in
 * `~/.roadmap/modules` from whenever somebody last ran the second. Moving this
 * app was two edits and a thing to remember, and getting it wrong produced the
 * quiet failure again: a host talking to an address where nobody is.
 *
 * It lives in this file rather than in `vite.config.ts` because `register.ts`
 * needs it too, and importing a Vite config to read one number would build the
 * whole plugin list and mint this process's write ticket on the way to finding
 * out what to write down.
 *
 * It is a PREFERENCE and not a promise. 7820 through 7960 belong to the other
 * modules on this machine, and if something else holds 7860 when this starts,
 * `serves()` moves to the next free port and rewrites the registration to match
 * — see `roadmap-module-protocol/serve`. A host reads the registry, so the
 * registry is what has to be true; this number is only where to start looking.
 */
export const PREFERRED_PORT = 7860

/**
 * The extension this app emits into, named once.
 *
 * A constant rather than a string literal in two places, because the two places
 * are `manifest.ts` — where a host reads which format this module speaks — and
 * `src/wire/emit.ts`, where the events are actually sent. A typo in either one
 * produces the same silent failure: the host knows the format, validates the
 * payload, finds nobody who consumes what was named, and answers `delivered:
 * 0`. Nothing errors and nothing appears.
 */
export const FORMAT = 'roadmap.notifications@1'

/**
 * What this app says about itself when a host asks.
 *
 * The manifest is the smallest half of this program and the only half a host
 * ever reads. Everything else here works with nothing on the other end — so
 * read this as a description of the ENRICHMENT, not of the app: it says which
 * tab to give the page, and which questions the app would like to be allowed to
 * ask if there is anybody there to ask.
 *
 * ## What it declares, and the longer list of what it does not
 *
 * - **`state:keep` — declared, and it is the newest one.** The user asked that
 *   somebody looking at this container for the first time IN A KEHIKKO pick an
 *   existing checklist or create one, and that the choice then stick. A module's
 *   page is loaded once and shown on whichever canvas asks for it, so it cannot
 *   tell where it is standing except by `context.kehikko` — and it has nowhere
 *   of its own to write the answer that travels with `data/`. `state.set` is the
 *   protocol's answer: the host keeps one opaque string per module and hands it
 *   back in the greeting, before first render, so the page does not draw the
 *   pick screen and then correct itself. The host's state is keyed by MODULE and
 *   not by kehikko, so the per-kehikko map lives inside the string; see
 *   `list/keep.ts`.
 * - **`live:read` — NOT declared, where it used to be the only thing declared,
 *   and this is the biggest single deletion in this file.** It was there for one
 *   reason: `derive()` was a pure function of one `RefState`, so a host's reading
 *   of an epic let every tracker-answered item — pipeline, conflicts, threads,
 *   draft, size, the review mark — compute inside this app with no credentials.
 *   That was a good arrangement for a program that held a hardcoded list of
 *   things a merge request owes. There is no such list any more. Every item here
 *   is a line somebody typed, nothing about it is computable from a tracker, and
 *   a capability asked for and never used is the fastest way to teach somebody to
 *   press yes without reading. So it goes, and with it the seven verdicts, the
 *   ref-state store, and the whole `derive/` directory.
 * - **`epics:read` and `steps:read` — not declared.** They were asked for under
 *   protocol 1 so the page could offer the references a journey holds. Nothing
 *   needs them: the canvas says what the reader has picked out through
 *   `context.selection`, and a picker of our own beside it would be a second
 *   answer to "what are we looking at" that could disagree with the first.
 * - **`selection:set` — not declared.** This app REACTS to a selection; it does
 *   not make one. Declaring it would be asking to change what every other container
 *   on the canvas is looking at, in a module whose whole job is to answer a
 *   question about what is already picked.
 * - **`view:navigate` — not declared.** The checklist is a place a reader is
 *   already standing; what it wants is to be walked to, which is `roadmap.goto`
 *   arriving and needs no declaration.
 * - **`stage:report` — not declared.** Saying where work is belongs to whoever
 *   is doing it. A checklist has no opinion about that.
 * - **Tracker access — not declared, and there is no capability for it.** This
 *   app never speaks to GitHub or GitLab, holds no token, and has no code path
 *   that could. That was true when it derived items from a host's reading and it
 *   is more obviously true now that it derives nothing.
 * - **`events:emit` — declared, and `emits` names one format.** What is
 *   announced is NOT a tick. A tick is a thing a person does in this container, in
 *   front of them, and announcing it to a panel two inches away is telling
 *   somebody what they just did. What is announced is an agent coming through
 *   the MCP DOOR — the one thing that happens to this app that nobody watching
 *   the screen can see. That is the whole of the distinction: a notification is
 *   for what you would otherwise miss.
 *
 *   `consumes` stays empty. This app shows a checklist; a checklist that also
 *   showed other modules' announcements would be two panels in one container.
 *
 * And per the protocol's own README: a declaration is not a request and is not
 * answered. The host refuses whatever it likes at every call whatever is written
 * here, so the page is built to be refused — a kept string arriving is drawn as
 * a remembered choice, and its absence is drawn as the pick screen rather than
 * as a guess.
 *
 * ## `prompt: false`, deliberately, and the reasoning survived the rewrite
 *
 * The protocol offers a module a prompt: a paragraph a person writes on the
 * canvas, aimed at one container, composed by the host and delivered in every
 * context. Declaring it makes a host OFFER one. So the question is not "could we
 * find a use" but "is there work here that has to be described before it can be
 * done", and the answer is still no.
 *
 * It is worth restating under the new model, because the old argument leaned on
 * the shipped list — "the list is already the instruction, and a better one:
 * stamped, versioned, refusing an exemption shorter than a sentence" — and there
 * is no shipped list to lean on. The argument survives in a stronger form. A
 * prompt is prose the HOST composes and delivers in a context: unstamped,
 * unversioned, unaddressable, and gone when the canvas moves. A checklist here
 * is items, in this app's own store, each with an id an agent can name, an
 * author, a time, and a tick per target that says who made it and whether it
 * came through the MCP door. Every one of those is a thing a prompt cannot be,
 * and offering one beside them would be offering a second, worse place to write
 * the same thing down.
 *
 * The day this app grows something a person would sensibly write prose for —
 * "hold this epic's changes to the security items first" is the honest candidate
 * — this line becomes `true` and `context.prompt` is read where that ordering is
 * decided. Until then it stays false and says why, because a capability declared
 * "just in case" is indistinguishable from one that works.
 *
 * ## The mode, and what it is now told
 *
 * One epic-scoped mode, which becomes an ordinary tab in the mode row beside
 * every other module's. `scope: 'epic'` matters for two separate reasons now.
 * An epic-scoped mode is told which epic is open by `roadmap.context`, on load
 * and on every switch — which is what makes "the paper this epic is aimed at"
 * offerable as a target without anybody typing a slug. And a context is the only
 * message carrying `kehikko`, which is what the remembered choice is keyed by.
 *
 * ## Storage, and why THIS module asks for it when Atlas and References do not
 *
 * `storage: true` makes the host frame this page with `allow-same-origin`, so it
 * keeps its real origin instead of running opaque. Modules that hold nothing and
 * ask the host for everything are right to declare `false`; an origin would be a
 * thing they had no use for.
 *
 * This module is different in the one way that matters — it OWNS the checklists
 * and the ticks, serves them from its own `/api`, and takes writes. Opaque, that
 * combination has a hole in it:
 *
 *   - An opaque page's fetches to its own `/api` are CROSS-origin, because its
 *     origin is `null` and matches nothing. So the server has to answer with
 *     permissive CORS or the app cannot read its own checklist.
 *   - Permissive CORS means any page anywhere can read this origin. Including
 *     `/app`. Including the write ticket printed into it. Journeys had exactly
 *     that hole and it was demonstrated rather than theorised, with a
 *     `curl -H 'Origin: https://evil.example'` that came back carrying both the
 *     permissive header and the ticket.
 *
 * That is not a weakness in the ticket; the ticket was never an authorization
 * check. It is what happens when a program that holds data is given no origin to
 * hold it under. Declaring storage closes it at the root: with a real origin this
 * page's scripts and its `/api` calls are ordinary same-origin requests, no CORS
 * header is sent at all, and a stranger reading `/app` gets nothing back.
 *
 * The sandbox is weakened by exactly what that costs, which is little. The
 * origin this page regains is `127.0.0.1:7860`; the host is on `127.0.0.1:4181`.
 * Different ports are different origins, so the page still cannot reach into the
 * host — it can only reach itself, which is all it asked for.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  /**
   * Parsed rather than shipped as a bare object.
   *
   * The protocol package is explicit that its schemas are a convenience and
   * never the host's check — the host runs its own copy over what arrives on the
   * wire. That cuts both ways: running it HERE is the cheapest way for this app
   * to learn it has written a manifest no host will accept, and to learn it when
   * this file is imported rather than from a host's refusal in somebody else's
   * log.
   */
  protocol: PROTOCOL,
  id: ID,
  name: 'Checklist',
  version: VERSION,
  summary:
    'Checklists somebody wrote, held against one issue, merge request, pull request or paper at a time — nothing here ships a list.',
  /**
   * What an agent should do about this module, given that it is here.
   *
   * Not the summary. The summary says what this IS, for a person deciding
   * whether to place it. This says what its PRESENCE OBLIGES, and a host
   * composes it into the prompt every agent on the canvas is handed —
   * attributed to this module, because it is this module's claim rather than
   * the host's.
   *
   * Written as instructions to somebody who has just arrived and does not know
   * the checklist exists, since that is exactly who reads it. Bounded at 1024
   * characters by the protocol, so every sentence here is one an agent that read
   * nothing else would still act correctly on.
   */
  guidance:
    'Work here is held to checklists somebody wrote — nothing is hardcoded, so read them rather than assuming. '
    + 'Call `checklists` to see what exists, then call it again with a checklist id and the thing you are working '
    + 'on (a ref like gh#105, or an epic whose paper it is) to see what is still owed FOR THAT TARGET. Ticks are '
    + 'per target: the same list held against two issues keeps two separate sets, so finishing one says nothing '
    + 'about the other. Before calling anything done, satisfy each item or say plainly which you could not, and '
    + 'why. You MAY tick, with `check_item`, under your own name — every tick records that it came through the MCP '
    + 'door and a person can take it back with one press. So tick what you actually did, and leave what you cannot '
    + 'judge. If no list fits, `create_checklist` makes one, but look first: two lists saying nearly the same thing '
    + 'is the easiest damage to do here.',
  entry: '/app',
  modes: [{ id: 'checklist', label: 'Checklist', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'Checklists somebody wrote, and ticking one off against a specific issue, change or paper.',
  },
  extensions: { emits: [FORMAT], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['events:emit', 'state:keep'],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})

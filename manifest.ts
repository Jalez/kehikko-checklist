import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.checklist'
export const VERSION = '1.0.0'

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
 * tab to give the page, and which one question the app would like to be allowed
 * to ask if there is anybody there to ask.
 *
 * ## What it declares, and the longer list of what it does not
 *
 * - **`live:read` — declared, and it is the only thing declared.** It is the
 *   important one and it does two jobs here. `derive()` is a pure function of
 *   one `RefState`, and a host's reading of an epic contains exactly that, so
 *   **every tracker-derived item computes inside this app with no credentials
 *   of any kind**. The host holds the credentials, reads the trackers once on a
 *   refresh, and hands over what it read; four modules each polling a tracker
 *   would be four times the rate limit spent on one answer and four snapshots
 *   disagreeing on one screen. The second job is newer: a selection carries
 *   refs and nothing else, so `gh#105` does not say whether it is an issue or a
 *   pull request, and the only honest place to learn that is the bag the host
 *   filed it in — which is where References reads it from too.
 * - **`epics:read` and `steps:read` — NOT declared, where protocol 1 asked for
 *   both.** They were asked for so the page could offer the references a
 *   journey holds. Nothing needs them now: the canvas says what the reader has
 *   picked out, through `context.selection`, and a picker of our own beside it
 *   would be a second answer to "what are we looking at" that could disagree
 *   with the first. A capability that is asked for and never used is the fastest
 *   way to teach somebody to press yes without reading.
 * - **`selection:set` — not declared.** This app REACTS to a selection; it does
 *   not make one. Declaring it would be asking to change what every other pane
 *   on the canvas is looking at, in a module whose whole job is to answer a
 *   question about what is already picked.
 * - **`view:navigate` — not declared.** The checklist is a place a reader is
 *   already standing; what it wants is to be walked to, which is `roadmap.goto`
 *   arriving and needs no declaration.
 * - **`stage:report` — not declared.** Saying where work is belongs to whoever
 *   is doing it. A checklist has no opinion about that.
 * - **Tracker access — not declared, and there is no capability for it.** This
 *   app never speaks to GitHub or GitLab, holds no token, and has no code path
 *   that could.
 * - **`events:emit` — declared, and `emits` names one format.** This is a
 *   change, and the sentence that used to stand here is worth answering rather
 *   than deleting. It said: emitting a notification every time a box is ticked
 *   is a panel full of noise, and `consumes` is not implemented anywhere yet,
 *   so declaring it would be declaring an intention this app cannot act on.
 *
 *   The second half stopped being true. The protocol grew `roadmap.event`, the
 *   host grew a bus that reads `consumes` out of every manifest and delivers,
 *   and there is now a module on the other end that shows what arrives.
 *
 *   The first half is still true, and it is why what this app emits is NOT a
 *   tick. A tick is a thing a person does in this pane, in front of them, and
 *   announcing it to a panel two inches away is telling somebody what they just
 *   did. What is announced instead is an agent coming through the MCP DOOR —
 *   which is the one thing that happens to this app that nobody watching the
 *   screen can see. That is the whole of the distinction: a notification is for
 *   what you would otherwise miss.
 *
 *   `consumes` stays empty. This app shows a checklist; a checklist that also
 *   showed other modules' announcements would be two panels in one pane.
 *
 * And per the protocol's own README: a declaration is not a request and is not
 * answered. The host refuses whatever it likes at every call whatever is written
 * here, so the page is built to be refused — a reading arriving is drawn as
 * enrichment, and its absence is drawn as `unasked` rather than as a verdict.
 *
 * ## `prompt: false`, deliberately, and this is the reasoning
 *
 * The protocol offers a module a prompt: a paragraph a person writes on the
 * canvas, aimed at one pane, composed by the host and delivered in every
 * context. Declaring it makes a host OFFER one. So the question is not "could
 * we find a use" but "is there work here that has to be described before it can
 * be done", and for this module the answer is no, three times over:
 *
 * - **The list is already the instruction, and it is a better one.** What a
 *   change owes is `checklist.json` — reworded, exempted and stamped with who
 *   decided and when, refusing an exemption shorter than a sentence. A prompt
 *   would be a second, unstamped, unversioned place to say the same thing, and
 *   the first thing it would be used for is the thing the store refuses: an
 *   item off the list with no reason recorded anywhere.
 * - **A prompt cannot reach anything a prompt would want to change.** Derived
 *   items are `case` arms in `derive()` and cannot be conjured from text; agent
 *   ticks arrive over MCP under an agent's own name; and the owner's tick is a
 *   gate whose entire value is that it comes from a person pressing a button on
 *   this app's own page. Instructions that can move none of those are
 *   instructions with nowhere to land.
 * - **Offering one would be a lie about what happens next.** A host that lists
 *   this pane as promptable tells a reader their paragraph will be used. It
 *   would be read, and then it would change nothing on screen.
 *
 * The day this app grows something a person would sensibly write prose for —
 * "hold this epic's changes to the security items first" is the honest
 * candidate — this line becomes `true` and `context.prompt` is read where that
 * ordering is decided. Until then it stays false and says why, because a
 * capability declared "just in case" is indistinguishable from one that works.
 *
 * ## The hand-written list, and why it did not make `prompt` true
 *
 * This module now holds a second kind of checklist: one a person types, kept
 * against the epic a PAPER is aimed at rather than against a change, and
 * editable by an agent through this app's own MCP door. It is the closest thing
 * this app has ever had to "a paragraph a person writes on the canvas, aimed at
 * one pane", so the argument above has to be answered rather than left standing
 * next to it.
 *
 * It stays `false`, and the reason is the same one the essay gives. A prompt is
 * prose the HOST composes and delivers in a context: unstamped, unversioned,
 * unaddressable, and gone when the canvas moves. A paper checklist is items, in
 * this app's own store, each with an id an agent can name, an author, a time and
 * a tick that says who made it and whether it came through the MCP door. Every
 * one of those is a thing a prompt cannot be. Offering a prompt beside it would
 * be offering a second, worse place to write the same thing down — which is
 * precisely the failure the third bullet above names.
 *
 * Nor does it change what is declared. The list is keyed by the epic, and the
 * epic already arrives in `roadmap.context` on the one epic-scoped mode below;
 * nothing about it needs a capability, because the material is this app's own
 * and the writes are its own doors. What DID change is what an emitted event
 * says: an announcement about a paper names its own epic, rather than being
 * filed under whichever one the canvas happened to be showing. See
 * `list/outbox.ts`.
 *
 * ## The mode, and the word that changed under it
 *
 * One epic-scoped mode, which becomes an ordinary tab in the mode row beside
 * every other module's. `scope: 'epic'` where protocol 1 said `journey`: that
 * rename is part of what raised the protocol number, and it is not cosmetic
 * here. An epic-scoped mode is told which epic is open by `roadmap.context`, on
 * load and on every switch, and that is the only inbound channel carrying WHERE
 * the reader is standing — which is what the one `live.get` is keyed to.
 *
 * ## Storage, and why THIS module asks for it when Atlas and References do not
 *
 * `storage: true` makes the host frame this page with `allow-same-origin`, so
 * it keeps its real origin instead of running opaque. Modules that hold nothing
 * and ask the host for everything are right to declare `false`; an origin would
 * be a thing they had no use for.
 *
 * This module is different in the one way that matters — it OWNS the list and
 * the ticks, serves them from its own `/api`, and takes writes. Opaque, that
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
 * hold it under — and here the data includes the owner's tick, which is the one
 * assertion on this whole list that is supposed to be unforgeable by anything
 * that is not a person at this machine. Declaring storage closes it at the root:
 * with a real origin this page's scripts and its `/api` calls are ordinary
 * same-origin requests, no CORS header is sent at all, and a stranger reading
 * `/app` gets nothing back.
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
    'What a change owes before it is somebody else’s problem, and what a paper still owes — the second one written by hand.',
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
   * the checklist exists, since that is exactly who reads it.
   */
  guidance:
    'Every change on this kehikko is held to a checklist, and the work is not finished when the ' +
    'code is finished — it is finished when the items are ticked. Before calling anything done, ' +
    'read the checklist for that issue, merge request or pull request and either satisfy each item ' +
    'or say plainly which you could not, and why. A tick is a claim somebody will rely on: do not ' +
    'tick what you have not actually done, and never tick on the owner’s behalf. Items you cannot ' +
    'judge are for a person — leave them, and say that you did. Papers have a second checklist, ' +
    'written by hand and kept against the epic: read it with paper_checklist before working on a ' +
    'paper, keep it current as you go, and tick what you finish — those you MAY tick, under your ' +
    'own name.',
  entry: '/app',
  modes: [{ id: 'checklist', label: 'Checklist', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about:
      'The list a change is held to, the hand-written list a paper is held to, and ticking what an agent may assert on either.',
  },
  extensions: { emits: [FORMAT], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['live:read', 'events:emit'],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})

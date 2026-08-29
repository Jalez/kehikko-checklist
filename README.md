# Checklist

What a change owes before it is somebody else's problem, what a paper still owes,
and what has been ticked against either.

An app first. It holds two DERIVED lists — what a merge request or pull request
owes, and what an issue owes — and every tick anybody has ever filed against a
reference, in its own store, beside the program. It also holds a second kind:
**hand-written lists, one per paper**, which nothing computes. It has its own
page, its own port and its own MCP door. A host may frame it, and then the items
a tracker answers compute too.

```bash
./run.sh                 # http://127.0.0.1:7860/app
PORT=7861 ./run.sh       # somewhere else
bun run register         # tell a host on this machine where it is
bun test && bun run typecheck
```

## What it does with nothing else running

- **Both lists in full**, with every reason, in the tracker's own words on either
  side. The reasons are the material: each was argued over on a real merge
  request, and they are the difference between a list read twice and one skimmed.
- **Its own store.** `data/checklist.json` is the list as somebody has since
  decided it — rewordings, exemptions with their reasons, items added and taken
  off, the two size thresholds — each stamped with who and when.
  `data/ticks.json` is every tick, under `(ref, item)`, with who said it, when, a
  note, and the head it was made against. `CHECKLIST_DATA` moves the directory.
  The whole claim of the module is that this directory can be copied to another
  machine, run, and be somebody's checklist.
- **The owner's tick.** The `agreed` item is a gate. An item asking whether a
  person has agreed to something, which the party doing the asking can tick, is a
  formality with a box beside it — so an agent is refused it over MCP, in words,
  and it is pressed here, on this app's own origin, holding a ticket this process
  minted.
- **The hand-written list, per paper.** See below.
- **Its MCP door**, `/mcp`: `mr_checklist` reads the list and where one reference
  stands, `check_mr` asserts the agent's half, and six more work the paper lists.

## The other kind of list: what a paper owes

Everything above is derived and scoped to a REFERENCE. This is neither.

A paper is the document an epic is aimed at — `kehikko-paper` reads the `.tex`
and is keyed by epic — and what a paper is still missing is a judgement no
program on this machine is in a position to make. So the second list is
**hand-written**, **keyed by the epic**, and **ordered by the person**, in
`data/papers.json` beside the other two files.

It is a third file rather than a section of `checklist.json` for one reason: that
file's reader answers an unparseable byte with the list as it SHIPPED, which is
right for edits and catastrophic for authored prose — there is no shipped paper
list to fall back to, so "empty" and "broken" would be indistinguishable. The
paper store therefore refuses to be quiet: it reports the trouble, on the card,
and blocks every write until the file parses. Migration is additive in the same
way the rest of this workspace does it to a database — every new field arrives
with a zod `.default()`, so a file written today opens under next year's schema.

**An agent may tick these, and that is not a reversal of the rule above.** The
`agreed` item is a gate because it asks whether a PERSON has agreed to something,
and the party doing the asking must not be able to close it; `check_mr` still
refuses it, in words. A hand-written paper item is a task somebody wrote down,
and an agent is often the one who did it. What makes that safe is that the record
says so: every tick names its author and whether it came through the MCP door,
the row prints "ticked by claude, over MCP", and one press takes it back.

Six tools, matching the two that were already there:

```
paper_checklist      the list for one epic's paper, or which papers have one
add_paper_item       a line on the end
check_paper_item     tick it, or done: false to take a tick back
reword_paper_item    the same item, sharper words, same id and same tick
move_paper_item      positions count from 1; past the end means the end
drop_paper_item      off the list for good, with its tick
```

Every one of them refuses in a sentence that names what to do instead, and
`position: "up"` is refused rather than read as 1 — a tool that silently
reordered somebody's list would be worse than one that failed.

**With no epic there is a screen, not an empty list.** `context.epic` is
nullable, and there are three ways to arrive at nothing: no host is framing this
page, a host is here and the canvas is on no epic, or nothing has spoken yet.
Each says which it is, and then offers the papers something has already been
written against, openable here. That is the same distinction `unasked` draws on
the other list — not having looked is not the same as having looked and found
nothing.

## What a host adds, and nothing else can

One question: `live.get` for the open epic. `derive()` is a pure function of one
`RefState`, so with a reading in hand every tracker-derived item — pipeline,
conflicts, threads, draft, size, the review mark, which issue it names — computes
**here**, with no credentials and no call to anybody's API.

The same answer does a second job. A selection carries refs and nothing else, on
purpose, so `gh#105` does not say whether it is an issue or a pull request. The
reading does: which bag a host filed a reference in is the only thing that says
what it is, and that is where this app reads it — the same place References reads
it from.

## How it degrades, which is the part that proves it is an app

With no reading for a reference, a derived item is **`unasked`** — never
`pending`, never `unknown`. Those two are answers arrived at by looking; this one
is not having looked, and the remedy is a different one. Seven verdicts in all
(`done`, `failed`, `pending`, `unknown`, `unasked`, `stale`, `todo`), each with
its own word on the row, because collapsing any pair of them would be this
program stating something it cannot know.

## The selection

`context.selection` decides what the page shows. With references picked out, each
gets a card: its rows, their verdicts, who ticked what and when, and how old the
tracker facts are. With nothing picked, the lists themselves.

**Every selected reference is drawn**, in the order the host sent them, each
collapsible with its count in the header. Showing only the first would hide ticks,
and a reference whose ticks are not drawn looks exactly like one with no ticks. A
ref the reading does not contain is an ordinary state, not an error: it comes back
as a standing that says `unasked`.

The reading is fetched on the epic CHANGING, never on a context arriving. A host
sends a context after every selection change anywhere on the canvas, and
refetching on each would blank this page at exactly the moment it is being asked
to say something.

## What the pane shows, and what decides it

Three things, and the context picks the default while the reader overrules it:
references picked out on the canvas, this paper's hand-written list, or the two
lists themselves. A tab row keeps all three reachable, because "the canvas
selected something" is a poor reason to make somebody's own checklist
unreachable.

The page learns that an agent has changed a paper list on the **same** two-second
poll that already exists to announce MCP calls to a host (`src/wire/emit.ts`) —
not on a second one. A paper announcement now carries its own epic rather than
taking the canvas's: an agent working one paper while somebody reads another
would otherwise file a true sentence under the wrong heading.

## Prompts

`declares.prompt` is **false**, deliberately. The list is already the instruction
and a better one — stamped, versioned, refusing an exemption shorter than a
sentence — and a prompt could reach nothing this app can act on: derived items are
`case` arms, agent ticks arrive over MCP under an agent's name, and the owner's
tick is a gate whose value is that a person pressed it. `manifest.ts` has the
argument in full and names what would have to become true for it to change.

## Security

`declares.storage: true`, and **no `server.cors`**. Framed opaque, this page's own
`/api` calls would be cross-origin, forcing a permissive
`Access-Control-Allow-Origin` — which lets any page in any tab read this origin,
including `/app`, including the write ticket printed into it. With a real origin
the page's fetches are ordinary same-origin requests, no CORS header is offered to
anybody, and the ticket is unreadable from outside. Measured:

```
$ curl -s -D - -o /dev/null -H 'Origin: https://evil.example' http://127.0.0.1:7860/app
HTTP/1.1 200 OK
cache-control: no-store
content-security-policy: frame-ancestors 'self' http://127.0.0.1:4181 …
                                                       # and no Access-Control-Allow-Origin

$ curl -s -X POST -d '{"ref":"gh#1","item":"agreed"}' http://127.0.0.1:7860/api/tick
{ "ok": false, "error": "that press did not come from this app’s own page" }
```

## Measured, not assumed

`bun test` covers the wire-independent half — 116 tests, including the paper
store, the additive migration, and every new tool's argument validation. The rest
was driven in a real browser with Playwright; the probes are in the job scratch
directory as `ck-verify.mjs` (handshake, selection, stored data), `ck-narrow.mjs`
(no horizontal overflow at 220/280/320/400px with every disclosure open),
`ck-untick.mjs` (the owner's tick, and withdrawing it), `ck-paper.mjs` (the
hand-written list, unframed: the no-paper screen, an item typed in the pane and
read back after a reload, an item and a tick arriving over MCP with no reload, a
reorder surviving a reload, and no horizontal overflow at 220/280/320/400/1200px
in both themes) and `ck-framed2.mjs` (the same pane framed by the host at 4181,
opening on the epic's paper because `roadmap.context` said which one).

A tick survives a restart because the store is a file: measured by killing the
server, starting it again with `run.sh`, and reading the same `2/3 ticked` back
through `/mcp` under a fresh process and a fresh ticket.

One bug was found that way and could not have been found any other: the host
frames modules with `allow-scripts allow-forms allow-popups allow-same-origin`
and **no `allow-modals`**, so the `window.confirm` that guarded withdrawing the
owner's agreement was ignored, returned `false`, and left the button doing nothing
with nothing on screen saying why. It is a two-press arm in the row now. See the
essay in `src/view/row.tsx`.

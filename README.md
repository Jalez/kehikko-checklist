# Checklist

Checklists somebody wrote, held against one issue, merge request, pull request
or paper at a time. **Nothing here ships a list.**

An app first. It holds every checklist a person or an agent has made, and every
tick anybody has filed on one — **inside the project those checklists are
about**, at `<project>/.kehikot/checklist/checklists.json`, as plain JSON beside
the work.
It has its own page, its own port and its own MCP door. A host may frame it, and
then it learns which project is open, which kehikko it is standing on, and what
the canvas has picked out.

```bash
./run.sh                 # http://127.0.0.1:7860/app
PORT=7861 ./run.sh       # somewhere else
bun run register         # tell a host on this machine where it is
bun test && bun run typecheck
```

## The model, which is one sentence long

A **checklist** is a named thing a person created. It is **applied to a target**,
and a tick belongs to the **(checklist, target, item)** triple — so the same list
held against `gh#105` and `gh#106` keeps two independent sets of ticks, because
those are two pieces of work and finishing one says nothing about the other.

A **target** is a tracker reference (`gh#105`, `!44`, `#12`) or a place in a
paper (an epic, optionally with a section of it). See `list/targets.ts` for what
a paper target IS and, in particular, for the honest account of what happens to
its ticks when the paper changes underneath them.

## What it does with nothing else running

- **The pick-or-create screen.** On first view in a kehikko there is no default
  and no guess: the container lists the checklists that exist and offers a box to
  start one. A checklist held against work is a claim about what that work owes,
  and a container that opened on somebody else's list would have a person ticking
  items off against a standard they never chose.
- **The checklist, and only the checklist.** One list, its items, and the ticks
  for whichever target is in front. There is no directory of references and no
  tab row; the target switch is one row, not a screen.
- **A store inside the project.**
  `<projectPath>/.kehikot/checklist/checklists.json` holds every list, every item
  and every tick for that project, with the `papers.json` it migrates from beside
  it. The folder names, the joins and the `.gitignore` text are
  `roadmap-module-protocol`'s, so four modules cannot spell them four ways.

  `.kehikot` is the app; a *kehikko* is one canvas. Both words appear in this
  repository and they do not mean the same thing — the folder takes the app's
  name because what is in it belongs to every canvas a person has rather than to
  one of them. Each module gets a folder of its own inside it, named after its id
  with `roadmap.` taken off, which is what lets this app keep two files without
  either needing a name that says whose it is, and what makes
  `rm -r .kehikot/checklist` a sentence somebody can say.

  **The path is the partition.** Nothing here is keyed by project, because the
  file that was opened is already one project's — switching project is opening a
  different file, not filtering a bigger one. Two projects cannot see each
  other's lists, and there is no code path by which they could.

  **`projectPath` is nullable, and null is not a guess.** No project open, or a
  host with no filesystem, and the container says there is nowhere to read or write
  and offers nothing to press. It does not fall back to this app's folder or to
  `process.cwd()`: a guessed location writes somebody's list into a repository
  they will never open, under a screen saying it was saved.

  **The folder is ignored, once.** `.kehikot/` — the whole of it, not this one
  module's folder inside it — is appended to the project's `.gitignore` the first
  time this module's folder is made, with a comment saying what it is and that
  removing the rule is how you share it. Append-only, never a rewrite: this is a
  file in the user's own repository.

  The search for a repository walks UP from the project, and the write stays at
  the project root. A real case forced that: the thesis at
  `…/CS-DEGREE/05_drafts/thesis_latex` has no `.git` of its own and sits inside
  the CS-DEGREE repository, so a `<project>/.git` check would have left its
  `.kehikot/` turning up in somebody's `git status` with nothing ignoring it. Git
  honours a `.gitignore` in any directory, so a rule beside the folder does the
  job without this app editing a file three levels up. A project with no `.git`
  anywhere above it gets nothing.
- **Its MCP door**, `/mcp`, with seven tools:

```
checklists             every list, or one of them held against a target
create_checklist       start one under a name
add_checklist_item     a line on the end
check_item             tick it FOR A TARGET, or done: false to take a tick back
reword_checklist_item  the same item, sharper words, same id and same ticks
move_checklist_item    positions count from 1; past the end means the end
drop_checklist_item    off the list for good, with its ticks on every target
```

Every one of them refuses in a sentence that names what to do instead, and
`position: "up"` is refused rather than read as 1 — a tool that silently
reordered somebody's list would be worse than one that failed. There is no
`forget_checklist`: removing a list takes every tick anybody ever made on it and
is the one irreversible act here, so it lives on the page behind a two-press arm.

## An agent may tick, and may never do it anonymously

An earlier version of this module had a hardcoded `agreed` item that an agent was
refused, in words, because an item asking whether a PERSON has agreed to
something, which the party doing the asking can tick, is a formality with a box
beside it.

That gate is gone with the hardcoded lists, and this is what it meant. Every item
here is a line somebody typed, and an agent is very often the one who did the
work — refusing the tick would leave a person hand-ticking work they watched
somebody else do. What survives is the half that was doing the actual work: the
tick is never anonymous about its origin. Every tick names its author and carries
`viaMcp`, the row prints "ticked by claude, over MCP" rather than a bare
checkmark, and one press takes it back. Somebody who wants an item only they may
tick writes it as a question and unticks what they disagree with.

## Remembered per kehikko, by the host

`roadmap.context` carries `kehikko: {id, name} | null` — the only thing that says
where this container is standing, because a module's page is loaded once and shown on
whichever canvas asks for it. The choice of checklist is remembered against that.

The host's kept state (`state.set`) is keyed by MODULE and by nothing else, so
the per-kehikko map lives inside the one opaque string it keeps for us; see
`list/keep.ts`, which never throws and turns anything it cannot read into no
memory at all. A **null kehikko is a real state** — a host need not have canvases
— and it gets its own screen: the container says it cannot tell where it is standing,
and then works anyway for the session.

## What was deleted, and why it was safe

This module used to hold three kinds of list. Two were DERIVED and hardcoded —
what a merge request owes and what an issue owes, whose items were `case` arms in
a `derive()` function and whose wording shipped in the program — with a settings
store on top for rewording them, exempting them per tracker and adding items. The
third was hand-written, one per paper, keyed by epic.

The derived half is **deleted**: `derive/`, `list/shipped.ts`, `list/store.ts`,
`list/view.ts`, `list/ticks.ts`, `src/live/`, the `mr_checklist` and `check_mr`
tools, `/api/standings`, `/api/known`, `/api/lists`, `/api/tick`, the seven
verdicts and the `live:read` capability. It was safe because **nobody typed any
of it**: the items were this program's own opinion about somebody else's work,
and the ticks against them were ticks on that opinion. Every mechanism that made
the opinion bearable existed only to soften it, so removing the opinion left
nothing with a subject.

The paper half is **migrated**, once and idempotently, on read: a hand-written
list of what a paper owes is not a special kind of thing under the new model — it
is an ordinary checklist held against a paper target. Every line, every id, every
tick with its author, its time, its `viaMcp` and its note comes across, and
`papers.json` is left on disk. See `list/checklists.ts` and
`test/migration.test.ts`.

The move out of `data/` is a second one, and it is a script rather than a read
because this store has no project column — nothing in the old file says which
project any of it belongs to, so a program that picked one would be guessing:

```bash
bun dev/migrate.ts /absolute/path/to/project           # says what would move
bun dev/migrate.ts /absolute/path/to/project --apply   # moves it
```

It copies, reads the new file back **off disk**, checks every checklist, item
and tick survived, and only then renames `data/checklists.json` to
`data/checklists.json.migrated` — renamed, never deleted. A migration that
half-happens leaves somebody's lists in two places with nothing to say which is
current, which is worse than one that never started. See `test/migrate.test.ts`.

Two arguments from the deleted files were carried rather than deleted with them,
because they are still true: the store **refuses to write when its file will not
parse** (for authored prose, "empty" and "broken" must not be indistinguishable,
and there is no shipped list to fall back to), and **ordering is the array's
order and not an `order` column** (two sources for one fact, and a partial write
leaves two items claiming position 3).

## Removal is a two-press arm, not `window.confirm()`

Measured, in the host's own frame:

```
[console] Ignored call to 'confirm()'. The document is sandboxed, and the
          'allow-modals' keyword is not set.
confirm() inside the checklist frame returns: false
```

The host frames modules with `allow-scripts allow-forms allow-popups
allow-same-origin` and no `allow-modals`, which is a reasonable sandbox and not
something this module should ask to widen for one dialog. `confirm` returns
`false`, the handler returns early, the button does nothing at all, and there is
nothing on screen saying why. So the second press is asked for in the row, where
it can be seen, and it says the same sentence the dialog used to.

## Prompts

`declares.prompt` is **false**, deliberately. A prompt is prose the host composes
and delivers in a context: unstamped, unversioned, unaddressable, and gone when
the canvas moves. A checklist here is items in this app's own store, each with an
id an agent can name, an author, a time, and a tick per target that says who made
it and whether it came through the MCP door. `manifest.ts` has the argument in
full and names what would have to become true for it to change.

## Security

`declares.storage: true`, and **no `server.cors`**. Framed opaque, this page's
own `/api` calls would be cross-origin, forcing a permissive
`Access-Control-Allow-Origin` — which lets any page in any tab read this origin,
including `/app`, including the write ticket printed into it. With a real origin
the page's fetches are ordinary same-origin requests, no CORS header is offered
to anybody, and the ticket is unreadable from outside. Measured:

```
$ curl -sI -H 'Origin: https://evil.example' http://127.0.0.1:7860/app | grep -i access-control
                                                       # nothing at all

$ curl -s -X POST -d '{"op":"create","name":"x"}' http://127.0.0.1:7860/api/checklist
{ "ok": false, "error": "that press did not come from this app’s own page" }
```

## Measured, not assumed

`bun test` covers the wire-independent half — 153 tests across the store, where
it lives and what it refuses (a null project, a relative path, and either level
of the folder — `.kehikot/` or `checklist/` — resolving outside the project after
`realpath`), the `.gitignore` gaining its rule exactly once and being found
through a repository several levels up, the move out of `data/`, the migration of
a real `papers.json`, the per-kehikko memory, target identity, every MCP tool's
argument validation, and the components. The rest was driven in a real
browser with Playwright; the probes are in the job scratch directory as
`ck-new.mjs` (the pick-or-create screen, a checklist created in the UI and read
back after a reload, the same list against two targets holding two independent
sets of ticks, a tick made over MCP appearing with no reload, the migrated paper
lists, and no horizontal overflow at 220/280/320/400/1200px in both themes),
`ck-kehikko.mjs` (the memory: picked on one kehikko, surviving a reframe, asked
again on a second kehikko, still its own on the first, and the null-kehikko
screen) and `ck-realhost.mjs` (the same container framed by the real host at 4181,
opening on the pick screen, the choice surviving a full host reload, and the
epic's paper offered as the target).

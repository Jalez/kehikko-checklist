# Checklist

Checklists somebody wrote, each **held against** the things a person assigned it
to — issues, merge requests, pull requests, a paper, one file of it, one heading
in it — and shown wherever one of those is in front of the reader. **Nothing
here ships a list.**

An app first. It holds every checklist a person or an agent has made, what each
is held against, and every tick anybody has filed on one — **inside the project
those checklists are about**, at `<project>/.kehikot/checklist/checklists.json`,
as plain JSON beside the work.
It has its own page, its own port and its own MCP door. A host may frame it, and
then it learns which project is open, where in a paper the reader is, and what
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

A checklist **is held against** one or more targets. That is a stored property of
the list — `targets`, a list of keys in the file — set on the list's edit page or
through `hold_checklist`, and by nothing else.

## A list's targets are assigned, and the reading page shows what is in front

The owner said it three times, and this is the third:

> "I want to be able to connect one or more checklists in papers case to sections
> or tex files and I want that to stick. … I dont want it to be able to change on
> the fly, only when I am in edit mode of that checklist. I want to be able to
> separately access a list of checklists available in the project. But by default
> when I am scrolling in a paper i want to see the checklist(s) that I have
> assigned for that section/file in question. … Or, in the case of selecting a
> specific issue or an mr or a pr, I want to see the checklists specific to those
> issues etc. Its all about knowing what is selected or seen in the app that's
> important in the consumer/provider relationships."

Two versions of this module missed it. The first aimed one list at whatever the
reader had scrolled to. The second kept one list on screen and, on every scroll,
chose among the targets that list had TICKS against — a pairing came into being
the first time somebody ticked something, and never before — calling anywhere
else "not held here" and offering a press to hold it there. The owner's own store
said what was wrong with both: seven chapter checklists and `"ticks": {}`. Every
one of them was about a chapter, and not one of them was held against anything,
because nothing had been ticked yet. The connection they asked for could not be
written down.

So it is written down. `list/holding.ts` is the argument and `showing` is the
whole of the decision:

- **What every list is held against.** Facts about the lists, made by a person on
  the edit page, durable, in the file.
- **Where the reader is.** The ladder under their passage — section, file, paper,
  narrowest first — and the references the canvas has selected. Facts about the
  moment. Together they are "what is selected or seen".

Every list held against something in front of the reader is shown, against that
target, with that target's ticks. A list held against the whole paper is in
front of a reader anywhere in it, and one held against a file is in front of a
reader in any section of it — the search walks outward, because a claim about
the paper is a claim about everywhere in it. Where a list is held against a
section and the file around it, the closer one is shown. **Nothing is invented**:
a reader four chapters from the one a list is about sees the other lists, or
none, and one line saying so with the way to every checklist beside it.

Several apply at once, and they are all shown — "the checklist(s)" is plural.
Seven chapter lists and one for the whole thesis means a reader in chapter 3 sees
two, stacked, each foldable. A list held against `gh#105` and against the file
the reader is in, with `gh#105` selected, is in front of them twice, and is
shown twice, each instance saying which target it is; collapsing that to one
would be this program picking. Selected references lead, in the canvas's order.

**Nothing on the reading page changes what a list is held against.** The row
that read `Reading <file>` with a `change` press, the screen that said "not held
here" with a press to hold the list there, and the sentence about nothing having
been ticked yet are all gone — the owner called them useless, and they were,
because the thing they explained no longer happens. What survives is one muted
line under each name saying which of its targets these ticks belong to, because
two lists of ticks with nothing saying which is which is the two-halves-
disagreeing failure this workspace keeps finding.

`release` never deletes a tick: the ticks against a released target stay in the
file and come back the moment the target is held again, because "I no longer
want this list in front of me in chapter 3" and "forget what was done in chapter
3" are two sentences and only the first was said. A tick made over the MCP door
against a target the list is not held against holds it, and the sentence back
says so — an agent that names a reference has named it, which is the opposite of
a list re-pointing itself because somebody scrolled.

## The ladder the reader is standing on

The host broadcasts a `passage` — a file, a place in it, and the words that were
there — and this module opens the file through its own fence, finds the heading
those bytes fall under, and reads **the whole paper**, **the file**, or **the
section**: a title and the paragraphs beneath it, up to the next heading of the
same or a shallower level. Three rungs, no passage rung, and the reason there is
no fourth is in `list/scope.ts`. The ladder is a position and nothing else: it
is never trimmed, never offered to the host, never remembered. There used to be
a grain filter in the container header — `section` / `file` / `paper` — which
trimmed the ladder one list was looked for on; it went with that model, and the
page now sends an EMPTY offer once it is hosted, so a host still holding a grain
for this container lets it go. `src/app.tsx` says why that is safe to say now and
was not before.

The scanner is this module's own, small, and honest about what it does not read —
`file/sections.ts` — for the reason `kehikko-notes/notes/annotations.ts` argues:
modules meet through the host or not at all, and making the paper module this
one's data source would be a dependency neither manifest declares.

The edit page offers the paper's own files and the headings inside each of them,
found by the same scanner through the same fence (`file/outline.ts`,
`/api/outline`, asked for while a list is being edited rather than on every
context). A paper begins at the nearest directory holding a `.tex` that declares
a `\documentclass`, climbing from the file the reader is in — so the page keeps
the last file of a paper it saw for the session, which is the one place a
position outlives its context, allowed because it decides only which files are
OFFERED and never which are held. With no file ever seen it says to open the
paper, and still offers the whole paper from the epic alone. **The box is still
there at every size**, because a reference must not be blocked by a picker.

## Three screens: what is in front, one list's edit page, and every list

The **reading page** is the default and answers "what is in front of me":
every instance — a list's name, its count, which target these ticks belong to,
and the items, tickable. Nothing on it changes a list, a row is a mark and a
line of text with no furniture beside it at any size, and one press per instance
leads to its edit page. A strip at the bottom leads to every checklist.

The **edit page** is where a list is changed: what it is **held against** — the
targets it has, each releasable with one press, and a picker of the paper's
files and headings, the canvas's selected references, and a box for a reference
— and then add a line, press one to reword it, move it up or down, take it off,
and remove the checklist. Nothing on it is ticked, because an edit is a change to
the LIST: an item added is added for every target it is held against, and an
item removed takes every tick on it with it. The sentence explaining how ticks
are KEYED lives here, beside the targets it is about. `Done` goes back to where
the reader came from.

**Every checklist** is the third screen, reached on purpose from the reading
page and never in front of it: every list by name, how many targets each is held
against — a list held against nothing is shown nowhere on the reading page, and
this row is the one place that says so — a press to open one, a box to start
one, and the way to copy one from another project. A new list opens on its edit
page, because the next thing to do with it is say what it is held against.

## What it does with nothing else running

- **What is in front, and only that.** No pick-or-create screen on first view,
  no remembered choice, no default and no guess: the reading page opens on the
  lists a person assigned to where they are, which may be none, and says so in
  one line. The screen that lists every checklist is one press away.
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
- **Its MCP door**, `/mcp`, with eight tools:

```
checklists             every list and where each is held, or one of them held against a target
create_checklist       start one under a name
hold_checklist         hold it against a ref, a paper, a file or a heading — or release: true
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
`viaMcp`; `check_item` answers the agent with "… is ticked for `<target>`, by
`<name>`"; and one press takes it back. Somebody who wants an item only they may
tick writes it as a question and unticks what they disagree with.

**The row no longer prints it.** It used to read "ticked by claude, over MCP",
and the owner's judgement is that in a 220-pixel column that is not information:

> "in checklist, information about what checklist items is and isn't written by
> Claude is not important information, get rid of it."

So the display went and the record did not — `by` and `viaMcp` are still written,
still stored, still in the file and still in what the MCP door says back. What
made an agent's tick safe was never the badge under it; it was that the claim is
reversible by the person who can judge it, and that is a property of the row,
which still has it at every size. See the essay on `ItemRow` in
`src/view/here.tsx` for which half of the old argument that overtakes.

## Nothing is remembered per kehikko, and `state:keep` is no longer declared

This module used to remember which checklist was picked, per kehikko, through
the host's kept state (`list/keep.ts`), and open on it. There is no pick any
more: what a container shows is every checklist held against what the reader is
looking at, and the holding is stored on the list in the project's own file. A
remembered pick beside that would be a second answer to "which list is in front
of me", and the two would disagree the first time the reader scrolled. So
`list/keep.ts` is gone, `state:keep` is not declared, the kept string a host may
still hold for this module is ignored on the greeting, and a null kehikko needs
no screen of its own — nothing is keyed by it.

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
`test/migration.test.ts`. Under assignment such a list comes across **held
against its paper**, ticks or no ticks, because being about one paper was the
whole meaning of the old store's key.

**Targets are migrated the same way**, on read, once. A file written before
`targets` was stored has no such field on any list, and under that version a
tick WAS the assignment — so every list gets exactly the targets its tick map
already named, and a list with no ticks gets `[]`, which is the truth of the
owner's own file: seven chapter lists, held against nothing, waiting to be held
on their edit pages. No tick is touched. The field is `optional()` in the schema
rather than defaulted, deliberately, so that an absent array (an older file)
and an empty one (somebody released every target) stay two different facts and
a release does not undo itself on the next read. `test/targets.test.ts` opens a
copy of the owner's real store and asserts all of it.

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

`bun run test` covers the wire-independent half — 310 tests across the store,
where it lives and what it refuses (a null project, a relative path, and either
level of the folder — `.kehikot/` or `checklist/` — resolving outside the project
after `realpath`), the move out of `data/`, the migration of a real
`papers.json`, target identity, holding and releasing (`test/targets.test.ts`,
which also opens a copy of the owner's real store — seven chapter lists and no
ticks — and asserts every list, item and tick survives the read and comes
across held against nothing), every MCP tool's argument validation, `/api/here`
against a project with two chapters and two lists, the components (with every
case on the reading page asserting the absence of the old `Reading` /
`change` / "not held here" row beside whatever it asserts the presence of), the
section scanner against the owner's real thesis, the scope ladder as a table of
cases, which lists are in front of a reader as another one
(`test/holding.test.ts`, whose fixture is a paper with several chapters, a list
per chapter and one for the whole thing, and a reader who walks out of the
chapter a list is about and back into it, because the bug it exists to prevent
cannot happen in a document with one section in it), and the fence —
`test/confine.test.ts` exists entirely to try to get past it.

happy-dom performs no layout, so what fits at a size is measured in a browser
or not at all. Two Playwright probes are in the repository; a third needs no
Playwright:

```bash
PLAYWRIGHT=/path/to/playwright CHROME=/path/to/chrome-headless-shell \
  node dev/room.probe.mjs     # what fits at 220x300, 320x200, 460x360, 900x700
                              # (drives the previous page's selectors; its numbers
                              #  are the reading `src/view/room.ts` was written on)
  node dev/theme.probe.mjs    # the host's theme, both ways, at both machine settings

# A copy of a real thesis project, a scratch server kept out of ~/.roadmap, and
# the headless shell alone — see the header of dev/here.probe.html.
ROADMAP_MODULES_DIR=/tmp/ck-probe-registry PORT=7899 bunx vite
chrome-headless-shell --headless --disable-gpu --no-sandbox --virtual-time-budget=40000 \
  --dump-dom 'http://127.0.0.1:7899/dev/here.probe.html?project=/private/tmp/ck-probe-project' \
  | grep -o 'PROBE:[^<]*'
```

`here.probe.html` is what this model was actually driven with, in Chromium,
against a copy of the owner's thesis with its seven real chapter lists. It held
chapter 1's list against chapter 1, chapter 3's against chapter 3 and against
`gh#105`, and the thesis-wide list against the paper, all through the app's own
door, then walked a reader through the paper at 220x300 and printed what was on
screen:

```
main.tex                                -> Thesis paper checklist @ the whole paper 0/0
chapters/1_introduction.tex             -> Thesis paper checklist @ the whole paper 0/0 | Chapter 1 … @ 1_introduction.tex 0/7
chapters/3_methods.tex, §Research design-> Thesis paper checklist @ the whole paper 0/0 | Chapter 3 … @ 3_methods.tex 0/13
chapters/3_methods.tex, §Study context  -> the same two
chapters/5_discussion.tex               -> Thesis paper checklist @ the whole paper 0/0
nothing open                            -> Thesis paper checklist @ the whole paper 0/0
chapters/3_methods.tex, gh#105 selected -> Chapter 3 … @ gh#105 0/13 | Thesis paper checklist | Chapter 3 … @ 3_methods.tex 0/13
nothing open, gh#105 selected           -> Chapter 3 … @ gh#105 0/13 | Thesis paper checklist @ the whole paper 0/0
nothing open, gh#900 selected           -> Thesis paper checklist @ the whole paper 0/0
```

None of the old row was on screen at any move. A line ticked in chapter 3 read
`1/13`, still read `1/13` after walking to chapter 1 (where chapter 1's list
read `0/7`) and back, and the thesis-wide instance beside it was untouched. The
edit page listed `3_methods.tex` and `gh#105` as the holdings, its picker opened
over the frame with the seven real files and the held one marked, and releasing
and re-holding `3_methods.tex` from it changed the count from 2 to 1 to 2. `All
checklists` listed 8 rows; `Back` and `Done` both led back to the same two
instances. `document.scrollWidth` equalled the frame's width at 900, and the
console carried no error. The one thing that probe could not settle is the
900x700 label of the edit press, because a `ResizeObserver` under virtual time
did not fire before the dump; at 220x300 it is the glyph, as `room.ts` says.

Three probes went with the model they measured — `passage.probe.mjs` (one list
following a reader, which is the thing the owner asked to stop), `filters.probe.mjs`
(the grain filter) and `picker.probe.mjs` (the target switcher on the reading
page). One finding from the last of them survives in `file/outline.ts`: the file
declaring `\documentclass` leads the list, because alphabetically `main.tex` came
third under two files that sort ahead of it. And one from the filters probe
survives as a rule in `src/app.tsx`: an empty `roadmap.filters` offer is a CLAIM
the host acts on by pruning the container's stored choice, which is why it is
sent now — once, when it is true at every moment — and was withheld before.

`room.probe.mjs` is the reading `src/view/room.ts` is built on. At 220x300 with
six ordinary items this module used to spend 160 of its 300 pixels above the
first item and show none of them whole; it now spends 78, the items own the rest
of the frame and scroll inside it with the name and the target pinned above, and
a small scroll settles one pixel off an item boundary rather than through the
middle of a line. A component test cannot say any of that: happy-dom has no
layout, so `test/room.test.ts` holds the thresholds and the probe holds the
pixels they came from.

## No second frame, because the host already drew the first one

The page used to draw itself a card — `rounded-lg border bg-card` on the section
— inside a container the host had already given a border, a header and rounded
corners of its own, and the shell around it added `p-2` on top. That is a box in
a box, and the gap between the two edges is space taken off the thing somebody is
reading. The owner said it of a sibling first ("the Learning module doesn't need
a separate container inside it — none of the other modules have that either") and
then of this one, so it is a standing rule rather than one module's taste.

Both are gone: the card's border, its corners, its `bg-card`, and the shell's
padding. What stayed is every `border-t` — the rules **between** rows, between
the header and the target strip, above a refusal. Those are not the frame being
complained about; they are what makes a list read as rows instead of one block,
and they now run the full width of the container the way the host's own do. The
`relative overflow-hidden` pair stayed too, and neither half is decoration: see
the essay on it in `src/view/edit.tsx`.

Padding survives in exactly four places, each drawn only on the screen that needs
it: the `<h1>` block, which exists only when nothing is framing this page and
would otherwise sit against the window edge; the store's refusal and the
no-kehikko note, both bordered boxes of their own that read as the host's chrome
if they touch the host's edge; the "reading that checklist" sentence and the
no-project screen, which are loose prose with no row to carry the inset for them.

Measured with `dev/room.probe.mjs`, six items, before → after:

```
              chrome above item 1   asked   fully visible   item row   item text
  220x300     83 → 74               545→527   2 → 2         202 → 220  164 → 182
  320x200     83 → 74               405→387   1 → 2         302 → 320  264 → 282
  460x360     83 → 74               376→376   6 → 6         442 → 460  404 → 422
  900x700    101 → 92               343→325   6 → 6         882 → 900  844 → 862
```

Nine pixels of fixed chrome at every size (the shell's eight, the border's one)
and eighteen pixels of width on every row, at every size, paid on every item —
which is why 320x200 shows two whole items where it showed one. The edit page
gained the same nine (129 → 120 above its first row). `document.scrollWidth`
equals the frame's width at all four sizes, so nothing overflows sideways.

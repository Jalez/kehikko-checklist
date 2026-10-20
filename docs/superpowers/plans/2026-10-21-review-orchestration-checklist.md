# Checklist states: implementation plan (C1)

> Part of the review-orchestration master plan
> (Jalez/kehikko-review `docs/superpowers/plans/2026-10-21-review-orchestration.md`).
> Contract C1 is binding; names and shapes below are not to be changed.

**Goal:** an item on a checklist, for one target, is **passed, failed, not
applicable or unchecked**, each with its note and who set it. The page shows and
sets all four; MCP `check_item` gains `state`; `checklists` prints them with
counts; a tick the person made cannot be changed or removed over MCP.

**Contract C1**

- A tick gains `state: 'passed' | 'failed' | 'na'`. A tick without `state` (old
  data) reads as `'passed'`. No tick means unchecked.
- MCP `check_item` gains optional `state` (default `'passed'`). `done: false`
  still removes the tick. A tick whose `viaMcp` is false (the person made it on
  the page) cannot be changed or removed over MCP: refuse with a sentence.
- MCP `checklists` prints `[x]` passed, `[!]` failed, `[-]` n/a, `[ ]`
  unchecked, each with by / note, and the counts
  `passed N · failed N · n/a N · unchecked N`.

**Decisions**

- "The person's tick" is a tick with `viaMcp: false`. Nothing else can make one
  (the MCP door always writes `viaMcp: true`, and the page never does).
- The same guard also stops an agent dropping an item that carries a person's
  tick (`drop_checklist_item` removes the item's ticks), because otherwise the
  rule is a door with a window beside it.
- A page press replaces any tick, an agent's or its own. Only the MCP door is
  refused.
- `Held.done` keeps its meaning (ticks that are `passed`), and `Held.counts` is
  new. Storage and `targetsOf` count ticks of any state, unchanged.
- Shape plus text, never colour alone: passed `✓`, failed `✗`, n/a `–`,
  unchecked an empty box; each row also carries a visible word.

## Files

- `list/shapes.ts`: `TICK_STATES`, `TickState`, `state` on `tickSchema`, `stateOf`.
- `list/checklists.ts`: `Op.tick.state`, `Counts`, `Held.counts`, `countsOf`,
  the person's-tick guard on `tick` and `drop`.
- `doors.ts`: `check_item` schema and call, `listText` (marks, counts),
  the page route parses `state`.
- `src/store/ask.ts`: `Edit` tick gains `state?`.
- `src/view/here.tsx`: the row shows and sets the four states.
- `README.md`: states, the guard, the tool signature.
- Tests: `test/checklists.test.ts`, `test/doors.test.ts`, `test/render.test.tsx`,
  `test/storage.test.ts` (old ticks).

## Tasks (each: failing test, run it, implement, run it, commit)

1. **Shapes.** Test in `test/checklists.test.ts`: a stored tick with no `state`
   reads as `passed`; a tick written with `state: 'failed'` reads back failed;
   `stateOf(null)` is `'unchecked'`; an unknown state in a file is refused by
   the schema. Implement in `list/shapes.ts`.
2. **Store writes a state.** `change({op:'tick', ..., state})` stores it
   (default passed); `done:false` removes it whatever its state; a `na` tick
   still holds the list against the target; a second tick on the same item
   replaces the state and the note. Implement `Op.tick.state` and the write.
3. **Counts.** `held(...).held.counts` is `{passed, failed, na, unchecked}`;
   `done` stays the passed count; an old tick counts as passed. Implement
   `countsOf`.
4. **The person's tick is safe from MCP.** In the store: a tick with
   `viaMcp:true` over a `viaMcp:false` tick (set, change state, or `done:false`)
   is refused with a sentence and the file is byte-for-byte unchanged; the same
   over an agent's own tick works; `viaMcp:false` over an agent's tick works;
   `drop` with `viaMcp:true` of an item carrying a person's tick is refused.
5. **MCP door.** `check_item` takes `state` (`passed | failed | na`), refuses
   any other value and `state` with `done:false`, and returns the new listing.
   `checklists` prints `[x]`, `[!]`, `[-]`, `[ ]` and the counts line; the
   refusal for a person's tick reaches the agent as an error. Old ticks print
   `[x]`. Update the existing `N ticked` assertions.
6. **Page route.** `POST /api/checklist {op:'tick', state}` parses and passes
   `state`, refuses an unknown one with 400; the page may overwrite an agent's
   tick.
7. **The page.** Render tests (`test/render.test.tsx`): the four states each
   have a mark and a visible word and `data-state`; pressing the row sets
   passed (and clears it when already passed); "Failed" and "N/A" buttons send
   `state:'failed'` / `'na'` and, pressed again, clear; the header shows
   `passed/total` and, when non-zero, `· N failed` and `· N n/a`; a note shows
   under a failed or n/a row. Implement in `src/view/here.tsx`.
8. **Storage view and old data.** Tests: a file with ticks written before this
   change loads, Storage counts them, and `checklists` reads them as passed.
9. **README, typecheck, full test run, PR.**

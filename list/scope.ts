import type { FilterChoice, FilterGroup } from 'roadmap-module-protocol'

import { MAX_TARGET_PART, part, targetKey, type Target } from './targets.ts'

/**
 * How much of a paper one container is about, and the ladder that decides it.
 *
 * ## The sentence this file implements
 *
 * > "Checklists that are connected to a paper (again consumer/provider
 * > relationship) should be connected to the file itself or each title and their
 * > content. Right now at least in thesis it seems to not care nor does it
 * > change the checklist when you go between files in the paper module or jump
 * > between sections (aka multiple title + its paragraphs)."
 *
 * So the container follows the reader. That was already half-built and nobody
 * had noticed: `list/targets.ts` has held `{ kind: 'paper', epic, section }`
 * since the day the paper target was written, and `src/app.tsx` was passing
 * `section: null` and never anything else. What was missing was not the model.
 * It was the *reading* — this module reacted to `selection` and not to
 * `passage`, so nothing ever told it which file, let alone which heading.
 *
 * ## The rungs, and why they are these three
 *
 * `kehikko-notes/notes/scope.ts` solved the same shape of problem for notes and
 * its ladder is passage → page → document → everything. This one is different
 * because the UNIT is different, and the difference is worth being explicit
 * about rather than copying a ladder that does not fit.
 *
 *   1. **The paper.** One epic's document, whole. This is what the module did
 *      before this change and it remains the top of the ladder — "the paper owes
 *      an abstract" is a real claim and is not a claim about any file in it.
 *   2. **The file.** `chapters/3_methods.tex`. The owner's thesis is seven
 *      files, so moving between them is the most frequent movement they make,
 *      and it was completely invisible to this container. This rung is the
 *      single biggest thing the report asked for.
 *   3. **The section.** A heading and the paragraphs under it, up to the next
 *      heading of the same or a shallower level. That is the report's "multiple
 *      title + its paragraphs", said exactly.
 *
 * **There is no passage rung, and that is the deliberate departure.** Notes has
 * one, because a note is a thing pinned to a range of bytes and can be re-found
 * by its quote when the bytes move. A TICK is not. A tick is filed under a
 * target KEY that has to still name the same thing next week, and
 * `list/targets.ts` spends two screens explaining why a page number or a byte
 * offset is the worst possible name for a place in a document — add a paragraph
 * to chapter two and every offset after it points at different prose, silently.
 * A `passage` rung would mint a target per selection, so a reader dragging over
 * a sentence would file work against a range that will not exist after the next
 * edit, and would accumulate a target per drag. The ladder stops where the names
 * stop being stable, which is at a heading with a `\label` on it.
 *
 * ## And the rung below the ladder: this does not apply to a ref
 *
 * A checklist held against `gh#105` has no passage and never will. `elsewhere`
 * is that state, it is the state every non-document target is in, and every
 * function here answers it by doing nothing — which is the whole of "non-document
 * targets must keep working exactly as they do".
 *
 * ## Narrowing hides ticks, and hiding them is the dangerous half
 *
 * The same lesson as the file this ladder is modelled on, transposed. Notes
 * narrows a list of NOTES and so it counts the notes it dropped. Nothing here
 * drops an item: an item belongs to the list and is drawn at every rung. What
 * narrowing moves is which TICKS are in front of you — ticks live per (list,
 * target, item), so walking from the paper into section 3 replaces eight ticks
 * with none.
 *
 * That is the same lie in the same shape, and it is worse for being about
 * somebody's own record of work: a reader who ticked eight items yesterday and
 * walks into a section today sees `0/12` and no explanation, which is
 * indistinguishable from this app having lost them. So `narrow` below counts
 * every tick this paper holds outside the current rung, the row says so in a
 * short line, and the widen control is one press. A reader who cannot see what
 * was narrowed cannot tell narrowing from a bug.
 *
 * ## No PLACE is remembered — but the GRAIN is, and the difference is the whole
 * of why the ladder is now a filter
 *
 * Worth stating twice as loudly as it used to be, because this module declares
 * `state:keep` AND now offers the ladder to the host over `roadmap.filters`,
 * and the host remembers a filter choice against a container forever.
 *
 * What `state:keep` holds is WHICH CHECKLIST is open on which kehikko, and that
 * is all — see `list/keep.ts`. No scope, no target and no path is ever written
 * into the kept string, deliberately: a remembered place would outlive the
 * context that justified it, and the container would come back tomorrow showing
 * a section of a file the reader is not in.
 *
 * That rule survives the filter untouched, and the reason is the distinction
 * `offerAt` below is built on. The host is not offered the rungs as PLACES —
 * `chapters/3_methods.tex`, `sec:meth-design` are never in the offer and never
 * travel — it is offered them as GRAIN: `section`, `file`, `paper`. WHICH
 * section and WHICH file goes on being derived, on every context, from the
 * passage the reader is standing in, and is stored by nobody. What the host
 * remembers is how narrow this reader likes it, which is a real preference and
 * exactly the sort of thing that ought to survive a restart: somebody who works
 * section by section should still be working section by section tomorrow, in
 * whatever file they open tomorrow.
 *
 * ## The argument this reverses, and why it was answerable
 *
 * An earlier version of this module offered nothing, and `src/app.tsx` carried
 * the case: the ladder is a POSITION and not a choice, there is no fixed option
 * set to enumerate, and a remembered rung would be wrong by design. The
 * observation was right and the conclusion did not follow. A position has no
 * fixed option set; the grain of a position has one, and it is three words long.
 * The refusal cost the page a permanent strip of controls in a container the
 * owner runs at 220 pixels wide, which is the whole reason `roadmap.filters`
 * exists.
 *
 * What the earlier argument was protecting is still protected, by the two
 * paragraphs above and by `grainAt`, which falls back rather than honouring a
 * remembered rung that does not exist here.
 *
 * This file is pure. It takes an epic, a resolved place in a file, and the
 * targets a list already has ticks against, and it returns strings and numbers.
 * That is what lets the ladder be tested with a table of cases and no browser,
 * no store and no `.tex` file — the same separation `src/view/room.ts` already
 * keeps for the pixels.
 */

/** Where in a document the reader is, once the file has actually been read. */
export interface Placed {
  /** The file's path relative to the project root, as the reader's passage named it. */
  file: string
  /** The stable id of the heading they are standing in, or null for a file with no headings above them. */
  section: string | null
  /** What that heading says, for the screen. Never an identifier. */
  title: string | null
}

export type Scope =
  /**
   * This checklist is not held against a paper, so there is nothing for a
   * passage to narrow. Every ref target lives here, permanently and correctly.
   */
  | { kind: 'elsewhere' }
  | { kind: 'paper'; epic: string }
  | { kind: 'file'; epic: string; file: string; id: string }
  | { kind: 'section'; epic: string; file: string; id: string; title: string }

/**
 * A component of a target key, made out of a name that was not chosen to be one.
 *
 * `part()` in `list/targets.ts` refuses whitespace, slashes and control
 * characters, because `/` is the key's own delimiter and a component holding one
 * could shape a key rather than name something in it. A file path is nothing but
 * slashes, so they become `:` — a character `part()` allows, that already appears
 * in every `\label{sec:meth-design}` in the owner's thesis, and that reads as a
 * separator rather than as a word.
 */
function slug(name: string): string {
  return name
    .trim()
    .replace(/\//g, ':')
    .replace(/\s+/g, '-')
    /* Backslashes and control characters go: a heading may be `\emph{x}` and a
       key component may hold neither. Written as escapes rather than as literal
       bytes, for the reason `part()` gives in `list/targets.ts` — a literal
       control byte in a source file is one an editor eventually loses.
       Hyphens are deliberately KEPT: every `\label{sec:meth-design}` in the
       owner's thesis has one, and stripping them would make this program's id
       differ from the name the author chose. */
    .replace(/[\\\u0000-\u001f\u007f]/g, '')
}

/**
 * The id for a file within a paper: its path, without the extension.
 *
 * `chapters/3_methods.tex` becomes `chapters:3_methods`. The extension goes
 * because it says nothing a reader needs and costs four of the eighty characters
 * a key component gets; the directory stays because two files called
 * `introduction.tex` in two folders are two different files, and a bare stem
 * would file both under one target and quietly merge somebody's ticks.
 */
export function fileId(relative: string): string | null {
  const dot = relative.lastIndexOf('.')
  const cut = dot > relative.lastIndexOf('/') && dot > 0 ? relative.slice(0, dot) : relative
  return part(slug(cut))
}

/**
 * The id for a section: the file it is in, then the heading's stable name.
 *
 * `chapters:3_methods#sec:meth-design`. The file is part of it because a
 * `\label` is only unique within a document by convention, and two chapters
 * both labelling something `intro` is an ordinary thing to find in a thesis.
 *
 * The name is the `\label{}` where there is one, because that is a name somebody
 * chose to be stable and is exactly what `list/targets.ts` asks for. Where there
 * is none it is a slug of the heading's words, and that is the weaker case the
 * essay in that file already names: rewording the heading moves the ticks to a
 * new target and leaves the old ones sitting under a name nothing points at any
 * more. They are not lost — the target switcher lists every target a list has
 * ticks against — but they are stranded, and the cure is a `\label`, which is a
 * thing the author can do and this program cannot.
 *
 * ## Too long is answered by not narrowing, rather than by truncating
 *
 * A key component is bounded at eighty characters. A truncated id is worse than
 * no id: two sections whose first eighty characters agree would become one
 * target, and ticks made on one would appear on the other with nothing anywhere
 * saying why. So an id that will not fit returns null, the ladder falls back a
 * rung, and the reader gets the file — a coarser answer rather than a wrong one.
 */
export function sectionId(file: string, label: string | null, title: string): string | null {
  const name = part(slug(label ?? title))
  if (!name) return null
  const whole = `${file}#${name}`
  return whole.length > MAX_TARGET_PART ? null : part(whole)
}

/**
 * Which rung the reader is on.
 *
 * One function, and every screen and every door reads its answer rather than
 * testing `passage?.path` for itself. Three places asking the same question
 * three ways is how a container ends up printing a file name in its heading and
 * drawing a whole paper's ticks underneath it.
 *
 * `epic` is what makes any of this possible: a paper target IS an epic, so a
 * container standing on no epic has no paper to narrow and correctly answers
 * `elsewhere` no matter how precisely the reader is pointing.
 */
export function scopeOf(epic: string | null, placed: Placed | null): Scope {
  if (!epic || !part(epic)) return { kind: 'elsewhere' }
  if (!placed) return { kind: 'paper', epic }
  const file = fileId(placed.file)
  if (!file) return { kind: 'paper', epic }
  /* The section id is checked again here even though the server minted it with
     `sectionId`. It travels over a socket and through a JSON body, which is
     where a component that is no longer a name would arrive from — and a scope
     naming an unspellable target would build a key nothing could read back. A
     refusal falls to the file rung, which is a coarser answer rather than a
     wrong one. */
  if (placed.section && placed.title && part(placed.section)) {
    return { kind: 'section', epic, file: placed.file, id: placed.section, title: placed.title }
  }
  return { kind: 'file', epic, file: placed.file, id: file }
}

/**
 * The rung a TARGET sits on, which is the question the screen actually asks.
 *
 * `scopeOf` answers "where is the reader"; this answers "what are these ticks
 * about", and the two are the same only until somebody widens. A reader standing
 * in section 3 who presses "the file" is still standing in section 3 — the
 * passage has not moved, and it must not, because this module does not set one —
 * but the ticks in front of them now belong to the file. Drawing the heading
 * from `scopeOf` at that moment would print the section's title over the file's
 * ticks, which is the disagreement the widen control exists to make visible.
 *
 * `placed` is passed in only for the TITLE. A section id is a `\label` or a
 * slug, and neither is what the author wrote at the top of the section; where the
 * reader is genuinely in the section the target names, the real words are known
 * and are much better to read. Where they are not — a widened target, a section
 * an agent named directly, a reader who has moved on — the id is printed and is
 * honest about being an id.
 */
export function scopeOfTarget(target: Target | null, placed: Placed | null): Scope {
  if (!target || target.kind !== 'paper') return { kind: 'elsewhere' }
  if (!target.section) return { kind: 'paper', epic: target.epic }
  const cut = target.section.indexOf('#')
  const file = placed && fileId(placed.file) === (cut === -1 ? target.section : target.section.slice(0, cut))
    ? placed.file
    : cut === -1
      ? target.section
      : target.section.slice(0, cut)
  if (cut === -1) return { kind: 'file', epic: target.epic, file, id: target.section }
  const title = placed?.section === target.section && placed.title ? placed.title : target.section.slice(cut + 1)
  return { kind: 'section', epic: target.epic, file, id: target.section, title }
}

/** The target a scope is held against, or null when nothing is. */
export function targetOf(scope: Scope): Target | null {
  if (scope.kind === 'elsewhere') return null
  if (scope.kind === 'paper') return { kind: 'paper', epic: scope.epic, section: null }
  return { kind: 'paper', epic: scope.epic, section: scope.id }
}

/**
 * One rung out, or null at the top.
 *
 * A section widens to its file rather than straight to the paper, because those
 * are two different climbs and a reader moving between subsections of one
 * chapter wants the chapter. The file's id is recoverable from the section's:
 * the section id is `<file>#<name>` by construction and `#` is the one character
 * `sectionId` puts between them.
 */
export function widen(scope: Scope): Scope | null {
  if (scope.kind === 'section') {
    const cut = scope.id.indexOf('#')
    return cut === -1 ? { kind: 'paper', epic: scope.epic } : { kind: 'file', epic: scope.epic, file: scope.file, id: scope.id.slice(0, cut) }
  }
  if (scope.kind === 'file') return { kind: 'paper', epic: scope.epic }
  return null
}

export interface Narrowed {
  scope: Scope
  /** The target in front, which is what the ticks on screen belong to. */
  target: Target | null
  /**
   * How many ticks this paper holds that the current rung is not showing.
   *
   * A number and not a list, deliberately, and the reasoning is the one
   * `kehikko-notes` wrote for the same field: the list is one press away — widen,
   * or open the target switcher, which already names every target with ticks —
   * and printing it here would defeat the narrowing the reader asked for. What
   * the number does is make the narrowing VISIBLE, which is the whole difference
   * between a scope and a filter nobody mentioned.
   *
   * It counts every OTHER paper target of the same epic: the whole paper, other
   * files, sibling sections. Not ref targets, which are a different piece of work
   * entirely and were never being shown here.
   */
  elsewhere: number
  /**
   * One rung out, or null at the top of the ladder.
   *
   * No longer a control on this page: climbing back is the host's filter now,
   * drawn from `rungsOf` below. It stays here because it is the plain statement
   * of "there is somewhere wider than this", which `rungsOf` walks to build the
   * ladder and which the tests put cases to. A field nothing reads would be
   * removed; this one is read by the thing that replaced its button.
   */
  wider: Scope | null
}

/**
 * What one screen is about, and an honest count of what it is not showing.
 *
 * `targets` is what `targetsOf` already answers — every target this checklist
 * has ticks against, which the page fetches anyway to draw the switcher. So the
 * count below costs nothing on the wire and cannot disagree with the switcher
 * beside it, which is the point of deriving it from the same array rather than
 * asking the server a second question.
 */
export function narrow(scope: Scope, targets: { target: Target; done: number }[]): Narrowed {
  const target = targetOf(scope)
  if (!target || scope.kind === 'elsewhere' || scope.kind === 'paper') {
    return { scope, target, elsewhere: 0, wider: widen(scope) }
  }
  const here = targetKey(target)
  const elsewhere = targets
    .filter((one) => one.target.kind === 'paper' && one.target.epic === scope.epic && targetKey(one.target) !== here)
    .reduce((sum, one) => sum + one.done, 0)
  return { scope, target, elsewhere, wider: widen(scope) }
}

/**
 * How much of a paper a reader wants in front of them, in three words.
 *
 * The same three words as `Scope['kind']`, minus `elsewhere`, and that is not a
 * coincidence worth hiding behind a mapping table: a grain IS a rung's kind, and
 * spelling them differently would give two names to one idea and a function to
 * convert between them. `elsewhere` is excluded because it is not a rung — it is
 * the state of not being on the ladder at all, which is every ref target.
 */
export type Grain = 'section' | 'file' | 'paper'

/**
 * One rung, flattened to the two things the page needs of it.
 *
 * Not a `Scope`: a scope carries the file's real path and the section's real
 * words, which are for the SCREEN. A rung is for building a target and for
 * naming a grain, and carrying the prose into it would invite somebody to print
 * a rung — at which point the offer would start naming places, which is the one
 * thing this must not do. See the essay at the top of this file.
 */
export interface Rung {
  grain: Grain
  epic: string
  /** The `section` component of the target this rung means. Null for the whole paper. */
  section: string | null
}

/**
 * The ladder under one scope, narrowest first.
 *
 * Walked with `widen` rather than assembled from the parts, so there is exactly
 * one statement anywhere of what is one rung out of what. A section widens to
 * its own file and not straight to the paper, and this ladder inherits that for
 * free — which is what makes the offer say `section, file, paper` for a reader
 * standing in a labelled section, and `file, paper` for a reader in a file with
 * no heading above them.
 *
 * Empty for `elsewhere`, which is how a checklist held against an issue offers
 * nothing at all.
 */
export function rungsOf(scope: Scope): Rung[] {
  const out: Rung[] = []
  let at: Scope | null = scope
  while (at && at.kind !== 'elsewhere') {
    out.push({ grain: at.kind, epic: at.epic, section: at.kind === 'paper' ? null : at.id })
    at = widen(at)
  }
  return out
}

/**
 * The ladder as one string, which is what React actually depends on.
 *
 * `rungsOf` builds a fresh array out of a fresh `Scope` on every render, and an
 * effect or a memo keyed on either would fire on every render — which for the
 * offer means a `roadmap.filters` message several times a second, and for the
 * target means a fetch that sets state that re-runs the fetch that sets the
 * state. A string compares by value, so nothing downstream moves until the
 * reader does.
 *
 * The parsing half is `rungsFrom`, and everything that consumes a ladder takes
 * the STRING and parses it rather than closing over the array — the same
 * arrangement `src/app.tsx` already uses for the candidate targets, and for the
 * same reason: a value that is not in the dependency list is a value that can be
 * stale, and one parsed back out of the key cannot be.
 *
 * Tab and newline are safe separators because a rung holds an epic slug and a
 * target component, and `part()` in `list/targets.ts` refuses whitespace in both.
 */
export function ladderKey(rungs: Rung[]): string {
  return rungs.map((rung) => [rung.grain, rung.epic, rung.section ?? ''].join('\t')).join('\n')
}

/** The ladder back out of its key. Total: anything unparseable is an empty ladder. */
export function rungsFrom(key: string): Rung[] {
  if (!key) return []
  const out: Rung[] = []
  for (const line of key.split('\n')) {
    const [grain, epic, section] = line.split('\t')
    if ((grain !== 'section' && grain !== 'file' && grain !== 'paper') || !epic) continue
    out.push({ grain, epic, section: section || null })
  }
  return out
}

/** The group id. Named because three functions here have to agree on it. */
const GRAIN = 'grain'

/**
 * What each grain is called on screen — and note what none of them says.
 *
 * `This file`, not `3_methods.tex`. The label IS the offer, the offer is
 * remembered by the host against this container forever, and a label naming a
 * file would be a PLACE written into somebody's stored preference — the exact
 * thing the essay at the top of this file refuses. It would be wrong within the
 * minute, too: the reader opens the next chapter and the stored words still name
 * the last one.
 *
 * The page goes on printing which file and which section, because that is a fact
 * about what is on screen rather than a choice anybody made, and a host cannot
 * know it. Truth in the page, choice in the header.
 */
const SAYS: Record<Grain, string> = {
  section: 'This section',
  file: 'This file',
  paper: 'The whole paper',
}

/**
 * What this container can be narrowed by right now, for `roadmap.filters`.
 *
 * ## Only the rungs that exist, which is why this takes a ladder and not nothing
 *
 * A reader standing in a file with no labelled heading above them has no section
 * rung. Offering one anyway would put an option in the header that cannot be
 * honoured — pressed, the page would either do nothing or invent a target for a
 * section that is not there — and a control that does nothing is
 * indistinguishable from a broken container. So the offer is a function of where
 * the reader is standing, and `src/app.tsx` re-sends it when they move, the way
 * `kehikko-notes` re-sends when the count in its label changes.
 *
 * ## Three answers and not two, because `[]` is a CLAIM rather than a silence
 *
 * This returns null as well as `[]`, and the difference cost a real bug — found
 * by driving the actual host rather than by reasoning about it.
 *
 *   - **`[]` is "there is nothing here to narrow".** Those are the protocol's
 *     words, and this host acts on them: it prunes the container's stored choice
 *     against whatever is currently offered (`settle` in its `host/filters.ts`),
 *     so an empty offer ERASES the reader's grain. That is right when it is
 *     true, and it is true for a ref — an issue has no document and never will.
 *
 *   - **`null` is "nothing to say yet".** A paper target with no passage
 *     resolved under it is a ladder of ONE rung, and a group with a single
 *     option is a control a person can press to no effect. But it is not the ref
 *     case: a passage is usually a moment away, because on a reload this module
 *     is framed before whichever module broadcasts one. Answering `[]` there was
 *     a filter that worked perfectly and never survived a refresh — chosen,
 *     stored, and wiped a second later by this page's own next message.
 *
 * So a ladder of one says nothing and leaves the last true offer standing; only
 * a ladder of none withdraws. `src/app.tsx` adds the third source of null: it
 * has not heard from its own server yet, so it does not know which of these it
 * is in.
 *
 * ## `fallback` is the NARROWEST rung, which is unusual and deliberate
 *
 * Every sibling module's fallback is its widest, unnarrowed state. This one's is
 * `section` wherever a section exists, because this module's resting state is
 * following the reader — that is the sentence the whole ladder was built to
 * implement, and a container that came back from the host's "put it all back"
 * showing the whole paper would have reset to something nobody ever asked for.
 * It is also what the host falls back to when a remembered grain is not on offer
 * here, which is the case `grainAt` defends independently.
 */
export function offerAt(key: string | null): FilterGroup[] | null {
  if (key === null) return null
  const rungs = rungsFrom(key)
  const narrowest = rungs[0]
  if (!narrowest) return []
  if (rungs.length < 2) return null
  return [
    {
      id: GRAIN,
      /* Read after the host's own words, which begin "filter what …", so this is
         a noun phrase rather than a sentence or an imperative. */
      label: 'how much of the paper',
      options: rungs.map((rung) => ({ id: rung.grain, label: SAYS[rung.grain] })),
      fallback: narrowest.grain,
    },
  ]
}

/**
 * Which grain this context is asking for, of the ones actually available.
 *
 * Null when there is no ladder, which is a different answer from `paper` and has
 * to stay different: no ladder means nothing here narrows anything, and the
 * target in front is whatever proposed it.
 *
 * ## A remembered grain that is not on offer here falls back
 *
 * This is the case the whole design turns on. The host remembers a grain per
 * container, forever; a reader who chose `section` in a chapter full of headings
 * and then opens `main.tex`, which has none, comes back carrying a choice this
 * ladder cannot honour. Honouring it literally would build a target for a
 * section that does not exist and draw ticks filed under nothing. So an
 * unavailable grain becomes the narrowest rung that IS available — the same
 * value `offerAt` hands the host as its fallback, so the two halves cannot
 * disagree about what the recovery is.
 *
 * The host reconciles too, and is required to. But it cannot do it before this
 * module has offered anything, and the greeting goes out first — so the first
 * choice this page ever receives may name a grain from a version of this module
 * that no longer exists, or from a file the reader has already left. Two
 * programs each assuming the other got it right is how a stale value survives;
 * both defend, and this is our half.
 */
export function grainAt(chosen: FilterChoice | undefined, key: string): Grain | null {
  const rungs = rungsFrom(key)
  const narrowest = rungs[0]
  if (!narrowest) return null
  const want = chosen?.[GRAIN]
  const found = rungs.find((rung) => rung.grain === want)
  return found ? found.grain : narrowest.grain
}

/*
 * There used to be a `widenedTarget` here, and its disappearance is a change to
 * the model rather than a tidy-up.
 *
 * It answered "which target does this grain mean", null at the narrowest rung so
 * the server would go on resolving the passage itself. That was the right shape
 * while a grain was the only thing that could move a container off the rung the
 * reader was standing on — the target being, otherwise, whatever the moment
 * proposed.
 *
 * A target is not a property of the moment any more. It is a pairing somebody
 * made, and the grain's job changed with it: it no longer NAMES a target, it
 * trims the ladder that pairings are looked for in, from below. One function
 * does both halves now — `holdingAt` in `list/holding.ts` — because the rung a
 * grain names and the rung a pairing was found on have to be the same rung, and
 * two functions computing it were two places for it to differ. The `decided`
 * rule this one carried is kept there word for word: the narrowest rung decides
 * nothing and the server follows the reader; anything wider is a decision.
 */

/**
 * The file's own name, for a reader who is looking at one file.
 *
 * `saidOf` prints the whole relative path and should: it answers an agent that
 * may be standing anywhere. On screen the same string is noise of a particular
 * kind, in a column that is two hundred and twenty pixels wide, and what tells a
 * reader anything is the last segment. The full path is one hover away, as the
 * `title` of the element showing the short one.
 */
export function fileOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * What the container says it is showing, in the fewest words that still say it.
 *
 * The owner's standing complaint is too much prose in a narrow column, so this
 * is a label and not a sentence: it sits beside "Held against" on a row that
 * never folds away at any size.
 */
export function briefOf(scope: Scope): string {
  if (scope.kind === 'elsewhere') return ''
  if (scope.kind === 'paper') return 'the whole paper'
  if (scope.kind === 'file') return fileOf(scope.file)
  return scope.title
}

/**
 * The same ladder, spelled out for somebody with no screen in front of them.
 *
 * Deliberately beside `briefOf` and not in a component: these two must always be
 * the same ladder, and the way to keep them so is for the next person changing
 * one to be looking at the other. What differs is only how much is spelled out —
 * a label a reader glances at while reading the ticks under it, against a
 * sentence an agent is handed with nothing else around it.
 */
export function saidOf(scope: Scope): string {
  if (scope.kind === 'elsewhere') return 'This list is not held against a paper, so nothing in a document narrows it.'
  if (scope.kind === 'paper') return `The whole of the paper ${scope.epic} is aimed at.`
  if (scope.kind === 'file') return `The file ${scope.file} of the paper ${scope.epic} is aimed at.`
  return `The section “${scope.title}” of ${scope.file}, in the paper ${scope.epic} is aimed at.`
}

import { MAX_TARGET_PART, part, type Target } from './targets.ts'

/**
 * Where in a paper a reader is standing, as a ladder of the places a checklist
 * can be held against.
 *
 * ## The sentence this file implements
 *
 * > "Checklists that are connected to a paper (again consumer/provider
 * > relationship) should be connected to the file itself or each title and their
 * > content. Right now at least in thesis it seems to not care nor does it
 * > change the checklist when you go between files in the paper module or jump
 * > between sections (aka multiple title + its paragraphs)."
 *
 * So the container follows the reader. `list/targets.ts` has held
 * `{ kind: 'paper', epic, section }` since the day the paper target was
 * written; what this file adds is the *reading* — the passage the host
 * broadcasts, resolved to the file and the heading the reader is in, and
 * spelled as the rungs a list might be held against.
 *
 * What this file does NOT do, any more, is decide which of those rungs the
 * container is about. It used to: a grain filter trimmed the ladder, `narrow`
 * counted the ticks the trimming hid, and `offerAt` handed the host a control
 * for it. All of that assumed one list, aimed by the moment. A list is held
 * against targets a person assigned (`targets` in `list/checklists.ts`), and
 * `showing` in `list/holding.ts` reads the ladder this file builds to find the
 * lists assigned to any rung of it. The ladder is a position and nothing else.
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
 * ## No place is remembered, and no grain either
 *
 * Nothing about a position is written down anywhere: not in the store, not in
 * the host's kept state (this module no longer declares `state:keep` — see
 * `manifest.ts`), and not in a filter. A remembered place would outlive the
 * context that justified it, and the container would come back tomorrow
 * showing a section of a file the reader is not in. What IS written down is
 * which rungs a list is held against, on the list, by a person; the position
 * is re-derived on every context and compared against that.
 *
 * There used to be a grain here — `section` / `file` / `paper`, offered to the
 * host over `roadmap.filters` and remembered per container — which trimmed the
 * ladder from below so a reader working file by file was not shown one
 * section's ticks. It went with the model it served. Under assignment the
 * ladder is not trimmed: every list held against any rung the reader is
 * standing on is in front of them, the narrowest rung per list, and a reader
 * who wants fewer lists in a section releases a target on the edit page. That
 * is a decision about the list, made once, and not a preference the host has
 * to keep. `src/app.tsx` says why the offer is now withdrawn rather than
 * merely not sent.
 *
 * This file is pure. It takes an epic and a resolved place in a file and
 * returns strings, which is what lets the ladder be tested as a table of cases
 * with no browser, no store and no `.tex` file — the same separation
 * `src/view/room.ts` keeps for the pixels.
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

/** How deep a rung is: the same three words as `Scope['kind']` minus `elsewhere`, which is not a rung. */
export type Depth = 'section' | 'file' | 'paper'

/**
 * One rung, flattened to the two things a target needs of it.
 *
 * Not a `Scope`: a scope carries the file's real path and the section's real
 * words, which are for the SCREEN. A rung is for building a target, and
 * carrying the prose into it would invite somebody to print a rung as though it
 * were a place somebody chose.
 */
export interface Rung {
  depth: Depth
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
 * free — `section, file, paper` for a reader standing in a labelled section,
 * `file, paper` for a reader in a file with no heading above them.
 *
 * Empty for `elsewhere`, which is how a reader with no paper open is on no
 * rung at all.
 */
export function rungsOf(scope: Scope): Rung[] {
  const out: Rung[] = []
  let at: Scope | null = scope
  while (at && at.kind !== 'elsewhere') {
    out.push({ depth: at.kind, epic: at.epic, section: at.kind === 'paper' ? null : at.id })
    at = widen(at)
  }
  return out
}

/**
 * The ladder as one string, which is what React actually depends on.
 *
 * `rungsOf` builds a fresh array out of a fresh `Scope` on every render, and an
 * effect or a memo keyed on either would fire on every render — for the fetch
 * that means a request that sets state that re-runs the fetch that sets the
 * state. A string compares by value, so nothing downstream moves until the
 * reader does.
 *
 * The parsing half is `rungsFrom`, and everything that consumes a ladder takes
 * the STRING and parses it rather than closing over the array — for the same
 * reason: a value that is not in the dependency list is a value that can be
 * stale, and one parsed back out of the key cannot be.
 *
 * Tab and newline are safe separators because a rung holds an epic slug and a
 * target component, and `part()` in `list/targets.ts` refuses whitespace in both.
 */
export function ladderKey(rungs: Rung[]): string {
  return rungs.map((rung) => [rung.depth, rung.epic, rung.section ?? ''].join('\t')).join('\n')
}

/** The ladder back out of its key. Total: anything unparseable is an empty ladder. */
export function rungsFrom(key: string): Rung[] {
  if (!key) return []
  const out: Rung[] = []
  for (const line of key.split('\n')) {
    const [depth, epic, section] = line.split('\t')
    if ((depth !== 'section' && depth !== 'file' && depth !== 'paper') || !epic) continue
    out.push({ depth, epic, section: section || null })
  }
  return out
}

/**
 * The file's own name, for a reader who is looking at one file.
 *
 * `saidOf` prints the whole relative path and should: it answers an agent that
 * may be standing anywhere. On screen the same string is noise of a particular
 * kind, in a column that is two hundred and twenty pixels wide, and what tells a
 * reader anything is the last segment. The full path is one hover away, as the
 * `title` of the element showing the short one.
 *
 * A file ID — `chapters:3_methods`, which is what `scopeOfTarget` has when the
 * reader is not in the file — is cut at its last `:` for the same reason, so a
 * list held against a chapter the reader is not in still reads as that chapter
 * and not as an address.
 */
export function fileOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.includes('/') ? -1 : path.lastIndexOf(':'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * What a rung is called on screen, in the fewest words that still say it.
 *
 * The owner's standing complaint is too much prose in a narrow column, so this
 * is a label and not a sentence: it sits under a checklist's name on the
 * reading page, saying which of its targets these ticks belong to.
 */
export function briefOf(scope: Scope): string {
  if (scope.kind === 'elsewhere') return ''
  if (scope.kind === 'paper') return 'the whole paper'
  if (scope.kind === 'file') return fileOf(scope.file)
  return scope.title
}

/**
 * The shape of an outline this file is willing to read, which is the part of
 * `file/outline.ts` that is names. Structural rather than imported, so that
 * this file — which the browser bundle imports for its functions — never
 * reaches through to a module that opens directories.
 */
export interface Named {
  files: { id: string; name: string; sections: { id: string; title: string }[] }[]
}

/**
 * What a target is called on a row: a reference by its reference, a paper by
 * the words a person would use for the place in it.
 *
 * Three sources, in the order they are trusted. The outline, when there is
 * one, because it is the scan the picker drew its buttons from and the row and
 * the button must not disagree about what a heading is called. Then the
 * reader's own position, because where the reader IS the section's real words
 * are known. Then the id, printed as honestly as `briefOf` can — a target from
 * another paper, or one whose heading has been renamed since, is what it is.
 */
export function labelOf(target: Target, placed: Placed | null, outline: Named | null): string {
  if (target.kind === 'ref') return target.ref
  if (!target.section) return 'the whole paper'
  if (outline) {
    for (const file of outline.files) {
      if (file.id === target.section) return file.name
      const heading = file.sections.find((one) => one.id === target.section)
      if (heading) return heading.title
    }
  }
  return briefOf(scopeOfTarget(target, placed))
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

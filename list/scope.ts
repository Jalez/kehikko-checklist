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
 * ## Nothing here is remembered
 *
 * Worth stating because this module declares `state:keep` and does remember
 * things. What it remembers is WHICH CHECKLIST is open on which kehikko, and
 * that is all — see `list/keep.ts`. No scope, no target and no path is ever
 * written into the kept string, deliberately: a remembered scope would outlive
 * the context that justified it, and the container would come back tomorrow
 * showing a section of a file the reader is not in. `src/app.tsx` goes further
 * and drops even the SESSION-local widen when the passage moves, for the same
 * reason.
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
  /** One rung out, for the control that climbs back. Null at the top of the ladder. */
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

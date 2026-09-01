import { readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import { fileId, sectionId } from '../list/scope.ts'
import { readCapped } from './open.ts'
import { dialectOf, sectionsIn } from './sections.ts'
import { contains, inside, rootOf } from './confine.ts'

/**
 * Every file of one paper, and every heading in each of them — which is what
 * the target picker offers instead of a text box.
 *
 * ## The sentence this file exists for
 *
 * > "In checklist you still can only type something there, you don't get a list
 * > of options to choose from (in the case where the checklist is targeting a
 * > paper it should offer a checklist for different chapters)."
 *
 * The screen that types a target is `TargetRow` in `src/view/checklist.tsx`, and
 * until this file it offered exactly three things: whatever the canvas had
 * selected, whatever this list already had ticks against, and a box. For a paper
 * that is one button — `thesis (the paper)` — and a box in which the only
 * spellable thing is a tracker reference. A reader who wanted the ticks for
 * chapter four had no way to say so except to walk into chapter four with
 * another module and let the passage narrow them there.
 *
 * ## Offering a list is not guessing, and that distinction is the whole design
 *
 * `src/view/choose.tsx` carries an essay titled "why there is no default and no
 * guess", and it would be easy to read this file as reversing it. It does not,
 * and the reason is worth writing down because the two will be read together.
 *
 * That essay refuses to CHOOSE for somebody: to open on a list they did not
 * pick, to hold their work against a target nothing named. Every sentence of it
 * survives — nothing here is preselected, nothing here is remembered, and a
 * checklist with no target still says so and still refuses to tick. What this
 * file removes is a different thing entirely: the requirement that a reader
 * SPELL a name this program minted. `chapters:3_methods#sec:meth-design` is not
 * a name anybody chose; it is a slug `list/scope.ts` builds out of a `\label`,
 * and asking a person to type it is asking them to reimplement `slug()` in their
 * head. Enumerating what exists so somebody can point at one is the opposite of
 * guessing — it is refusing to make them guess.
 *
 * So: the picker offers, it never preselects, and the box is still there.
 *
 * ## It does not ask the paper module, and that is not negotiable
 *
 * `file/sections.ts` argues this at length and this file inherits every word of
 * it: `kehikko-paper` has a real parser and could simply be asked for its
 * outline, and that would make one module's parser another module's data source
 * over a channel neither declares. Modules meet through the host or not at all.
 * So this opens the files itself, through the same fence, with the SAME scanner
 * — `sectionsIn`, imported, not copied. There is one heading scanner in this
 * module and this file did not add a second.
 *
 * ## Where a paper begins, which is the one genuinely hard question here
 *
 * A passage names one file. A paper is seven. Nothing on the wire says where the
 * document starts, and there is no protocol field for it — so this has to be
 * derived, and a derivation that is wrong is a picker offering somebody else's
 * files.
 *
 * The rule below: **climb from the reader's file until a directory holds a
 * `.tex` that declares a `\documentclass`, and stop there.** That is not a
 * heuristic about folder names, it is the definition LaTeX itself uses — the
 * file with the `\documentclass` is the document, everything it pulls in is part
 * of it, and it lives at the top of the tree by universal convention. Measured
 * against the owner's thesis: `main.tex` declares one, `chapters/*.tex` do not,
 * so a reader standing anywhere in that paper gets `thesis_latex` as the root
 * and all seven files under it.
 *
 * The alternatives, and why each is worse:
 *
 * - **Follow `\input` and `\include` from the root.** Correct, and it is the
 *   answer a real LaTeX tool gives. It is also a second parser — conditional
 *   inputs, `\subfile`, `\import`, path search rules — and `file/sections.ts`
 *   spends a paragraph refusing to grow into `kehikko-paper`. Listing the
 *   directory finds every file the reader can actually open, which is a superset
 *   of what is `\input` and is wrong only in the direction of offering a file
 *   that is not in the built document. A reader can see that and not press it.
 * - **The file's own directory, always.** Right for a flat paper and wrong for
 *   every thesis: standing in `chapters/3_methods.tex` you would be offered the
 *   six chapters and never `main.tex`, which is where the abstract and the
 *   claims a checklist is likeliest to be about actually live.
 * - **The project root.** Offers `README.md`, every `.md` in `docs/`, and the
 *   notes module's own scratch files as though they were chapters of the paper.
 *
 * **When no `\documentclass` is found anywhere on the climb** — a Markdown
 * paper, a chapter opened outside its project, a `.tex` tree written some other
 * way — the root falls back to the reader's own directory. That is a coarser
 * answer rather than a wrong one, which is the same fallback rule every other
 * refusal in this module takes.
 *
 * ## Bounded in four ways, because this reads a directory somebody else chose
 *
 * The fence in `file/confine.ts` decides WHETHER a path may be opened and is the
 * only thing standing between a passage and `~/.ssh`. It says nothing about how
 * much. So: the climb stops after `MAX_CLIMB` directories and never leaves the
 * project; the walk descends one level below the root and no further; at most
 * `MAX_FILES` files are read; and the whole outline stops after `MAX_TOTAL`
 * bytes. Every bound answers by returning less rather than by failing — a capped
 * outline offers the files it got to, and the box below it still types anything.
 *
 * ## And it returns headings, never contents
 *
 * The bound `file/open.ts` sets for itself holds here word for word: a file id,
 * a section id, a title and a level. Not a line of prose, not a quote, not a byte
 * count. The most a hole in this file can leak is which headings exist in a
 * project this caller can already read every checklist of.
 */

/** How far up from the reader's file a `\documentclass` is looked for. */
export const MAX_CLIMB = 4

/** How many files one paper may offer. Seven is a thesis; sixty-four is a mistake. */
export const MAX_FILES = 64

/** How many headings one file may offer. */
export const MAX_SECTIONS = 200

/** How much of a paper is read to build one outline. */
export const MAX_TOTAL = 8 * 1024 * 1024

/**
 * How much of a candidate root file is searched for `\documentclass`.
 *
 * It is in the preamble by definition — it is the first thing a LaTeX document
 * says — so a window rather than the file. What this prevents is reading eight
 * megabytes of chapter four in order to find out that it is not the root.
 */
const PREAMBLE = 4096

/** One heading, as the picker draws it. */
export interface OutlineSection {
  /**
   * The `section` component of the target this heading means — exactly what
   * `list/scope.ts` would mint for a reader standing in it.
   *
   * Built by `sectionId` and by nothing else, so that pointing at a heading here
   * and walking into it with the paper module produce the SAME target key. Two
   * spellings of one section would file a reader's ticks in two places and
   * neither would look wrong.
   */
  id: string
  /** The words at the top of it, as the author wrote them. Never an identifier. */
  title: string
  /** How deep, from `file/sections.ts`. Used to indent, never to compare across files. */
  level: number
}

/** One file of a paper. */
export interface OutlineFile {
  /** The path relative to the project root, which is what a `title` hover shows. */
  file: string
  /** The `section` component of the target that means this whole file. */
  id: string
  /** The last segment of the path, which is the only part that reads in 220 pixels. */
  name: string
  /** Every heading in it, in document order. Empty is an ordinary answer. */
  sections: OutlineSection[]
}

/** A paper, as much of it as the bounds allowed. */
export interface Outline {
  /** The paper's root, relative to the project. `''` when it IS the project root. */
  root: string
  files: OutlineFile[]
  /** Whether a bound stopped this short. Said on screen, never swallowed. */
  capped: boolean
}

/** Whether one file declares the document, read in a window rather than whole. */
function declares(path: string): boolean {
  const buffer = readCapped(path)
  if (!buffer) return false
  return buffer.subarray(0, PREAMBLE).toString('utf8').includes('\\documentclass')
}

/**
 * The paper's root directory, as an absolute real path, or the file's own
 * directory.
 *
 * The climb is bounded twice over: by `MAX_CLIMB`, and by the project root,
 * which it will not pass. Both matter — without the second, a reader whose file
 * is two directories under the project would have this walking into the
 * project's parent, which is somewhere the fence has never agreed to.
 */
function paperRoot(projectRoot: string, file: string): { root: string; declares: string | null } {
  let at = dirname(file)
  const first = at
  for (let climbed = 0; climbed <= MAX_CLIMB; climbed += 1) {
    if (!contains(projectRoot, at)) break
    let entries: string[]
    try {
      entries = readdirSync(at)
    } catch {
      break
    }
    for (const name of entries.slice().sort()) {
      if (dialectOf(name) !== 'latex') continue
      /* The declaring file's NAME comes back with the root, and not because it
         is tidy. `walk` puts it first in the offer: the owner's thesis directory
         also holds `README_overleaf.md` and `main_snippet.tex`, both of which
         sort before `main.tex`, so alphabetical order put the file holding the
         abstract third in a scrolling list in a 220-pixel column. Measured with
         `dev/picker.probe.mjs` against the real thing rather than guessed. */
      if (declares(join(at, name))) return { root: at, declares: name }
    }
    const up = dirname(at)
    if (up === at) break
    at = up
  }
  return { root: first, declares: null }
}

/** Every readable document under one directory, at most one level down. */
function walk(root: string, first: string | null, budget: { files: number; bytes: number }): string[] {
  const found: string[] = []
  const here: string[] = []
  const below: string[] = []
  let dirs: string[] = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      /* Dotfiles and `node_modules` are skipped by name rather than by asking
         whether they are interesting. `.kehikot` is this module's OWN store and
         a checklist file offered as a chapter of the paper it is about would be
         a particularly silly thing to draw. */
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (entry.isDirectory()) dirs.push(entry.name)
      else if (dialectOf(entry.name)) here.push(entry.name)
    }
  } catch {
    return found
  }
  here.sort()
  /* The document's own file leads, wherever it sorted. See `paperRoot`. */
  if (first && here.includes(first)) here.splice(0, here.length, first, ...here.filter((one) => one !== first))
  dirs.sort()
  for (const dir of dirs) {
    try {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        /* `isDirectory()` and not `isFile()`, deliberately. A symlink is neither
           — `Dirent.isFile()` is false for one — so testing for a file would
           silently drop a chapter somebody keeps behind a link, which is an
           ordinary way to write a paper, AND would be doing the fence's job in
           the wrong place and by accident. What decides whether a link may be
           followed is `inside()` below, once per file, on the path it actually
           resolves to. A walk that quietly excluded links would leave the fence
           untested and the legitimate case broken, which is the worst of both. */
        if (!entry.isDirectory() && dialectOf(entry.name)) below.push(join(dir, entry.name))
      }
    } catch {
      /* A directory that will not open is one this reader is not offered files
         from. Not an error: the rest of the paper is still an answer. */
    }
  }
  below.sort()
  /* Root files first and subdirectories after, which is not alphabetical and is
     deliberate: `main.tex` is where the abstract and the claims a checklist is
     likeliest to be about live, and sorting the whole set as strings would bury
     it under `chapters/`. Within each depth it is alphabetical, so a thesis
     numbered `1_introduction … 6_conclusion` reads in its own order. */
  for (const name of [...here, ...below]) {
    if (found.length >= budget.files) break
    found.push(name)
  }
  return found
}

/**
 * The paper a passage is standing in, or null when there is nothing to offer.
 *
 * Null for every refusal, with the same one word the fence uses and for the same
 * reason: three distinguishable refusals is an existence oracle. What it means
 * to the caller is always the same — the picker draws no files, says so in one
 * short line, and the box below it still types anything.
 */
export function outlineOf(projectPath: string | null | undefined, path: string): Outline | null {
  const projectRoot = rootOf(projectPath)
  if (!projectRoot) return null

  const real = inside(projectRoot, path)
  if (!real) return null

  const { root, declares: leads } = paperRoot(projectRoot, real)
  const budget = { files: MAX_FILES, bytes: MAX_TOTAL }
  const names = walk(root, leads, budget)

  const files: OutlineFile[] = []
  /*
   * One row per FILE, not per name that reaches it.
   *
   * The fence answers with a real path, so a symlink inside the paper —
   * `5_alias.tex -> 4_results.tex`, an ordinary way to keep a chapter under two
   * names — resolves to the file it points at and would otherwise be listed
   * twice. Both rows would carry the same `fileId`, so both would build the same
   * target key: a reader would see one chapter offered twice, press either, and
   * get the same ticks. That is not a cosmetic duplicate, it is two rows that
   * look like two pieces of work and are one.
   *
   * Deduplicated on the resolved relative path for exactly that reason, and NOT
   * on the name in the directory, which is the thing that differs.
   */
  const already = new Set<string>()
  let capped = names.length >= MAX_FILES
  for (const name of names) {
    const whole = join(root, name)
    /* Through the fence again, per file, rather than trusting that a directory
       inside the project only holds paths inside it. It does not: a symlink in
       `chapters/` pointing at `/etc` is an ordinary thing for a fence to be
       written against, and `readdirSync` does not resolve one. */
    const allowed = inside(projectRoot, whole)
    if (!allowed) continue
    const rel = relative(projectRoot, allowed)
    if (!rel || rel.startsWith('..')) continue
    const id = fileId(rel)
    if (!id) continue
    if (already.has(rel)) continue
    already.add(rel)

    const dialect = dialectOf(rel)
    let sections: OutlineSection[] = []
    if (dialect && budget.bytes > 0) {
      const buffer = readCapped(allowed)
      if (buffer) {
        budget.bytes -= buffer.length
        if (budget.bytes <= 0) capped = true
        const source = buffer.toString('utf8')
        for (const one of sectionsIn(source, dialect)) {
          if (sections.length >= MAX_SECTIONS) {
            capped = true
            break
          }
          /* A heading whose id will not fit a key component is dropped rather
             than truncated, which is `sectionId`'s own rule: two sections whose
             first eighty characters agree would become one target and ticks made
             on one would appear on the other. The file rung below it still
             works, which is the coarser answer this module always falls back
             to. */
          const sid = sectionId(id, one.label, one.title)
          if (!sid) continue
          sections.push({ id: sid, title: one.title, level: one.level })
        }
      }
    }

    const cut = rel.lastIndexOf(sep)
    files.push({ file: rel, id, name: cut === -1 ? rel : rel.slice(cut + 1), sections })
  }

  const rootRel = relative(projectRoot, root)
  return { root: rootRel.startsWith('..') ? '' : rootRel, files, capped }
}

import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { KEHIKOT_DIR, PAPER_MODULE, moduleFolder } from 'kehikot-module-protocol'

import { fileId, sectionId, type Placed } from '../list/scope.ts'
import { dialectOf, sectionAt, sectionsIn } from './sections.ts'
import { inside, rootOf } from './confine.ts'

/**
 * Turning a passage into a place in a paper, which is the only reason this
 * program opens a file it does not own.
 *
 * ## What it gives back, and what it deliberately never gives back
 *
 * A file id, a section id and the words of the heading. **No contents.** Not a
 * line, not a quote, not a byte count. That bound is what makes this affordable
 * at all: the fence next door is written against the possibility of somebody
 * pointing this at `~/.ssh/id_ed25519`, and the worst a hole here can leak is
 * whether a heading exists in a file — because there is no code path in this
 * module that returns what a file says.
 *
 * If a future change wants to show a line of the document, it will need the rest
 * of what `kehikko-source` has around this: a byte cap that refuses rather than
 * clips, a binary sniff, a line cap. Do not add the line without them.
 *
 * ## Nothing here reads a whole file with `readFileSync`
 *
 * The read below is a `readSync` into a buffer this module allocated, of a
 * length this module bounded. `readFileSync` on a path somebody else chose is a
 * program that allocates whatever it is pointed at, and the path here came off
 * the wire in a passage.
 */

/**
 * The most of one document this will read, in bytes.
 *
 * Two megabytes, and it is a bound rather than a judgement about papers. The
 * whole of the owner's thesis — seven files — is 130 kilobytes, and its largest
 * chapter is 34; a `.tex` file that is over two megabytes is a generated table or
 * an embedded figure, and the headings in the first two megabytes of it are all
 * the answer anybody is going to get. Truncation is SAFE here in a way it is not
 * in a viewer: a heading that falls outside the window simply is not found, and
 * the reader lands on the file rung, which is a coarser answer rather than a
 * wrong one.
 */
export const MAX_BYTES = 2 * 1024 * 1024

/**
 * One file, read up to the bound, or null if it will not open.
 *
 * Exported for `file/outline.ts`, which reads the OTHER files of the same paper
 * through the same bound and the same fence. One capped reader rather than two:
 * the whole argument for `MAX_BYTES` above — that a passage names a path a
 * stranger chose, and that `readFileSync` on such a path allocates whatever it
 * is pointed at — applies identically to every file in the directory beside it,
 * and a second reader would be a second place to forget it.
 */
export function readCapped(path: string): Buffer | null {
  let fd: number | null = null
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return null
    const size = Math.min(stat.size, MAX_BYTES)
    const buffer = Buffer.allocUnsafe(size)
    fd = openSync(path, 'r')
    const got = readSync(fd, buffer, 0, size, 0)
    return got === size ? buffer : buffer.subarray(0, got)
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/**
 * A byte offset turned into a UTF-16 index, which is the unit the scanner works
 * in.
 *
 * The protocol is explicit that a passage's `from` and `to` are BYTES, "because
 * the consumer that opens the file reads bytes and a character count would need
 * the encoding to be agreed on as well". The scanner reads a decoded string, so
 * the two have to be reconciled somewhere, and here is the only place that knows
 * both.
 *
 * The offset is first walked back to a code point boundary. Decoding a slice
 * that ends in the middle of a multi-byte character produces a replacement
 * character, which is one UTF-16 unit where the real character is one or two —
 * so an offset landing mid-character would shift every index after it by one and
 * put a section boundary inside a word. A `.tex` file is mostly ASCII and this
 * will almost never fire; "almost never" is exactly the frequency at which a bug
 * becomes unfindable, so it is handled rather than hoped about.
 */
function utf16At(buffer: Buffer, byte: number): number {
  let at = Math.max(0, Math.min(byte, buffer.length))
  while (at > 0 && ((buffer[at] ?? 0) & 0xc0) === 0x80) at -= 1
  return buffer.subarray(0, at).toString('utf8').length
}

/**
 * Where in a paper a passage is pointing, or null when this app will not answer.
 *
 * Null covers every refusal with one word, for the reason the fence gives: three
 * different refusals is an existence oracle. What it means to the caller is
 * always the same thing — no narrowing, so the checklist stays on the paper,
 * which is what it did before this change and is a working container rather than
 * an error screen.
 *
 * ## The file rung does not need the scanner to succeed
 *
 * A `.bib`, a `.png`, a file whose headings this scanner does not recognise:
 * every one of those still answers with a file and a null section. That is
 * deliberate and it is most of what the report asked for — "between files in the
 * paper module" is the movement the owner makes seven ways, and it must not
 * depend on this module understanding the format.
 */
export function placeOf(
  projectPath: string | null | undefined,
  path: string,
  from: number | null,
  to: number | null,
): Placed | null {
  const root = rootOf(projectPath)
  if (!root) return null

  const real = inside(root, path)
  if (!real) return null

  /*
   * The path is re-expressed relative to the REAL root, so the id is a name in
   * this project rather than a name on this machine. Two consequences worth
   * having: the same paper checked out at two paths gets one set of ticks, and a
   * target key never contains somebody's home directory.
   */
  const rel = relative(root, real)
  if (!rel || rel.startsWith('..')) return null
  const file = fileId(rel)
  if (!file) return null

  const dialect = dialectOf(rel)
  if (!dialect || from === null || to === null) return { file: rel, section: null, title: null }

  const buffer = readCapped(real)
  if (!buffer) return { file: rel, section: null, title: null }

  const source = buffer.toString('utf8')
  const sections = sectionsIn(source, dialect)
  const here = sectionAt(sections, utf16At(buffer, from), utf16At(buffer, to))
  if (!here) return { file: rel, section: null, title: null }

  const id = sectionId(file, here.label, here.title)
  /* An id that would not fit inside a key component falls back to the file, and
     the TITLE is dropped with it. A row saying "Research design" over ticks
     belonging to the whole file would be the two-halves-disagreeing failure this
     workspace keeps finding. */
  if (!id) return { file: rel, section: null, title: null }
  return { file: rel, section: id, title: here.title }
}

/** An epic's paper folder, from the project: where `kehikko-paper` keeps the files of the paper the epic is aimed at. */
function paperFolder(epic: string): string {
  return `${KEHIKOT_DIR}/${moduleFolder(PAPER_MODULE)}/${epic}`
}

/**
 * `placeOf` for a path somebody SPELLED, rather than one a host relayed.
 *
 * A passage carries an absolute path, because the module that set it knows
 * where its file is. An agent at the MCP door names a file the way the paper
 * does — `chapters/3_methods.tex` — and that is a path inside the epic's paper
 * folder, not inside the project. Read against the project alone it is not
 * found, and a caller that took "not found" for "no narrowing" answered about
 * the whole paper: seven chapters held by their own names became one hold on
 * the paper, and nothing said so.
 *
 * So a relative path the project does not have is looked for in the paper's
 * folder as well. The project is asked FIRST, which is what keeps every path
 * that resolved before this resolving to the same place.
 *
 * Null still means what the fence means by it, and the caller here is expected
 * to refuse on it rather than widen. See `aimed` in `doors.ts`.
 */
export function placeIn(
  projectPath: string | null | undefined,
  epic: string,
  path: string,
  from: number | null,
  to: number | null,
): Placed | null {
  const placed = placeOf(projectPath, path, from, to)
  if (placed || isAbsolute(path)) return placed
  return placeOf(projectPath, join(paperFolder(epic), path), from, to)
}

/** How many entries of one directory are looked through for the file an id names. */
const MAX_ENTRIES = 1024

/** How many of a file's headings a refusal offers back. */
const MAX_OFFERED = 24

/**
 * What a section id names: the id as this app spells it — or, for a heading its
 * file does not have, that file and the headings it does have, which is what
 * the refusal offers instead.
 */
export type NamedPlace = { section: string } | { file: string; headings: string[] }

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Every heading of one file, as the ids `placeOf` and `file/outline.ts` mint for them. */
function headingsOf(real: string, rel: string, file: string): string[] {
  const dialect = dialectOf(rel)
  const buffer = dialect ? readCapped(real) : null
  if (!dialect || !buffer) return []
  return sectionsIn(buffer.toString('utf8'), dialect)
    .map((one) => sectionId(file, one.label, one.title))
    .filter((id): id is string => id !== null)
}

/**
 * The file or the heading a section id names, or null when it names neither.
 *
 * `placeOf` goes from a file to an id; this goes back, and it exists for the
 * one caller that TYPES an id instead of pressing one this app offered. The
 * essay in `list/targets.ts` refuses a free-form target because it would leave
 * the app "unable to tell a typo from a new target", and until this an id typed
 * at the MCP door was exactly that: `sec:dependencies` was accepted, listed as
 * held, and shown nowhere, because the id this app mints for that heading is
 * `.kehikot:paper:<epic>:chapters:dependencies#sec:dependencies` and nothing a
 * container shows resolves to the short one.
 *
 * An id is a path with its extension cut and its slashes turned to colons, so
 * it cannot be turned back into a path — the extension is gone. The directory
 * it points into is listed instead and `fileId` is asked which entry spells
 * that id: the one spelling, rather than an extension guessed back on.
 *
 * The id may be spelled from the project or from the epic's paper folder, for
 * the reason `placeIn` gives. What comes back is always the id from the
 * PROJECT, built from the real path as `placeOf` builds it, because that is the
 * only spelling a reader walking into the file arrives at.
 *
 * Headings and ids, never contents — the bound this file sets for itself at the
 * top holds here too.
 */
export function placeNamed(projectPath: string | null | undefined, epic: string, section: string): NamedPlace | null {
  const root = rootOf(projectPath)
  if (!root) return null
  const cut = section.indexOf('#')
  const at = (cut === -1 ? section : section.slice(0, cut)).replace(/:/g, '/')
  if (!at) return null
  for (const spelled of [at, join(paperFolder(epic), at)]) {
    const dir = inside(root, dirname(spelled))
    if (!dir) continue
    let names: string[]
    try {
      names = readdirSync(dir).slice(0, MAX_ENTRIES)
    } catch {
      continue
    }
    /* The extension is a stand-in for the one that was cut: `fileId` drops it,
       and what is left is the id this spelling means. */
    const wanted = fileId(`${spelled}.tex`)
    const spells = names.filter((name) => wanted !== null && fileId(join(dirname(spelled), name)) === wanted)
    /* `3_methods.tex` before `3_methods.bib`: both spell the id, and only one has headings. */
    const name = spells.find((one) => dialectOf(one) !== null) ?? spells[0]
    const real = name ? inside(root, join(dirname(spelled), name)) : null
    if (!real || !isFile(real)) continue
    const rel = relative(root, real)
    const file = fileId(rel)
    if (!file) continue
    if (cut === -1) return { section: file }
    const headings = headingsOf(real, rel, file)
    const id = `${file}#${section.slice(cut + 1)}`
    return headings.includes(id) ? { section: id } : { file: rel, headings: headings.slice(0, MAX_OFFERED) }
  }
  return null
}

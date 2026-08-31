import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { relative } from 'node:path'

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

/** One file, read up to the bound, or null if it will not open. */
function readCapped(path: string): Buffer | null {
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

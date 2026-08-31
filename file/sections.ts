/**
 * Where the headings are in one document, found by this module's own scanner.
 *
 * ## Why this module has a scanner in it at all, when `kehikko-paper` has a parser
 *
 * The obvious arrangement is the wrong one, and a sibling module already wrote
 * the argument down at length — `kehikko-notes/notes/annotations.ts`, which
 * faced precisely this choice. Paper reads `.tex`, knows every sectioning macro,
 * and could simply be ASKED where the reader is standing. It must not be. That
 * would make one module's parser another module's DATA SOURCE, over a channel
 * neither declares in its manifest: a dependency invisible to the host,
 * invisible to anybody reading either manifest, and one that breaks silently the
 * day Paper is not on the canvas. This container would then narrow to a section
 * or not depending on whether somebody happened to place another container.
 *
 * The protocol's position is that modules meet through the host or not at all,
 * and what the host relays is a passage: a path, a place in it, and a quote. So
 * this module does what a consumer of a passage is entitled to do — it opens the
 * file itself, through the fence in `file/confine.ts`, and reads it with a
 * scanner of its own.
 *
 * ## What that costs, said plainly
 *
 * Two scanners over one file format, which will drift. This one is much smaller
 * than Paper's and does not have to agree with it about anything a reader sees:
 * it finds sectioning commands and nothing else, and where it disagrees with
 * Paper the symptom is a checklist narrowed one rung wider or narrower than the
 * page beside it — not a document that renders differently. It is also
 * independently testable against real `.tex` on disk, which a cross-module
 * dependency would not be.
 *
 * ## What it handles, and — more importantly — what it does not
 *
 * Handled:
 *
 * - **LaTeX sectioning**: `\part`, `\chapter`, `\section`, `\subsection`,
 *   `\subsubsection`, `\paragraph`, `\subparagraph`, and every starred form
 *   (`\section*`). These are what the owner's thesis is written in — measured:
 *   `chapters/3_methods.tex` holds one `\chapter`, nine `\section`s and nine
 *   `\subsection`s, and nothing else.
 * - **An optional short title**: `\section[Short]{The long one}`. The braced
 *   title wins, because that is what the reader sees in the body.
 * - **`\label{...}` immediately after a heading**, which is how every chapter of
 *   that thesis is written and which is the only genuinely stable name a section
 *   has. Preferred over the words of the title for exactly the reason
 *   `list/targets.ts` argues at length: headings are reworded constantly, and a
 *   tick keyed to the words of one disappears the first time somebody sharpens
 *   it.
 * - **Markdown ATX headings** (`# ` through `###### `) in `.md` and `.markdown`
 *   files, because this module is not a LaTeX module and a checklist held
 *   against a README is a perfectly ordinary thing to want. Chosen by extension
 *   rather than by sniffing: a `#` at the start of a line is a comment in half
 *   the formats in this workspace, and guessing would be worse than not
 *   offering.
 *
 * **Not handled, deliberately, and this list is the honest half of the file:**
 *
 * - **`\input` and `\include`.** A heading in an included file belongs to that
 *   file, and the reader's passage names whichever file they are actually in. So
 *   there is nothing to follow: this scanner is per-file by construction, which
 *   is also why "which file" is a rung of its own.
 * - **Comments.** A `\section` inside a `%` comment is found and treated as a
 *   heading. Handling it would mean tracking escaped percent signs and verbatim
 *   environments — a real parser — and the failure it prevents is small: a
 *   commented-out heading makes one extra rung that names a section nobody is
 *   writing. A reader who lands there can widen. Worth revisiting only if
 *   somebody actually hits it.
 * - **`\verb`, `verbatim`, `lstlisting`.** A `\section` quoted inside a code
 *   listing is likewise found. Same trade, same escape hatch.
 * - **Custom sectioning macros.** A `\newcommand{\mysection}` this scanner has
 *   never heard of is invisible to it, and the reader gets the enclosing real
 *   section instead — which is a coarser answer rather than a wrong one.
 * - **Setext Markdown headings** (`===` and `---` underlines). Ambiguous with
 *   the rules `kehikko-notes` already found in these very files: sixty equals
 *   signs under a line of prose is how a `.tex` chapter separates its parts, and
 *   the same shape in a `.md` is a heading. Refusing to guess costs a rung in
 *   Markdown written that way and prevents a scanner that reads dividers as
 *   titles.
 * - **Any file that is not `.tex`, `.latex`, `.md` or `.markdown`.** No headings
 *   at all, and that is answered as "this file has no sections" rather than as a
 *   failure — the file rung still works, which is most of what the report asked
 *   for.
 *
 * Nothing here touches a disk or imports `node:` anything. It takes a string, so
 * it is testable without a filesystem and importable from the page if it ever
 * needs to be.
 */

/** One sectioning command found in a file, and the span of document it owns. */
export interface Section {
  /**
   * How deep, with smaller meaning wider. `\part` is 1, `\chapter` 2,
   * `\section` 3, and so on; a Markdown `#` is 1.
   *
   * A number rather than the macro's name, because the only question anybody
   * asks of it is "does this heading end that one's span", which is a
   * comparison. The name the author wrote is kept in `title` and nowhere else.
   */
  level: number
  /** The words in the braces, as the author wrote them. Not an identifier. */
  title: string
  /** The `\label{}` this heading carries, when it has one. The stable name. */
  label: string | null
  /** First UTF-16 unit of the heading command itself. */
  from: number
  /**
   * One past the last unit of everything this heading owns: its own line, the
   * prose under it, and every deeper heading beneath it, up to the next heading
   * of the same or a shallower level, or the end of the file.
   *
   * This is the "a title and the paragraphs under it" the report asked for, and
   * it is why the spans NEST rather than partition: standing inside a
   * `\subsection` is standing inside its `\section` too, and the ladder picks
   * the deepest one that contains the reader.
   */
  to: number
}

/** LaTeX sectioning commands, larger number meaning deeper nesting. */
const LATEX_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
}

/**
 * Which scanner a path gets, decided by extension and never by sniffing.
 *
 * Returns null for everything else, and null is a real answer: a file with no
 * sections this scanner can see still has a FILE rung, which is the half of the
 * report that says "between files in the paper module".
 */
export function dialectOf(path: string): 'latex' | 'markdown' | null {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return null
  const ext = path.slice(dot + 1).toLowerCase()
  if (ext === 'tex' || ext === 'latex') return 'latex'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  return null
}

/**
 * Read a `{...}` group starting at `at` (which must be the `{`), honouring
 * nesting and backslash escapes. Returns the contents and the index one past the
 * closing brace, or null when the braces never close.
 *
 * Nesting is not optional: `\section{The \emph{hard} half}` is the ordinary case
 * in this thesis, and a scanner that stopped at the first `}` would name the
 * section "The \emph{hard" and put its end in the middle of a word.
 */
function group(source: string, at: number): { text: string; end: number } | null {
  if (source[at] !== '{') return null
  let depth = 0
  for (let i = at; i < source.length; i += 1) {
    const c = source[i]
    if (c === '\\') {
      i += 1
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return { text: source.slice(at + 1, i), end: i + 1 }
    }
  }
  return null
}

/**
 * The words of a title, with the commonest markup read rather than shown.
 *
 * Deliberately tiny — this is not `kehikko-notes/notes/readable.ts` and must not
 * grow into one. A title is one line, it is shown in a 220-pixel column, and
 * everything it does not recognise it leaves exactly as the author wrote it. Its
 * whole job is that `\emph{Chat} as an exercise` does not read as source.
 */
function plain(title: string): string {
  return title
    .replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The `\label{...}` in the run of text immediately after a heading, if there is one. */
function labelAfter(source: string, from: number, until: number): string | null {
  /* Bounded to the first 200 units after the heading rather than to the whole
     span, because a `\label` five paragraphs down belongs to a figure or an
     equation, not to the section — and adopting one would give the section an id
     that moves when somebody adds a figure. In every chapter of the thesis this
     was measured against, the label is on the line directly beneath. */
  const window = source.slice(from, Math.min(until, from + 200))
  const found = /\\label\s*\{([^{}]+)\}/.exec(window)
  if (!found) return null
  const name = (found[1] ?? '').trim()
  return name || null
}

interface Raw {
  level: number
  title: string
  from: number
  /** Where the heading command ends and its section's body begins. */
  bodyFrom: number
}

/** Every heading in one file, in document order, with nesting spans filled in. */
export function sectionsIn(source: string, dialect: 'latex' | 'markdown'): Section[] {
  const found = dialect === 'latex' ? latexHeadings(source) : markdownHeadings(source)

  /*
   * Spans, computed by looking forward for the first heading that ends this one.
   *
   * A heading owns everything up to the next heading of the SAME OR SHALLOWER
   * level, which means a `\section`'s span swallows every `\subsection` under
   * it. That is what makes the spans NEST, and nesting is what lets the ladder
   * answer "the deepest thing containing the reader" without a tree.
   */
  return found.map((one, i) => {
    let end = source.length
    for (let j = i + 1; j < found.length; j += 1) {
      const next = found[j]
      if (next && next.level <= one.level) {
        end = next.from
        break
      }
    }
    return {
      level: one.level,
      title: one.title,
      label: labelAfter(source, one.bodyFrom, end),
      from: one.from,
      to: end,
    }
  })
}

function latexHeadings(source: string): Raw[] {
  const out: Raw[] = []
  /* Scanned for backslashes rather than run as one big regex over the file,
     because the title is a brace group and brace groups nest — see `group`. A
     regex that matched `\{[^}]*\}` would be wrong on the first `\emph` in a
     heading, which this thesis has several of. */
  const command = /\\([a-zA-Z]+)(\*?)/g
  let match: RegExpExecArray | null
  while ((match = command.exec(source)) !== null) {
    const level = match[1] === undefined ? undefined : LATEX_LEVELS[match[1]]
    if (level === undefined) continue
    let at = match.index + match[0].length
    /* The optional short title, skipped rather than read. What a reader sees in
       the body is the braced one; the bracketed one is for the table of
       contents. */
    while (source[at] === ' ' || source[at] === '\t') at += 1
    if (source[at] === '[') {
      const close = source.indexOf(']', at)
      if (close === -1) continue
      at = close + 1
      while (source[at] === ' ' || source[at] === '\t') at += 1
    }
    const braced = group(source, at)
    if (!braced) continue
    const title = plain(braced.text)
    if (!title) continue
    out.push({ level: level + 1, title, from: match.index, bodyFrom: braced.end })
    /* The scan resumes after the title, so a sectioning command nested inside
       another one's braces is not found twice. */
    command.lastIndex = braced.end
  }
  return out
}

function markdownHeadings(source: string): Raw[] {
  const out: Raw[] = []
  let at = 0
  for (const line of source.split('\n')) {
    const found = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (found) {
      const title = (found[2] ?? '').trim()
      if (title) out.push({ level: (found[1] ?? '').length, title, from: at, bodyFrom: at + line.length })
    }
    at += line.length + 1
  }
  return out
}

/**
 * The deepest section containing a point in the file, or null when the point is
 * above the first heading — a `.tex` preamble, a Markdown lede.
 *
 * "Containing" and not "overlapping", and the difference matters: a selection
 * that straddles two sections is not IN either of them in the sense a tick would
 * need, and answering with the first one would file work against a section the
 * reader is only half standing in. A straddling selection widens to the nearest
 * heading that holds all of it, which is what testing both ends gets for free —
 * and if nothing holds all of it, the answer is null and the ladder falls back
 * to the file, which is the honest coarser answer.
 */
export function sectionAt(sections: Section[], from: number, to: number): Section | null {
  let best: Section | null = null
  for (const one of sections) {
    if (one.from <= from && to <= one.to) {
      if (!best || one.from > best.from || (one.from === best.from && one.to < best.to)) best = one
    }
  }
  return best
}

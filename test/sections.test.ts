import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

import { dialectOf, sectionAt, sectionsIn } from '../file/sections.ts'

/**
 * The scanner, as a table of cases.
 *
 * It is pure and takes a string, which is the whole reason it can be tested this
 * way — see the essay at the top of `file/sections.ts` for why this module has a
 * scanner of its own rather than asking the paper module, and for the list of
 * what it deliberately does not handle. Several cases below assert the NOT
 * handled half, because a documented limit nobody tested is a limit that
 * silently becomes a bug.
 *
 * The last block runs against the owner's real thesis when it is on this
 * machine, and is skipped when it is not. A test that needs somebody's home
 * directory cannot be the only evidence, so everything it checks is checked
 * above it on a literal too; what it adds is that the literals are actually what
 * that document looks like.
 */

const THESIS = '/Users/jaakkorajala/Claude/Projects/CS-DEGREE/05_drafts/thesis_latex'

describe('which scanner a file gets', () => {
  test('is decided by extension, and never by looking inside', () => {
    expect(dialectOf('chapters/3_methods.tex')).toBe('latex')
    expect(dialectOf('MAIN.LATEX')).toBe('latex')
    expect(dialectOf('README.md')).toBe('markdown')
    expect(dialectOf('notes.markdown')).toBe('markdown')
  })

  test('is null for everything else, which is a file rung and not a failure', () => {
    /* A `.bib` still gets a file target: the reader moved between files, which is
       the movement the report is mostly about, and it must not depend on this
       program understanding the format. */
    expect(dialectOf('references.bib')).toBe(null)
    expect(dialectOf('figures/plot.png')).toBe(null)
    expect(dialectOf('Makefile')).toBe(null)
  })
})

describe('the LaTeX scanner', () => {
  test('finds a heading and gives it everything up to the next one of its level', () => {
    const source = '\\section{One}\naaa\n\\section{Two}\nbbb\n'
    const found = sectionsIn(source, 'latex')
    expect(found.map((s) => s.title)).toEqual(['One', 'Two'])
    expect(source.slice(found[0]!.from, found[0]!.to)).toBe('\\section{One}\naaa\n')
    expect(found[1]!.to).toBe(source.length)
  })

  test('nests: a section swallows the subsections under it', () => {
    /* This is what makes "the deepest thing containing the reader" answerable
       without a tree, and it is the shape the report described — a title and the
       paragraphs under it, where a subsection's paragraphs are also the
       section's. */
    const source = '\\section{S}\na\n\\subsection{A}\nb\n\\subsection{B}\nc\n\\section{T}\nd\n'
    const found = sectionsIn(source, 'latex')
    expect(found.map((s) => [s.title, s.level])).toEqual([['S', 3], ['A', 4], ['B', 4], ['T', 3]])
    expect(source.slice(found[0]!.from, found[0]!.to)).toContain('\\subsection{B}')
    expect(source.slice(found[1]!.from, found[1]!.to)).toBe('\\subsection{A}\nb\n')
  })

  test('reads a starred form, because a paper uses them for unnumbered chapters', () => {
    expect(sectionsIn('\\chapter*{Abstract}\nx', 'latex').map((s) => s.title)).toEqual(['Abstract'])
  })

  test('skips the optional short title and keeps the one the reader sees', () => {
    expect(sectionsIn('\\section[Short]{The long one}\nx', 'latex')[0]!.title).toBe('The long one')
  })

  test('follows nested braces, so markup inside a heading does not truncate it', () => {
    /* The bug this prevents: a regex ending at the first `}` names the section
       "The \\emph{hard" and puts its start-of-body in the middle of a word. */
    expect(sectionsIn('\\section{The \\emph{hard} half}\nx', 'latex')[0]!.title).toBe('The hard half')
  })

  test('takes the label under a heading as its name, and ignores one further down', () => {
    const source = '\\section{Research design}\n\\label{sec:meth-design}\n' + 'x'.repeat(400) + '\n\\label{fig:later}\n'
    const found = sectionsIn(source, 'latex')
    expect(found[0]!.label).toBe('sec:meth-design')
  })

  test('has no label when the author wrote none', () => {
    expect(sectionsIn('\\section{Untitled}\nprose\n', 'latex')[0]!.label).toBe(null)
  })

  test('is not confused by an unrelated macro, and does not read \\footnote as a heading', () => {
    expect(sectionsIn('\\emph{x} \\footnote{y} \\paragraph{P}\nz', 'latex').map((s) => s.title)).toEqual(['P'])
  })

  test('finds nothing in a preamble, so the bytes above the first heading are the file', () => {
    expect(sectionsIn('\\documentclass{tauthesis}\n\\usepackage{x}\n', 'latex')).toEqual([])
  })

  test('DOES find a commented-out heading, which is the documented limit', () => {
    /* Asserted rather than lamented. `file/sections.ts` says this is not handled
       and says what it costs — one extra rung naming a section nobody is
       writing, escapable by widening. If somebody makes the scanner comment-aware
       this test is where they will find out they have, and can decide on purpose. */
    expect(sectionsIn('% \\section{Not really}\nx', 'latex').map((s) => s.title)).toEqual(['Not really'])
  })
})

describe('the Markdown scanner', () => {
  test('finds ATX headings and nests them the same way', () => {
    const source = '# One\na\n## Under\nb\n# Two\nc\n'
    const found = sectionsIn(source, 'markdown')
    expect(found.map((s) => [s.title, s.level])).toEqual([['One', 1], ['Under', 2], ['Two', 1]])
    expect(source.slice(found[0]!.from, found[0]!.to)).toContain('## Under')
  })

  test('does NOT read a setext underline as a heading, which is the documented limit', () => {
    expect(sectionsIn('Title\n=====\ntext\n', 'markdown')).toEqual([])
  })

  test('ignores a hash that is not a heading', () => {
    expect(sectionsIn('#no space\nc # not a heading\n', 'markdown')).toEqual([])
  })
})

describe('which section a reader is standing in', () => {
  const source = '\\section{S}\naaaa\n\\subsection{A}\nbbbb\n\\section{T}\ncccc\n'
  const found = sectionsIn(source, 'latex')

  test('is the deepest one that contains the whole of the selection', () => {
    const at = source.indexOf('bbbb')
    expect(sectionAt(found, at, at + 4)?.title).toBe('A')
  })

  test('is the enclosing one when the selection is in the section but not the subsection', () => {
    const at = source.indexOf('aaaa')
    expect(sectionAt(found, at, at + 4)?.title).toBe('S')
  })

  test('is null when the reader is above every heading', () => {
    /* A preamble, a Markdown lede. The ladder answers this with the FILE rung,
       which is a coarser answer rather than a wrong one. */
    expect(sectionAt(sectionsIn('preamble\n\\section{S}\nx', 'latex'), 0, 3)).toBe(null)
  })

  test('widens rather than guessing when a selection straddles two sections', () => {
    /* Deliberate: a selection half in one section and half in the next is not IN
       either of them in the sense a tick would need, and answering with the
       first would file work against a section the reader is only half standing
       in. Nothing contains this one, so the answer is null and the file rung
       takes it. */
    expect(sectionAt(found, source.indexOf('bbbb'), source.indexOf('cccc') + 4)).toBe(null)
  })
})

describe('against the thesis this was written for', () => {
  const there = existsSync(`${THESIS}/chapters/3_methods.tex`)
  const maybe = there ? test : test.skip

  maybe('finds the chapter, its sections and its subsections, and every label', () => {
    const source = readFileSync(`${THESIS}/chapters/3_methods.tex`, 'utf8')
    const found = sectionsIn(source, 'latex')
    /* Measured on the day this was written, and quoted in `file/sections.ts`:
       one chapter, nine sections, nine subsections. Asserted as a floor and a
       shape rather than as exact counts, because this is somebody's live thesis
       and it is being edited — a test that broke every time the owner added a
       heading would be a test they learned to ignore. */
    expect(found.filter((s) => s.level === 2)).toHaveLength(1)
    expect(found.filter((s) => s.level === 3).length).toBeGreaterThanOrEqual(9)
    expect(found.filter((s) => s.level === 4).length).toBeGreaterThanOrEqual(9)
    expect(found[0]!.title).toBe('Methods')
    expect(found[0]!.label).toBe('ch:methods')
    /* Measured: eighteen of the nineteen headings in this chapter carry a
       `\label`, and exactly one does not — "Architecture overview". That one is
       the case `sectionId` falls back for, and it is worth having a real example
       of rather than only a literal: its target id is a slug of the words, so
       rewording that heading moves its ticks to a new target and leaves the old
       ones under a name nothing points at. The cure is a `\label`, which is the
       author's to add and not this program's to invent. Asserted as a ceiling
       rather than a count, because this is somebody's live thesis. */
    expect(found.filter((s) => s.label === null).length).toBeLessThanOrEqual(1)
  })

  maybe('gives the chapter a span that reaches the end of the file', () => {
    const source = readFileSync(`${THESIS}/chapters/3_methods.tex`, 'utf8')
    const found = sectionsIn(source, 'latex')
    expect(found[0]!.to).toBe(source.length)
  })
})

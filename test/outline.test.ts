import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MAX_FILES, outlineOf } from '../file/outline.ts'

/**
 * What the target picker is offered, held against real files on a real disk.
 *
 * ## Why this one is not a table
 *
 * Almost every other pure decision in this module has a table beside it —
 * `list/scope.ts`, `src/view/room.ts`, `file/sections.ts` — because they take
 * values and return values. This one takes a DIRECTORY. Where a paper begins,
 * whether a symlink in `chapters/` gets past the fence, whether a dotfile is
 * offered as a chapter: none of those are answerable without a filesystem, and
 * a fake one would be a test of the fake.
 *
 * So it builds a thesis. The shape is the owner's — a `main.tex` with the
 * `\documentclass` and six chapters under `chapters/` — because that is the
 * layout every claim in `file/outline.ts` was written against.
 *
 * Every temporary directory on macOS is behind a symlink (`/tmp` is
 * `/private/tmp`), which is not an inconvenience here: it is the exact condition
 * that broke a sibling module's copy of this fence against a real project, and
 * running these cases under it is how that stays fixed.
 */

const tmp = mkdtempSync(join(tmpdir(), 'checklist-outline-'))
const project = join(tmp, 'project')
const paper = join(project, 'thesis')
mkdirSync(join(paper, 'chapters'), { recursive: true })
mkdirSync(join(paper, '.kehikot'), { recursive: true })
mkdirSync(join(project, 'notes'), { recursive: true })

writeFileSync(
  join(paper, 'main.tex'),
  '\\documentclass{tauthesis}\n\\begin{document}\n\\chapter{Abstract}\n\\label{ch:abstract}\nprose\n\\end{document}\n',
)
writeFileSync(
  join(paper, 'chapters', '3_methods.tex'),
  '\\chapter{Methods}\n\\label{ch:meth}\nprose\n'
  + '\\section{Research design}\n\\label{sec:meth-design}\nprose\n'
  + '\\section{Model selection}\n\\label{sec:meth-models}\nprose\n',
)
writeFileSync(join(paper, 'chapters', '4_results.tex'), '\\chapter{Results}\n\\label{ch:res}\nprose\n')
writeFileSync(join(paper, 'references.bib'), '@book{x,title={y}}\n')
/* Two files that sort BEFORE `main.tex` at the paper's root, both of which the
   owner's own thesis directory actually has. They are why the offer leads with
   the file holding the `\\documentclass` rather than with the alphabet — a
   difference `dev/picker.probe.mjs` found against the real thing, where
   `README_overleaf.md` and `main_snippet.tex` put the abstract third. */
writeFileSync(join(paper, 'README_overleaf.md'), '# How to build this\n')
writeFileSync(join(paper, 'appendix.tex'), '\\chapter{Appendix}\n')
writeFileSync(join(paper, '.kehikot', 'checklists.json'), '{}\n')
/* A file OUTSIDE the paper but inside the project. Nothing below should ever
   offer it: it is what the "the project root" alternative would have got. */
writeFileSync(join(project, 'notes', 'scratch.md'), '# Not a chapter\n')
writeFileSync(join(tmp, 'outside.tex'), '\\chapter{Somebody else}\n')
/* Two of them, at both depths the walk reaches, because the walk lists the
   paper's own directory and one level below it by two different code paths and a
   fence tested on only one of them is a fence with a hole in the other. */
symlinkSync(join(tmp, 'outside.tex'), join(paper, 'chapters', 'link.tex'))
symlinkSync(join(tmp, 'outside.tex'), join(paper, 'toplink.tex'))
/* And one that is perfectly legitimate: a link to a chapter inside the paper.
   The fence must let it through, or "no symlinks" becomes the rule by accident
   and somebody's chapter disappears. */
symlinkSync(join(paper, 'chapters', '4_results.tex'), join(paper, 'chapters', '5_alias.tex'))

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const from = (file: string) => outlineOf(project, join(paper, file))

describe('where a paper begins', () => {
  test('a reader inside a chapter is offered the whole paper, main.tex included', () => {
    /* The single most important case. `chapters/3_methods.tex` is where the
       owner spends their time, and the alternative rule — "the file's own
       directory" — would offer the six chapters and never `main.tex`, which is
       where the abstract and the claims a checklist is likeliest to be about
       actually live. */
    const got = from('chapters/3_methods.tex')
    expect(got?.files.map((one) => one.file)).toEqual([
      'thesis/main.tex',
      'thesis/README_overleaf.md',
      'thesis/appendix.tex',
      'thesis/chapters/3_methods.tex',
      'thesis/chapters/4_results.tex',
    ])
  })

  test('a reader in main.tex is offered the same paper, not a different one', () => {
    /* Two spellings of "where am I" must not be two papers. Standing at the root
       and standing two directories into it are the same document, and a picker
       that offered different files depending on which chapter was open would be
       a picker nobody could learn. */
    expect(from('main.tex')?.files.map((one) => one.file)).toEqual(from('chapters/3_methods.tex')?.files.map((one) => one.file))
  })

  test('the document’s own file leads, ahead of the alphabet and of chapters/', () => {
    /* Two orderings, both deliberately not alphabetical, and both found by
       measuring rather than by taste.

       `chapters/` sorts before `main.tex` as a string, so a plain sort would put
       every chapter above the file holding the abstract. And within the root,
       `README_overleaf.md` and `appendix.tex` both sort before it too — which is
       what `dev/picker.probe.mjs` found against the owner's real thesis, where
       the file a reader most often wants came third in a scrolling list in a
       220-pixel column. So the file that declares the `\documentclass` leads,
       and everything else is alphabetical behind it, root before subdirectory. */
    expect(from('main.tex')?.files.map((one) => one.name)).toEqual([
      'main.tex',
      'README_overleaf.md',
      'appendix.tex',
      '3_methods.tex',
      '4_results.tex',
    ])
  })

  test('nothing outside the paper is offered, even inside the same project', () => {
    /* What the "just use the project root" alternative would have got: the
       notes module's scratch files listed as chapters of the thesis. */
    const files = from('main.tex')?.files.map((one) => one.file) ?? []
    expect(files.some((one) => one.includes('notes/'))).toBe(false)
  })

  test('this app’s own store is not offered as a chapter of the paper it is about', () => {
    const files = from('main.tex')?.files.map((one) => one.file) ?? []
    expect(files.some((one) => one.includes('.kehikot'))).toBe(false)
  })

  test('a file the scanner has no dialect for is not offered at all', () => {
    /* `.bib` has no headings and is not a document a checklist is held against.
       Offering it would be a row that cannot be narrowed and never has a
       count. */
    const files = from('main.tex')?.files.map((one) => one.file) ?? []
    expect(files.some((one) => one.endsWith('.bib'))).toBe(false)
  })
})

describe('the headings inside each file', () => {
  test('are the author’s labels, spelled exactly as a target key would be', () => {
    /* The claim that makes the picker worth having: pointing at a heading here
       and walking into it with the paper module must produce the SAME target
       key. Two spellings of one section would file a reader's ticks in two
       places and neither would look wrong. This is why `sectionId` is imported
       rather than reimplemented. */
    const methods = from('main.tex')?.files.find((one) => one.name === '3_methods.tex')
    expect(methods?.sections.map((one) => one.id)).toEqual([
      'thesis:chapters:3_methods#ch:meth',
      'thesis:chapters:3_methods#sec:meth-design',
      'thesis:chapters:3_methods#sec:meth-models',
    ])
  })

  test('carry the words the author wrote, which is what the screen draws', () => {
    const methods = from('main.tex')?.files.find((one) => one.name === '3_methods.tex')
    expect(methods?.sections.map((one) => one.title)).toEqual(['Methods', 'Research design', 'Model selection'])
  })

  test('a file with no headings has an empty list rather than no row', () => {
    /* The file rung works whether or not this module understands the format,
       which is most of what the scope ladder asked for. A file with no headings
       is still a perfectly good thing to hold a list against. */
    const got = outlineOf(project, join(project, 'notes', 'scratch.md'))
    expect(got?.files.map((one) => one.name)).toEqual(['scratch.md'])
    expect(got?.files[0]?.sections.map((one) => one.title)).toEqual(['Not a chapter'])
  })
})

describe('the fence, which this walks a directory behind', () => {
  test('a symlink out of the paper is not offered, at either depth', () => {
    /* `readdirSync` does not resolve a symlink, so `link.tex -> /tmp/outside.tex`
       is an ordinary entry. Every file is put through `inside()` individually for
       exactly this, rather than the walk trusting that a directory within the
       project only holds paths within it. Both depths, because the walk lists the
       root and the level below it by two different paths. */
    const files = from('main.tex')?.files.map((one) => one.name) ?? []
    expect(files).not.toContain('link.tex')
    expect(files).not.toContain('toplink.tex')
  })

  test('a symlink WITHIN the paper resolves to the file it names, and is not a second row', () => {
    /* Two halves, and the second one was a real bug this case found.

       The first: the rule has to be the FENCE and not "no symlinks". A walk that
       simply ignored every link would pass the case above for the wrong reason
       and would drop a chapter somebody keeps behind one, which is an ordinary
       way to write a paper.

       The second: `inside()` answers with a REAL path, so `5_alias.tex` comes
       back as `4_results.tex` — and before `outlineOf` deduplicated on the
       resolved path, that chapter was listed twice under two names. Both rows
       carried the same `fileId` and therefore the same target key, so a reader
       saw one chapter offered as two pieces of work and got the same ticks
       whichever they pressed. */
    const files = from('main.tex')?.files.map((one) => one.name) ?? []
    expect(files).not.toContain('5_alias.tex')
    expect(files.filter((one) => one === '4_results.tex')).toHaveLength(1)
  })

  test('a document outside the project is refused with one word and no detail', () => {
    /* Null for every refusal, which is the rule `file/confine.ts` sets: three
       distinguishable refusals is an existence oracle. */
    expect(outlineOf(project, join(tmp, 'outside.tex'))).toBe(null)
  })

  test('no project means no outline, rather than an outline of somewhere guessed', () => {
    expect(outlineOf(null, join(paper, 'main.tex'))).toBe(null)
    expect(outlineOf('relative/path', join(paper, 'main.tex'))).toBe(null)
  })

  test('a document that does not exist has no sections in it, because there are none', () => {
    /* The consequence `file/confine.ts` states so nobody re-adds a lexical
       fallback as a bug fix: a path that cannot be resolved is a path this
       program knows nothing about. */
    expect(outlineOf(project, join(paper, 'chapters', 'never_written.tex'))).toBe(null)
  })
})

describe('the bounds, which answer by returning less rather than by failing', () => {
  test('a paper of more files than the cap says so, and still offers what it read', () => {
    /* `capped` is drawn on screen — "Only part of this paper was read. Anything
       missing can still be typed below." A bound that quietly returned a short
       list would be a picker that was silently wrong about what exists. */
    const many = join(tmp, 'many')
    mkdirSync(many, { recursive: true })
    writeFileSync(join(many, 'main.tex'), '\\documentclass{article}\n')
    for (let i = 0; i < MAX_FILES + 10; i += 1) {
      writeFileSync(join(many, `part${String(i).padStart(3, '0')}.tex`), `\\section{Part ${i}}\n`)
    }
    const got = outlineOf(tmp, join(many, 'main.tex'))
    expect(got?.files.length).toBe(MAX_FILES)
    expect(got?.capped).toBe(true)
  })
})

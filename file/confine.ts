import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * The fence, and the only place in this program that decides whether a document
 * a passage names may be opened.
 *
 * ## Why this file exists at all, in a module that had no reader
 *
 * Until this change nothing here touched a file except this app's own store,
 * whose location this app computes from the project path and nothing else. Now
 * the checklist follows a reader through a document, and the only way it can
 * know where the sections are is to open the document and look — see the essay
 * at the top of `file/sections.ts` for why asking the paper module instead is
 * the wrong answer.
 *
 * That makes this the most dangerous file in the module. What asks is a
 * PASSAGE: a path chosen by a stranger's program and relayed by a host that
 * never opened it. The protocol says so itself, at `passageSchema` — a consumer
 * that resolves a passage path and opens it "is opening a path a stranger's
 * program chose, and owes itself the confinement check it would owe any other".
 * A hole here reads `~/.ssh/id_ed25519` off disk because a message named it.
 *
 * It is small on purpose, it is pure apart from its `realpath` calls, and
 * `test/confine.test.ts` exists entirely to try to get past it.
 *
 * ## Two checks, and neither is sufficient alone
 *
 * **`resolve` first.** `join(root, '../../etc')` is a string containing `..` and
 * `resolve` is what turns it into the path it actually means. A prefix check run
 * before resolution is checking a string nobody will open.
 *
 * **`realpath` second.** Resolution is lexical: it knows nothing about symlinks.
 * `<root>/link` where `link -> /etc` resolves to a path that starts with the
 * root and opens somewhere else entirely. So the resolved path is realpath'd and
 * the check is made against the ANSWER — which is also why the root is
 * realpath'd, since comparing a real path against a symlinked root (`/tmp` is
 * `/private/tmp` on macOS, and this repository's tests run in `mkdtemp` under
 * it) rejects everything.
 *
 * ## A path that cannot be realpath'd is refused, with no lexical fallback
 *
 * A sibling module had a version of this that fell back to a lexical prefix
 * comparison when it could not `realpath` the target — the reasoning being that
 * a file which does not exist yet is not an escape. It is: a path that cannot be
 * resolved is a path this program knows nothing about, and "it is probably fine"
 * is not a sentence a fence gets to say. That fallback was removed from the
 * module it was in, and this file has never had one. The consequence is worth
 * stating so nobody re-adds it as a bug fix: this app cannot find sections in a
 * document that does not exist. That is correct — there are none in it.
 *
 * ## The symlinked-root branch, which is a bug found by running the real thing
 *
 * This is the whole reason this file is a considered copy rather than a
 * transcription. `kehikko-source` copied Explorer's fence, pointed it at a real
 * project, and found it refused every file — because a passage carries the
 * HOST'S spelling of an absolute path while the fence had already realpath'd the
 * root. On macOS every temporary directory is a symlink (`/tmp` is
 * `/private/tmp`, `/var/folders/…` is `/private/var/folders/…`), so the passage
 * says `/var/…/project/main.tex` while the fence holds `/private/var/…/project`,
 * `resolve` cannot reconcile them — a realpath cannot be inverted — the lexical
 * check fails, and the module refuses every file in the project it was pointed
 * at, with the same sentence it uses for `/etc/shadow`. A container that shows
 * nothing, ever, and blames the document.
 *
 * The resolution `kehikko-source` reached, and the one below, splits on how the
 * path was spelled:
 *
 * - An **absolute** path that resolved outside the root is not a traversal. It
 *   is a passage naming somewhere else, which is exactly what a second spelling
 *   of the same directory looks like. So it gets exactly one `realpath` and is
 *   judged on the answer. What that costs is one `stat` of a path the caller
 *   already named in full, whose result is the same `null` either way.
 * - A **relative** path that resolved outside the root got there through `..`,
 *   which IS the traversal attack. It is refused without a syscall, because
 *   realpath'ing a path outside the root in order to then decide we were not
 *   allowed to is an existence oracle with extra steps.
 *
 * ## The separator is not decoration
 *
 * `'/project-evil'.startsWith('/project')` is true. It is the oldest bug in this
 * family and it is a prefix check written by somebody who was thinking about
 * directories while the language was thinking about strings. So the comparison
 * is against `root + sep`, with the root itself allowed as its own special case,
 * and there is a test named after `/project-evil`.
 *
 * ## What a refusal is
 *
 * `null`, always, with no distinction between "outside the root", "does not
 * exist" and "cannot be read". Three different refusals is an oracle: a caller
 * that can tell them apart can probe for the existence of files it is not
 * allowed to see, one question at a time. Callers here get one word back and the
 * word is no.
 */
export function inside(root: string, target: string): string | null {
  if (!root || !isAbsolute(root)) return null

  const asked = resolve(root)
  const realRoot = real(asked)
  if (realRoot === null) return null

  /* A path spelled under the root AS THE CALLER WAS GIVEN IT is re-expressed
     relative to it, so that the two spellings of one directory are one
     directory. This covers the case where the caller holds the symlinked
     spelling of the root and passes it as `root` too; the harder half is
     below. */
  const spelled = isAbsolute(target) ? resolve(target) : target
  const wanted = isAbsolute(spelled) && contains(asked, spelled) ? relative(asked, spelled) : spelled

  const resolved = resolve(realRoot, wanted)

  if (!contains(realRoot, resolved)) {
    if (!isAbsolute(spelled)) return null
    const elsewhere = real(spelled)
    if (elsewhere === null || !contains(realRoot, elsewhere)) return null
    return elsewhere
  }

  const realTarget = real(resolved)
  if (realTarget === null) return null
  /* And again on the answer, because between the two lines above the path may
     have been a symlink all along. This is the check that matters, and it is the
     last word: there is no branch here that accepts an unresolvable path. */
  if (!contains(realRoot, realTarget)) return null
  return realTarget
}

/**
 * Whether `path` is `root` or is beneath it, as directories rather than as
 * strings. See the essay above for why the separator is here.
 */
export function contains(root: string, path: string): boolean {
  if (path === root) return true
  return path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * `realpathSync`, or null.
 *
 * A throw here is ENOENT, EACCES or ELOOP, and every one of them means the same
 * thing to this program: it is not going to open that. Distinguishing them on
 * the way out is the oracle the essay above refuses.
 */
function real(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * The project a read is confined to, or null.
 *
 * The same rule the store already keeps and for the same reason: the root comes
 * from `context.projectPath`, which is the host's, and a relative root would
 * resolve against this module's own directory and quietly hand this app's own
 * source to somebody who thought they were asking about their paper.
 *
 * There is deliberately no `SOURCE_ROOTS`-style allowlist here, where the module
 * this fence was copied from has one. That module is a source VIEWER: showing
 * file contents is its whole product, so bounding which roots it will show from
 * is a meaningful operator control. This module never returns a byte of the
 * document. It reads a `.tex` file, finds the headings, and answers with a
 * section id and a title — so the most an operator could bound is which
 * projects' heading names are discoverable by something that can already reach
 * this port and read every checklist on it. A knob that fences less than the
 * door beside it is a knob that teaches people the fence is elsewhere.
 */
export function rootOf(asked: string | null | undefined): string | null {
  if (!asked || !isAbsolute(asked)) return null
  return real(resolve(asked))
}

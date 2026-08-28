import {
  EXEMPT,
  GITHUB_WORDING,
  SIZE_BIG,
  SIZE_FINE,
  type ChecklistHost,
  type ChecklistItem,
  type ItemKind,
} from './shipped.ts'
import {
  CHECKLIST_NAMES,
  checklistTrouble,
  exemptFor,
  notShownWhy,
  readChecklistEdits,
  shippedList,
  shippedWordingOf,
  sizeBig,
  sizeFine,
  type ChecklistEdits,
  type ChecklistName,
} from './store.ts'

/**
 * What a reader needs to be shown one row of one list, and the way back beside it.
 *
 * Copied whole from the roadmap's `checklistView`, because the hard part of it
 * is not the shape: it is the four sentences `appliesSaidFor` tells apart, and
 * the rule that what SHIPPED travels beside what is in force so the two can
 * never be read a moment apart. That reasoning is as true in an app nobody has
 * framed as it was in a settings dialog.
 */
export interface ChecklistRowView {
  /** `id`, or `id@github` for the second wording an item ships on GitHub. */
  key: string
  id: string
  list: ChecklistName
  kind: ItemKind
  /** The GitHub retelling is its own row, and says so. */
  retelling: boolean
  label: string
  why: string
  /** What it shipped with. Always sent, because the way back has to be visible. */
  shippedLabel: string
  shippedWhy: string
  /** Somebody added this one; there is no shipped list behind it. */
  added: boolean
  removed: boolean
  /** Anything at all changed about this row: its words, or where it applies. */
  edited: boolean
  /** Only the words. Told apart because they are two different sentences. */
  wordingEdited: boolean
  /** Only where it applies. An exemption is not a rewording of anything. */
  appliesEdited: boolean
  setAt: string | null
  setBy: string | null
  /** Per host: the reason it does not apply, or an empty string where it does. */
  exempt: Record<ChecklistHost, string> | null
  shippedExempt: Record<ChecklistHost, string> | null
  /**
   * What to say above each exemption box, per host.
   *
   * Composed here rather than in the page, because the page renders it once at
   * build time and the browser rewrites it after every save — and this is the
   * sentence whose MEANING turns on the state, so two copies of the rule would
   * be two answers to "does this apply here", differing by whether a server had
   * answered yet. One source, both readers.
   */
  appliesSaid: Record<ChecklistHost, string> | null
  /** Why these words currently reach nobody, or null when they reach somebody. */
  notShown: string | null
}

export interface ChecklistListView {
  name: ChecklistName
  title: string
  lede: string
  rows: ChecklistRowView[]
}

export interface ChecklistView {
  lists: ChecklistListView[]
  size: { fine: number; big: number; shippedFine: number; shippedBig: number; edited: boolean }
  /**
   * Set when there is a store file that cannot be read.
   *
   * Everything else in this view is then the list as it SHIPPED, which is the
   * safe answer but not the whole one — "nobody has changed this" and "we could
   * not read what was changed" are different claims, and a page that made the
   * first while the second was true would be stating a guess as a fact.
   */
  trouble: string | null
}

const LIST_TITLE: Record<ChecklistName, string> = {
  mr: 'Merge requests and pull requests',
  issue: 'Issues',
}

const LIST_LEDE: Record<ChecklistName, string> = {
  mr: 'What a change owes before it is somebody else\'s problem. An item marked "read from the tracker" is answered by a case arm in derive() and cannot be added or removed here, because there would be no code behind the name — say it does not apply, with a reason, and it comes off the list carrying that reason. An item marked "the agent says so" is an assertion only the agent that did the work can make, so those are yours to add, remove and reword.',
  issue: 'What an agent owes before it opens anything. All of it is judgement — no tracker has an opinion about whether somebody understood a problem — so every one of these is the agent\'s to assert, and every one is yours to change.',
}

function hasExemptEdit(file: ChecklistEdits, id: string): boolean {
  return id in file.exempt.gitlab || id in file.exempt.github
}

const HOST_NAME: Record<ChecklistHost, string> = {
  gitlab: 'a GitLab merge request',
  github: 'a GitHub pull request',
}

/**
 * What to say over one exemption box, given where the item actually stands.
 *
 * Four answers and they are four different claims, which is why this is a
 * function and not a template: "asked here", "asked here but it shipped
 * exempt", "not asked here, and this is why", and "not asked anywhere, because
 * the item is off the list" are not shades of one sentence.
 */
function appliesSaidFor(host: ChecklistHost, now: string, shipped: string, removed: boolean): string {
  const name = HOST_NAME[host]
  if (removed) {
    return `Off the list, so it is not asked on ${name} or anywhere else. Put it back first — this is what would then decide whether it applies there.`
  }
  if (now) return `Not asked on ${name}, and this is the reason it gives.`
  if (shipped) {
    return `Asked on ${name} — it shipped exempt there, and somebody has since said it does apply. Put the reason back to exempt it again.`
  }
  return `Asked on ${name}. Write why it cannot apply there to take it off that list carrying its reason; leave it empty and it stays on.`
}

/**
 * Every row of both lists, whether or not anybody has touched it, with what
 * shipped travelling beside what is in force.
 *
 * The shipped text goes out even where nothing is edited, for the reason the
 * prompts view gives: a list that has drifted from a default nobody can see is
 * worse than no editing at all, and travelling together is what stops the two
 * being read a moment apart.
 */
export function checklistView(): ChecklistView {
  const file = readChecklistEdits()
  const exempt = { gitlab: exemptFor('gitlab'), github: exemptFor('github') }

  const lists = CHECKLIST_NAMES.map((name): ChecklistListView => {
    const edits = file.lists[name]
    const rows: ChecklistRowView[] = []
    const push = (item: ChecklistItem, opts: { added: boolean; removed: boolean }) => {
      const was = shippedWordingOf(name, item.id) ?? { label: item.label, why: item.why }
      const over = edits.wording[item.id]
      /* Who last changed this row, which is not always whoever reworded it.
         *
         A row that has been taken off the list says "taken off by", and a row
         nobody has reworded since it was added says "added by" — naming
         whoever reworded it a week earlier, or nobody at all, would put the
         wrong name on a decision or lose a real one. Each op writes its own
         stamp; this is where they are read back, in the order the row's own
         sentence names them. */
      const bornWith = edits.added.find((a) => a.id === item.id)
      const exemptStamp = file.exempt.github[item.id] ?? file.exempt.gitlab[item.id]
      const stamp = opts.removed
        ? (edits.removed[item.id] ?? over ?? exemptStamp ?? bornWith)
        : (over ?? exemptStamp ?? bornWith)

      const mine =
        name === 'mr'
          ? { gitlab: exempt.gitlab[item.id] ?? '', github: exempt.github[item.id] ?? '' }
          : null
      const theirs =
        name === 'mr'
          ? { gitlab: EXEMPT.gitlab[item.id] ?? '', github: EXEMPT.github[item.id] ?? '' }
          : null

      rows.push({
        key: item.id,
        id: item.id,
        list: name,
        kind: item.kind,
        retelling: false,
        label: over?.label ?? was.label,
        why: over?.why ?? was.why,
        shippedLabel: was.label,
        shippedWhy: was.why,
        added: opts.added,
        removed: opts.removed,
        edited: Boolean(over) || hasExemptEdit(file, item.id),
        wordingEdited: Boolean(over),
        appliesEdited: hasExemptEdit(file, item.id),
        setAt: stamp?.setAt ?? null,
        setBy: stamp?.setBy ?? null,
        exempt: mine,
        shippedExempt: theirs,
        appliesSaid:
          mine && theirs
            ? {
                gitlab: appliesSaidFor('gitlab', mine.gitlab, theirs.gitlab, opts.removed),
                github: appliesSaidFor('github', mine.github, theirs.github, opts.removed),
              }
            : null,
        notShown: notShownWhy(name, item.id),
      })

      const retell = GITHUB_WORDING[item.id]
      if (!retell) return
      const retold = edits.wording[`${item.id}@github`]
      rows.push({
        key: `${item.id}@github`,
        id: item.id,
        list: name,
        kind: item.kind,
        retelling: true,
        label: retold?.label ?? retell.label,
        why: retold?.why ?? retell.why,
        shippedLabel: retell.label,
        shippedWhy: retell.why,
        added: false,
        removed: opts.removed,
        edited: Boolean(retold),
        wordingEdited: Boolean(retold),
        appliesEdited: false,
        setAt: retold?.setAt ?? null,
        setBy: retold?.setBy ?? null,
        exempt: null,
        shippedExempt: null,
        appliesSaid: null,
        // A retelling is read on GitHub and nowhere else, so an exemption on
        // that side silences it even though the item itself is still asked for
        // on GitLab. Its own state, not the item's.
        notShown: notShownWhy(name, `${item.id}@github`),
      })
    }

    for (const c of shippedList(name)) push(c, { added: false, removed: Boolean(edits.removed[c.id]) })
    /* Added items that have since been taken off keep their row, saying so. The
       row is what carries the "put it back" press and the sentence about the
       ticks still filed under that id, and both would go with it. */
    for (const a of edits.added) {
      push({ id: a.id, kind: 'agent', label: a.label, why: a.why }, { added: true, removed: Boolean(edits.removed[a.id]) })
    }
    return { name, title: LIST_TITLE[name], lede: LIST_LEDE[name], rows }
  })

  return {
    trouble: checklistTrouble(),
    lists,
    size: {
      fine: sizeFine(),
      big: sizeBig(),
      shippedFine: SIZE_FINE,
      shippedBig: SIZE_BIG,
      edited: sizeFine() !== SIZE_FINE || sizeBig() !== SIZE_BIG,
    },
  }
}


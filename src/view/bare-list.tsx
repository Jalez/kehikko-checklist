import type { ChecklistView } from '../../list/view.ts'

import { Badge } from '@/components/ui/badge.tsx'

/**
 * Both lists with no reference under them: what a change owes and what an issue
 * owes, before anybody has picked anything out.
 *
 * ## Why this is a different component from the standing, rather than a standing
 * with the verdicts blanked
 *
 * Because there are no verdicts, and drawing seven greyed-out marks would be
 * this page inventing a seventh answer — "not applicable yet" — that the store
 * does not have and cannot be asked about. What is true with nothing selected is
 * exactly this: here is the list, here is who answers each line, here is why it
 * is on the list. Every state on the other component is a claim about a
 * particular reference, and there is no reference.
 *
 * ## Removed and exempt rows
 *
 * Both are shown, marked, rather than filtered out. An item taken off the list
 * still has ticks filed under its id and one press from coming back; an item
 * exempt on a tracker is not asked there and carries the sentence saying why. A
 * list that quietly omitted either would be a list that had drifted from what
 * this app actually holds, which is the one thing the store's own view was built
 * to prevent.
 */
export function BareList({ view }: { view: ChecklistView }) {
  return (
    <div className="flex flex-col gap-2">
      {view.trouble ? (
        <p className="rounded-lg border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
          {view.trouble}
        </p>
      ) : null}

      {view.lists.map((list) => (
        <section key={list.name} className="overflow-hidden rounded-lg border bg-card">
          <h2 className="px-2 py-1.5 text-[0.8rem] font-semibold">{list.title}</h2>
          <p className="border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground">{list.lede}</p>
          <ul className="border-t">
            {list.rows.map((row) => (
              <li key={row.key} className="border-t px-2 py-1.5 first:border-t-0">
                <div className="flex items-start gap-1.5">
                  <span className="min-w-0 flex-1 text-[0.8rem] leading-5">
                    {row.label}
                    {row.retelling ? (
                      <span className="text-muted-foreground"> (how GitHub reads it)</span>
                    ) : null}
                    {row.removed ? <span className="text-muted-foreground"> (off the list)</span> : null}
                  </span>
                  <Badge variant="outline" className="mt-px">
                    {row.kind === 'derived' ? 'read' : row.kind === 'human' ? 'the owner' : 'an agent'}
                  </Badge>
                </div>
                <details className="group mt-0.5">
                  <summary className="cursor-pointer list-none text-[0.7rem] text-muted-foreground underline decoration-dotted underline-offset-2 marker:content-none">
                    <span className="group-open:hidden">why this is on the list</span>
                    <span className="hidden group-open:inline">less</span>
                  </summary>
                  <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">{row.why}</p>
                  {row.notShown ? (
                    <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">It is {row.notShown}.</p>
                  ) : null}
                  {row.exempt?.gitlab ? (
                    <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">
                      Not asked on a GitLab merge request: {row.exempt.gitlab}
                    </p>
                  ) : null}
                  {row.exempt?.github ? (
                    <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">
                      Not asked on a GitHub pull request: {row.exempt.github}
                    </p>
                  ) : null}
                  {row.setBy ? (
                    <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">
                      Last changed by {row.setBy}
                      {row.setAt ? ` on ${row.setAt.slice(0, 10)}` : ''}.
                    </p>
                  ) : null}
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-[0.65rem] leading-4 text-muted-foreground">
        A change reads as small enough up to {view.size.fine} files and too big over {view.size.big}
        {view.size.edited ? ` (it shipped as ${view.size.shippedFine} and ${view.size.shippedBig})` : ''}.
      </p>
    </div>
  )
}

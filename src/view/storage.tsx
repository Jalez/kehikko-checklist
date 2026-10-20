import { useCallback, useEffect, useState } from 'react'

import type { TrackerReading } from 'kehikot-module-protocol'

import { storage, unanswered, type Finished, type Plan, type Report, type Scope } from '@/store/ask.ts'
import { Button } from '@/components/ui/button.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * What this project's checklists take up, and purging what a person decides
 * is old enough to go. View → Storage in the host's header, or Storage on
 * the list of every checklist.
 *
 * ## What it shows
 *
 * Per checklist: the bytes it takes, how many targets it is held against,
 * released targets whose ticks are kept, ticks, the last activity, and — when
 * the host hands over its tracker reading — how many of its targets are
 * finished (closed or merged). Then the project's total, which is every byte
 * under `.kehikot/checklist/`.
 *
 * ## Purge: choose, preview, confirm
 *
 * A scope and an age are chosen; Preview says exactly what would go and what
 * it frees; Purge arms, and a second press confirms. Changing anything clears
 * the preview, so what is confirmed is what was shown. A backup is kept for
 * thirty days unless the box is unticked — and then the page says, before the
 * confirm, that it is permanent. The rules are in `list/storage.ts`.
 *
 * Nothing on this page is pressable by an agent: the header switch that
 * opens it is not marked `agents`, and the purge door is behind this page's
 * ticket.
 */

export const SCOPE_WORDS: Record<Scope, { label: string; age: string }> = {
  released: { label: 'Kept ticks of released targets', age: 'with no activity for more than' },
  finished: { label: 'Finished issues and changes (released, ticks removed)', age: 'finished more than' },
  lists: { label: 'Whole checklists', age: 'with no activity for more than' },
}

const UNITS = { days: 1, months: 30 } as const
type Unit = keyof typeof UNITS

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Closed or merged refs, and when, out of the host's reading. */
export function finishedOf(reading: TrackerReading | null): Finished[] | null {
  if (!reading) return null
  return reading.rows
    .filter((row) => row.state === 'closed' || row.state === 'merged')
    .map((row) => ({ ref: row.ref, at: row.mergedAt ?? row.closedAt ?? null }))
}

export function StorageView({
  projectPath,
  readProject,
  onBack,
  onChanged,
  room,
}: {
  projectPath: string | null
  /** The host's tracker reading for the project, or null when there is none. */
  readProject: () => Promise<TrackerReading | null>
  onBack: () => void
  /** Something was purged or put back: every other view re-reads. */
  onChanged: () => void
  room: Room
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [finished, setFinished] = useState<Finished[] | null>(null)
  const [scope, setScope] = useState<Scope>('released')
  const [age, setAge] = useState(6)
  const [unit, setUnit] = useState<Unit>('months')
  const [keep, setKeep] = useState(true)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* The reading first, then the usage with it — so "finished" is counted from what the host said. */
  useEffect(() => {
    let alive = true
    void (async () => {
      const got = finishedOf(await readProject())
      if (!alive) return
      setFinished(got)
      try {
        const answer = await storage(projectPath, { op: 'usage' }, got)
        if (!alive) return
        if (answer.ok) setReport(answer.report)
        else setError(answer.error)
      } catch (caught) {
        if (alive && !unanswered(caught)) setError('Storage could not be read.')
      }
    })()
    return () => {
      alive = false
    }
  }, [projectPath, readProject])

  /* Any change to the rule throws the preview away: what is confirmed is what was shown. */
  useEffect(() => {
    setPlan(null)
    setArmed(false)
  }, [scope, age, unit, keep])

  const days = Math.max(1, Math.trunc(age || 0)) * UNITS[unit]

  const run = useCallback(
    async (request: Parameters<typeof storage>[1]) => {
      setBusy(true)
      setError(null)
      try {
        const answer = await storage(projectPath, request, finished)
        if (!answer.ok) {
          setError(answer.error)
          return null
        }
        return answer
      } catch (caught) {
        if (!unanswered(caught)) setError('That could not be done.')
        return null
      } finally {
        setBusy(false)
      }
    },
    [projectPath, finished],
  )

  const onPreview = async () => {
    setSaid(null)
    const answer = await run({ op: 'preview', scope, days })
    if (answer) setPlan(answer.plan)
  }

  const onPurge = async () => {
    if (!plan) return
    if (!armed) {
      setArmed(true)
      return
    }
    const answer = await run({ op: 'purge', scope, days, digest: plan.digest, keep, confirm: true })
    setArmed(false)
    setPlan(null)
    if (!answer) return
    setReport(answer.report)
    setSaid(answer.said)
    onChanged()
  }

  const onBackup = async (op: 'restore' | 'discard', name: string) => {
    const answer = await run({ op, name })
    if (!answer) return
    setReport(answer.report)
    setSaid(answer.said)
    onChanged()
  }

  const total = report?.total ?? 0
  const nothing = plan !== null && plan.lists === 0 && plan.targets === 0

  return (
    <section
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-storage={report ? report.lists.length : 'reading'}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      <div className="flex shrink-0 items-baseline gap-1.5 px-2 py-1.5">
        <h2 className="min-w-0 flex-1 text-[0.8rem] font-semibold">Storage</h2>
        <Button type="button" variant="ghost" size="container" data-back onClick={onBack} title="Back to what is in front of you.">
          Back
        </Button>
      </div>

      <div className={cn('border-t', room.pinned && 'min-h-0 flex-1 overflow-y-auto')} data-scroller={room.pinned ? 'storage' : undefined}>
        <p className="px-2 py-1.5 text-[0.7rem] leading-4" data-storage-total={total}>
          {report
            ? `All checklists in this project take ${bytes(total)} in .kehikot/checklist.`
            : 'Measuring.'}
          {report && room.prose
            ? finished
              ? ` Finished targets are counted from the tracker’s reading (${finished.length} closed or merged).`
              : ' No tracker reading was handed over, so finished targets are not counted.'
            : ''}
        </p>
        {report?.trouble ? <p className="px-2 pb-1.5 text-[0.7rem] leading-4 text-failed">{report.trouble}</p> : null}

        {report && report.lists.length ? (
          <ul className="border-t" data-usage>
            {report.lists.map((row) => (
              <li key={row.id} className="border-t px-2 py-1.5 first:border-t-0" data-usage-row={row.id}>
                <div className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 break-words text-[0.75rem] leading-4">{row.name}</span>
                  <span className="shrink-0 text-[0.7rem] tabular-nums">{bytes(row.bytes)}</span>
                </div>
                <p className="text-[0.65rem] leading-4 text-muted-foreground">
                  {`held against ${row.held} · ${row.released} released with ticks kept · ${row.ticks} ticks`}
                  {row.finished !== null ? ` · ${row.finished} finished` : ''}
                  {` · last activity ${row.last ? row.last.slice(0, 10) : 'none on record'}`}
                </p>
              </li>
            ))}
          </ul>
        ) : report ? (
          <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">No checklists in this project.</p>
        ) : null}

        {report && report.backups.length ? (
          <div className="border-t px-2 py-1.5" data-backups={report.backups.length}>
            <h3 className="text-[0.7rem] font-semibold">Purge backups</h3>
            <ul>
              {report.backups.map((one) => (
                <li key={one.name} className="flex flex-wrap items-baseline gap-1.5 py-0.5 text-[0.65rem] leading-4" data-backup={one.name}>
                  <span className="min-w-0 flex-1">
                    {`${one.at.slice(0, 10)}: ${one.lists ? `${one.lists} lists, ` : ''}${one.targets} targets, ${one.ticks} ticks · ${bytes(one.bytes)} · kept until ${one.expires.slice(0, 10)}`}
                  </span>
                  <Button type="button" variant="ghost" size="container" disabled={busy} onClick={() => void onBackup('restore', one.name)}>
                    Put back
                  </Button>
                  <Button type="button" variant="ghost" size="container" disabled={busy} onClick={() => void onBackup('discard', one.name)} title="Deletes the backup now. What is in it cannot be put back afterwards.">
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form
          className="flex flex-col gap-1 border-t px-2 py-1.5"
          data-purge
          onSubmit={(e) => {
            e.preventDefault()
            void onPreview()
          }}
        >
          <h3 className="text-[0.7rem] font-semibold">Purge</h3>
          <label className="flex flex-col gap-0.5 text-[0.65rem] leading-4">
            <span className="text-muted-foreground">Remove</span>
            <select
              aria-label="What to purge"
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="rounded border bg-background px-1 py-0.5 text-[0.7rem]"
            >
              {(Object.keys(SCOPE_WORDS) as Scope[]).map((one) => (
                <option key={one} value={one} disabled={one === 'finished' && !finished}>
                  {SCOPE_WORDS[one].label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-1 text-[0.65rem] leading-4">
            <span className="text-muted-foreground">{SCOPE_WORDS[scope].age}</span>
            <input
              aria-label="How old"
              type="number"
              min={1}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
              className="w-14 rounded border bg-background px-1 py-0.5 text-[0.7rem] tabular-nums"
            />
            <select aria-label="Days or months" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className="rounded border bg-background px-1 py-0.5 text-[0.7rem]">
              <option value="days">days</option>
              <option value="months">months</option>
            </select>
            <span className="text-muted-foreground">ago</span>
          </div>
          <label className="flex items-center gap-1 text-[0.65rem] leading-4">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} aria-label="Keep a backup" />
            <span>Keep a backup for 30 days, so it can be put back</span>
          </label>
          {!keep ? (
            <p className="text-[0.65rem] leading-4 text-failed" data-permanent>
              Without a backup a purge is permanent: nothing it removes can be put back.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="submit" variant="outline" size="container" disabled={busy || !(age >= 1)}>
              Preview
            </Button>
            {plan && !nothing ? (
              <Button
                type="button"
                size="container"
                variant={armed ? 'default' : 'outline'}
                className={armed ? 'bg-failed text-background' : undefined}
                disabled={busy}
                data-purge-go={armed ? 'armed' : 'ready'}
                onClick={() => void onPurge()}
              >
                {armed ? 'Press again to purge' : 'Purge…'}
              </Button>
            ) : null}
          </div>

          {plan ? (
            <div className="rounded border bg-muted/40 px-1.5 py-1 text-[0.65rem] leading-4" data-plan={plan.digest}>
              {nothing ? (
                <p>Nothing matches, so nothing would be removed.</p>
              ) : (
                <>
                  <p>
                    {plan.lists
                      ? `Would remove ${plan.lists} ${plan.lists === 1 ? 'checklist' : 'checklists'}`
                      : `Would remove ${plan.targets} ${plan.targets === 1 ? 'target' : 'targets'}`}
                    {` with ${plan.ticks} ${plan.ticks === 1 ? 'tick' : 'ticks'}, freeing ${bytes(plan.frees)}`}
                    {keep ? ' once its 30-day backup expires or is deleted.' : '. Permanent.'}
                  </p>
                  <ul className="mt-0.5">
                    {plan.rows.map((row) => (
                      <li key={row.id} data-plan-row={row.id}>
                        {row.whole
                          ? `${row.name}: the whole list (${row.targets} targets, ${row.ticks} ticks)`
                          : `${row.name}: ${row.targets} targets, ${row.ticks} ticks`}
                        {` · ${bytes(row.bytes)}`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}
          {said ? <p className="text-[0.65rem] leading-4" data-said>{said}</p> : null}
          {error ? <p className="text-[0.65rem] leading-4 text-failed">{error}</p> : null}
        </form>
      </div>
    </section>
  )
}

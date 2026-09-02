import { useCallback, useEffect, useMemo, useState } from 'react'

import { ID } from '../manifest.ts'

import {
  edit,
  everyChecklist,
  openChecklist,
  paperOutline,
  pointing,
  whatIsHere,
  type Edit,
  type Here,
  type Opened,
  type Outline,
  type Summary,
} from '@/store/ask.ts'
import { useRoadmap, type GotoHandler } from '@/wire/use-roadmap.ts'
import { AllView } from '@/view/all.tsx'
import { EditView } from '@/view/edit.tsx'
import { HereView } from '@/view/here.tsx'
import { Importing } from '@/view/importing.tsx'
import { Nowhere } from '@/view/nowhere.tsx'
import { wantedHeight } from '@/view/room.ts'
import { useRoom } from '@/view/use-room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The page.
 *
 * ## What it shows, and the sentence that decides it
 *
 * > "Its all about knowing what is selected or seen in the app that's important
 * > in the consumer/provider relationships."
 *
 * So the page opens on what is in front of the reader: every checklist held
 * against the section or file under their passage, or against a reference the
 * canvas has selected — several at once when several apply, none when none
 * does. That is `HereView`, and it is the default because it is the sentence.
 * From it, one press leads to a list's edit page (`EditView`), where what the
 * list says and what it is held against are changed, and one press leads to
 * every checklist in the project (`AllView`), where a list that is held
 * against nothing yet can still be found and started.
 *
 * Three screens, and which one is showing is `view` below: session state,
 * written down nowhere, opening on the reading page every time. A remembered
 * screen would be a container coming back tomorrow on the edit page of a list
 * somebody finished with.
 *
 * ## What used to be here, and why it is not
 *
 * This page used to open on a pick-or-create screen, remember the pick per
 * kehikko through the host's `state:keep`, show that ONE list, and decide on
 * every scroll which of that list's targets was in front — first by aiming it
 * at wherever the reader was, then by choosing among the targets it had ticks
 * on and calling anywhere else "not held here". The owner said, three times,
 * that a list's targets are ASSIGNED — in edit mode, to sections and files and
 * references, to stick — and that reading should show the lists assigned to
 * what is being read. Under that model a remembered pick answers a question
 * nobody asks: the reader's position and the lists' assignments between them
 * already say what is in front. So `list/keep.ts` is gone, `state:keep` is no
 * longer declared, and the kept string a host still holds is ignored.
 *
 * ## The empty filter offer, and why it is now safe to send
 *
 * This page used to offer the host a grain — `section` / `file` / `paper` —
 * over `roadmap.filters`, and there is an essay's worth of care in the history
 * about WHEN to send `[]`: an empty offer is a claim the host acts on by
 * pruning the container's stored choice, and sending it before the canvas had
 * spoken erased the reader's remembered grain on every reload. That care was
 * about a filter this page would offer again a moment later.
 *
 * There is no such filter now and there will not be one a moment later. The
 * grain trimmed the ladder one list was looked for on; with assignment there
 * is no trimming, and fewer lists in a section is a release on the edit page.
 * So `[]` is true at every moment, and it is sent once, when the host has
 * greeted this page, so a host still holding a grain for this container lets
 * it go rather than carrying it forever. The client replays the last offer on
 * every greeting, which is why once is enough.
 *
 * ## A null projectPath stops the page, and a null kehikko does not
 *
 * `projectPath` decides where the checklists ARE — the store lives at
 * `<projectPath>/.kehikot/checklist/checklists.json` — so without one there is
 * no file to read and nowhere to write, and the page says so and offers
 * nothing to press (`src/view/nowhere.tsx`). `kehikko` decided where a pick
 * was remembered, and nothing is remembered any more, so a host with no
 * canvases gets the ordinary page.
 *
 * ## Switching project repaints, without a reload
 *
 * `projectPath` is a dependency of every fetch below. A host that moves a
 * person to another project sends one `roadmap.context`, this hook sets one
 * piece of state, and everything is re-read from the new project's folder.
 * The path IS the partition, so a different project is a different file
 * rather than a different subset of one.
 *
 * ## Identity is printed only when nothing is framing this page
 *
 * A host prints the module's name in the container header. Unframed there is
 * no header, so the heading stays; the test is `window.parent !== window`,
 * which is answerable before first paint and therefore does not blink.
 */
const framed = typeof window !== 'undefined' && window.parent !== window

/** Which of the three screens is showing, and for the edit page, which list and where Done leads. */
type View = { kind: 'here' } | { kind: 'all' } | { kind: 'edit'; id: string; back: 'here' | 'all' }

export function App() {
  const [lists, setLists] = useState<Summary[]>([])
  const [storeTrouble, setStoreTrouble] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>({ kind: 'here' })

  /** What is in front of the reader, as the server last said. Null before it has said. */
  const [here, setHere] = useState<Here | null>(null)
  /** The list on the edit page, on its own, with what it is held against. */
  const [opened, setOpened] = useState<Opened | null>(null)

  /**
   * A checklist that was being edited and is not here any more.
   *
   * Not a refusal of anything somebody pressed — the store moved underneath
   * an open edit page, which happens when a list is removed on another machine
   * or in another container. Held so the screen the reader lands on can say
   * what happened rather than opening as though nothing had.
   */
  const [gone, setGone] = useState<string | null>(null)

  /**
   * The project somebody picked to copy a checklist out of, and what is in it.
   *
   * Never a folder this page went looking for. Filled only by `pickProject`,
   * which asks the host to ask a person, and emptied by anything going wrong.
   * A module that could enumerate projects has been handed the disk.
   */
  const [from, setFrom] = useState<{ path: string; name: string } | null>(null)
  const [importable, setImportable] = useState<Summary[]>([])
  const [choosing, setChoosing] = useState(false)

  /**
   * Bumped whenever the store may have changed under this page: an edit made
   * here, or an agent coming through the MCP door, which the pump in `emit.ts`
   * is already polling for in order to announce it. Every fetch below depends
   * on it, so somebody watching this container while an agent ticks items off
   * sees the ticks land.
   */
  const [stamp, setStamp] = useState(0)
  const bump = useCallback(() => setStamp((was) => was + 1), [])

  const onGoto = useCallback<GotoHandler>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference. This container shows
       the checklists in front of the reader, so the honest answer to all three
       is that there is nothing here to be walked to — saying so quickly is what
       gets the reader the host's fallback link instead of a twelve-second
       wait. */
    answer(
      false,
      message.ref
        ? 'This container shows the checklists held against what is in front of you, so there is nothing here to walk to by reference.'
        : 'This container shows checklists, so there is nothing here to walk to by epic or step.',
    )
  }, [])

  const { where, epic, projectPath, project, selection, passage, resize, filters, pickProject } = useRoadmap(
    ID,
    onGoto,
    bump,
  )

  /**
   * Where the reader is pointing, inflated once from the string the wire holds.
   *
   * Memoised on that string, so a context that re-states the same passage —
   * which is every context, since one arrives after any change anywhere on the
   * canvas — hands back the same object and does not re-run the fetch below.
   */
  const at = useMemo(() => pointing(passage), [passage])

  /** The references the canvas has selected, as one string, for the same reason. */
  const selected = selection.join(' ')

  /**
   * Whether there is anywhere at all to read from or write to.
   *
   * Held from the server's answer rather than derived from `projectPath`
   * alone, because the server is the one that knows: a path may be present and
   * still name nothing this app will write under. It starts false and is only
   * DRAWN once the greeting has settled — see the guard on `screen` below — so
   * a page that has not been greeted yet does not announce "no project is
   * open" for one frame and then correct itself.
   */
  const [nowhere, setNowhere] = useState(false)

  /* Withdraw the filter offer, once hosted. See the essay above. */
  useEffect(() => {
    if (where === 'hosted') filters([])
  }, [where, filters])

  /* Every checklist that exists. This app's own material, read at load, after
     every change, and on the doorbell. */
  useEffect(() => {
    void everyChecklist(projectPath)
      .then(({ lists: got, trouble: bad, nowhere: none }) => {
        setLists(got)
        setStoreTrouble(bad)
        setNowhere(none)
      })
      .catch(() => setLists([]))
  }, [stamp, projectPath])

  /**
   * What is in front of the reader. The reading page's one request, re-asked
   * whenever the reader moves, the canvas selects, or the store changes.
   *
   * `alive` rather than an abort, so a slower earlier answer cannot paint over
   * a newer one. The dependencies are all strings or memoised on strings, so a
   * context that repeats itself does not fire this.
   */
  useEffect(() => {
    let alive = true
    void whatIsHere(projectPath, epic, at, selected ? selected.split(' ') : [])
      .then((got) => {
        if (alive) setHere(got)
      })
      .catch(() => {
        if (alive) setHere(null)
      })
    return () => {
      alive = false
    }
  }, [projectPath, epic, at, selected, stamp])

  /** Which list the edit page is on, or null. A string, so the fetch keys on it by value. */
  const editing = view.kind === 'edit' ? view.id : null

  /**
   * The list being edited, on its own.
   *
   * A checklist that is not there any more is not an error to be printed and
   * left. The edit page gives way to the list of every checklist, which says
   * what happened — because a container stuck on a sentence about a list that
   * was removed on another machine is a container a reader has no way out of.
   */
  useEffect(() => {
    if (!editing) {
      setOpened(null)
      return
    }
    let alive = true
    void openChecklist(editing, projectPath)
      .then((answer) => {
        if (!alive) return
        if ('error' in answer) {
          setGone(editing)
          setView({ kind: 'all' })
          return
        }
        setOpened(answer)
        setGone(null)
      })
      .catch(() => {
        if (alive) setOpened(null)
      })
    return () => {
      alive = false
    }
  }, [editing, projectPath, stamp])

  /**
   * The last file of a paper the reader was in, for the session.
   *
   * The outline is found by climbing from a file to the one declaring the
   * document, so it needs a file to start from. A reader who walks from a
   * chapter to an issue and presses Edit has no passage at that moment, and
   * would otherwise be offered no chapters. This is the one place a position
   * outlives its context, and it is allowed because it decides only which
   * files are OFFERED — never which are held, and never what is shown.
   */
  const [lastReading, setLastReading] = useState<string | null>(null)
  useEffect(() => {
    if (at?.path) setLastReading(at.path)
  }, [at])
  const reading = at?.path ?? lastReading

  /**
   * The paper's files and headings, which the edit page offers as targets.
   *
   * Asked for while a list is being edited and not on every context: this
   * opens every file of a paper, and a context arrives after every selection
   * change anywhere on the canvas. Dropped when the file under the reader
   * changes, because an outline is a fact about the DOCUMENT the reader is in
   * and goes stale when they open one belonging to another paper — not when
   * they hold the list against a different section of the one they are in.
   */
  const [outline, setOutline] = useState<Outline | null>(null)
  useEffect(() => {
    setOutline(null)
  }, [reading, projectPath])

  useEffect(() => {
    if (!editing || !reading || !projectPath) return
    let alive = true
    void paperOutline(projectPath, reading)
      .then((got) => {
        if (alive) setOutline(got)
      })
      .catch(() => {
        /* Swallowed to null, which is the same answer as "the fence refused
           it" and draws the same one line. */
        if (alive) setOutline(null)
      })
    return () => {
      alive = false
    }
  }, [editing !== null, reading, projectPath])

  const onEdit = useCallback(
    async (change: Edit) => {
      setBusy(true)
      try {
        const answer = await edit(change, projectPath)
        if (!answer.ok) {
          setTrouble(answer.error)
          return
        }
        setTrouble(null)
        setLists(answer.lists)
        if (change.op === 'create' || change.op === 'import') {
          /* A list made here is opened here, on its edit page, because the
             next thing to do with a new list is say what it is held against
             — and a new list is held against nothing and shown nowhere until
             somebody does. The import screen is put away in the same breath. */
          setView({ kind: 'edit', id: answer.id, back: 'here' })
          setFrom(null)
          setImportable([])
        }
        if (change.op === 'forget') setView({ kind: 'all' })
        /* Everything is re-read from what the server now holds, never toggled
           locally: the server holds the order, the ticks and the targets, and
           a page that reordered itself on a refused write would show an order
           the file does not have. */
        bump()
      } finally {
        setBusy(false)
      }
    },
    [bump, projectPath],
  )

  const onCreate = useCallback((name: string) => void onEdit({ op: 'create', name }), [onEdit])

  /**
   * Ask the host to ask the person which project, then read what is in it.
   *
   * Every "nothing" — cancelled, declined, no host at all, a host too old to
   * have heard of the method — comes back the same way and is treated the same
   * way: the press un-presses and the screen does not change. The protocol
   * deliberately makes "you have no projects" and "I would rather not"
   * indistinguishable.
   */
  const onImport = useCallback(async () => {
    setChoosing(true)
    setTrouble(null)
    try {
      const picked = await pickProject()
      if (!picked) return
      const { lists: there, trouble: bad } = await everyChecklist(picked.path)
      setFrom(picked)
      setImportable(there)
      /* The refusal from the OTHER project's read, shown on the screen that is
         about that project — not in `storeTrouble`, which is about this one. */
      setTrouble(bad)
    } catch {
      /* A fetch to this app's own origin that did not happen. Nothing here a
         reader can act on. */
    } finally {
      setChoosing(false)
    }
  }, [pickProject])

  const onImportCancel = useCallback(() => {
    setFrom(null)
    setImportable([])
    setTrouble(null)
  }, [])

  /* Dropped whenever the open project changes: another project's checklists
     answer "what could I copy INTO this one", and the moment the reader is
     moved somewhere else it is an answer to a question nobody asked. The edit
     page is left too, for the same reason — its list belongs to the project
     that was open. */
  useEffect(() => {
    setFrom(null)
    setImportable([])
    setView({ kind: 'here' })
  }, [projectPath])

  /**
   * The shell element, held as STATE rather than in a ref, because `useRoom`
   * attaches a `ResizeObserver` to it and an effect keyed on a ref cannot know
   * when the ref was filled.
   */
  const [shell, setShell] = useState<HTMLDivElement | null>(null)
  const room = useRoom(shell)

  /** Say how tall we would like to be, whenever what is drawn changes size. See `wantedHeight`. */
  useEffect(() => {
    if (!shell || typeof ResizeObserver === 'undefined') return
    const say = () => {
      const scroller = shell.querySelector<HTMLElement>('[data-scroller]')
      resize(
        wantedHeight(
          shell.getBoundingClientRect().height,
          scroller?.scrollHeight ?? 0,
          scroller?.clientHeight ?? 0,
        ) + 16,
      )
    }
    const watch = new ResizeObserver(say)
    watch.observe(shell)
    say()
    return () => watch.disconnect()
  })

  const screen = nowhere && where !== 'listening' ? (
    /* Above every other screen, because it is not a variant of any of them —
       there is nothing to read from and nothing to write to. */
    <Nowhere unhosted={where === 'unhosted'} project={project} />
  ) : from ? (
    /* Above the others on purpose. Somebody who is mid-import pressed Copy
       from the list of every checklist, and putting this under anything would
       mean pressing Copy and watching nothing happen. */
    <Importing
      from={from.name || from.path}
      lists={importable}
      onImport={(id) => void onEdit({ op: 'import', from: from.path, id })}
      onCancel={onImportCancel}
      trouble={trouble}
      busy={busy}
      reading={choosing}
      room={room}
    />
  ) : view.kind === 'edit' ? (
    opened ? (
      <EditView
        held={opened.held}
        targets={opened.targets}
        epic={epic}
        selection={selection}
        placed={here?.placed ?? null}
        outline={outline}
        paperKnown={reading !== null}
        onEdit={(change) => void onEdit(change)}
        onDone={() => setView({ kind: view.back })}
        trouble={trouble}
        busy={busy}
        room={room}
      />
    ) : (
      <p className="px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
        {trouble ?? 'Reading that checklist.'}
      </p>
    )
  ) : view.kind === 'all' ? (
    <AllView
      lists={lists}
      onOpen={(id) => setView({ kind: 'edit', id, back: 'all' })}
      onCreate={onCreate}
      onImport={() => void onImport()}
      onBack={() => {
        setGone(null)
        setView({ kind: 'here' })
      }}
      importing={choosing}
      trouble={trouble}
      busy={busy}
      said={gone ? 'That checklist is gone — removed here, or on another machine.' : null}
      room={room}
    />
  ) : (
    <HereView
      here={here}
      somewhere={Boolean(epic) || selection.length > 0}
      listening={where === 'listening'}
      onEdit={(change) => void onEdit(change)}
      onOpen={(id) => setView({ kind: 'edit', id, back: 'here' })}
      onAll={() => setView({ kind: 'all' })}
      trouble={trouble}
      busy={busy}
      room={room}
    />
  )

  /**
   * The shell, and the one line that decides whether this page scrolls or its
   * list does. Flowing, it is a column as tall as what it draws. Pinned, it is
   * exactly the height of the frame with `min-h-0`, which is what lets the one
   * scroller inside it be shorter than its content. No padding on it: the rows
   * keep their own `px-2`, and the dividers run the full width like the host's.
   */
  return (
    <div
      ref={setShell}
      className={cn('flex flex-col gap-2 text-foreground', room.pinned && 'h-dvh min-h-0')}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      {framed ? null : (
        <header className="shrink-0 px-2 pt-2">
          <h1 className="text-sm font-semibold">Checklist</h1>
          <p className="text-[0.7rem] leading-4 text-muted-foreground">
            {room.prose
              ? 'Checklists somebody wrote, each held against the issues, changes, paper files and sections a person '
                + 'assigned it to, and shown wherever one of those is in front of the reader. Nothing here ships a list: '
                + 'every item is a line a person or an agent typed, and every tick belongs to a checklist, an item and a '
                + 'target together.'
              : 'Lists somebody wrote, shown against the issue, change, file or section in front of you.'}
          </p>
        </header>
      )}

      {/* A refusal, marked as one, kept off the host's edge so it reads as
          something this page is saying rather than as the host's chrome. */}
      {storeTrouble ? (
        <p className="mx-2 mt-2 shrink-0 rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
          {storeTrouble}
        </p>
      ) : null}

      {screen}
    </div>
  )
}

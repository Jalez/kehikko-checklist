import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button.tsx'

/**
 * One thing, over the whole frame, while it is being done.
 *
 * ## Why an overlay rather than a strip at the bottom
 *
 * Because of what the strip cost. Measured at 220×300 with six items in the
 * list, the add-a-line box — a label, a two-line textarea, a button and a
 * sentence — was 147 pixels of a 300-pixel frame. Half the container was spent,
 * permanently, on a control somebody uses for eight seconds every few minutes,
 * and the thing the container is for was in the other half. The same is true of
 * the create box on the pick screen and of the target switch, which expands
 * inline and pushes the list it is about off the bottom.
 *
 * Over the frame, each of them costs one small button until it is wanted, and
 * then gets more room than it ever had: a full-height textarea instead of two
 * rows, the whole width for a list of targets instead of a wrapping strip.
 *
 * ## It is not a `<dialog>`, and that is not an aesthetic choice
 *
 * The host frames this module with `allow-scripts allow-forms allow-popups
 * allow-same-origin` and no `allow-modals`. `showModal()` throws in a sandbox
 * without it, and `window.confirm` — which this page used to call — is ignored
 * outright and returns false, which is how a Remove button spent a while doing
 * nothing at all with nothing in the console. See the essay on the two-press arm
 * in `checklist.tsx`. So this is a positioned element and a piece of state:
 * nothing about it needs permission from anybody's sandbox.
 *
 * `fixed inset-0` is the frame and only the frame. A module cannot cover its
 * host and must not try.
 *
 * ## What closes it
 *
 * Escape, the button that says Close, and finishing whatever it was opened for.
 * Not a click on the backdrop, because there is no backdrop: at 220 pixels wide
 * an overlay that left a margin to click outside of would be giving up the
 * width it was opened to get.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  /** What is being done, in the words the button that opened it used. */
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  /* The first field is focused because this opened in answer to a press that
     said what it was for. A reader who pressed "Add a line" and then had to
     find the box would have been better served by the strip. */
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('textarea, input')?.focus()
  }, [])

  return (
    <div
      ref={box}
      data-sheet={title}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-10 flex flex-col bg-background"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <h2 className="min-w-0 flex-1 break-words text-[0.8rem] font-semibold">{title}</h2>
        <Button type="button" variant="ghost" size="container" onClick={onClose} data-sheet-close>
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </div>
  )
}

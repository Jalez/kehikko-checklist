import { useEffect, useMemo, useState } from 'react'

import { room, type Room } from './room.ts'

/**
 * The room this container has, as one React value, watched from two places
 * because the two axes are not the same kind of fact.
 *
 * The WIDTH is the container's own, read off the element `src/index.css` names
 * as the container, through a `ResizeObserver`. Never `window.innerWidth`: that
 * is the frame's viewport, and this app's whole layout rule is that the frame's
 * viewport is not the container's width in any way a module may rely on.
 *
 * The HEIGHT is the frame's, and there is nothing else it could be. The element
 * is as tall as what it draws — that is the point of reporting a height to the
 * host at all — so observing it would answer "how tall is the content", when the
 * question is "how much room is there". `window.innerHeight` inside an iframe is
 * the frame's inner height and changes when the host resizes the frame, which is
 * exactly the event this has to hear.
 *
 * Both start at zero and the first reading lands in the same frame the observer
 * is attached, so nothing is drawn against a made-up size for longer than one
 * paint. Zero is deliberately the SMALL end of every threshold: a page that
 * guessed "roomy" and then collapsed would be the flicker `use-roadmap.ts`
 * spends a paragraph avoiding, and collapsing to the small layout is the one
 * that is never wrong about what fits.
 */
export function useRoom(node: HTMLElement | null): Room {
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    /*
     * The BORDER box, not `contentRect`.
     *
     * `contentRect` is the content box and takes the shell's own padding off —
     * 16 pixels of it — so a 220-pixel container measures 204 and every threshold in
     * `room.ts` sits sixteen pixels away from the number it was measured at.
     * That is not a rounding error: 360 was chosen because a row's furniture
     * fits on one line at a 360-pixel container, and a reading of 344 would fold it
     * away in exactly the container it was measured not to need folding in.
     */
    const watch = new ResizeObserver(() => setWidth(node.getBoundingClientRect().width))
    watch.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => watch.disconnect()
  }, [node])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = () => setHeight(window.innerHeight)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  return useMemo(() => room(width, height), [width, height])
}

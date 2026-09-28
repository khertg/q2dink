import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { Picture } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  coverScale,
  cropFromView,
  frameSize,
  initialView,
  panView,
  zoomView,
  type Crop,
  type Frame,
  type View,
} from '@/lib/crop'

/** Side of the square frame the avatar picture is dragged under, in CSS pixels. */
const AVATAR_FRAME = 256

/** The shape the frame shows: a circle (avatars, round logos), rounded corners, or a plain rectangle. */
export type CropMask = 'circle' | 'rounded' | 'rect'

const MASK_CLASS: Record<CropMask, string> = { circle: 'rounded-full', rounded: 'rounded-[20%]', rect: '' }

interface Props {
  picture: Picture
  busy?: boolean
  /** The chosen part of the picture, in its own pixels. */
  onConfirm: (crop: Crop) => void
  onCancel: () => void
  /** The frame the picture is dragged under (a 256px square by default). */
  frame?: Frame
  mask?: CropMask
  confirmLabel?: string
}

/** Round to whole pixels without ever leaving the picture. */
function whole(crop: Crop, width: number, height: number): Crop {
  const sw = Math.max(1, Math.min(width, Math.round(crop.sw)))
  const sh = Math.max(1, Math.min(height, Math.round(crop.sh)))
  return {
    sx: Math.max(0, Math.min(width - sw, Math.round(crop.sx))),
    sy: Math.max(0, Math.min(height - sh, Math.round(crop.sy))),
    sw,
    sh,
  }
}

/** Choose which part of a picked picture to keep: drag and zoom it under a frame (round by default, for avatars). */
export function PhotoCropper({
  picture,
  busy,
  onConfirm,
  onCancel,
  frame: FRAME = AVATAR_FRAME,
  mask = 'circle',
  confirmLabel = 'Use photo',
}: Props) {
  const { width, height } = picture
  const box = frameSize(FRAME)
  const { width: frameWidth, height: frameHeight } = box
  const [view, setView] = useState<View>(initialView)
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number } | null>(null)

  const scale = coverScale(width, height, FRAME) * view.zoom
  const crop = whole(cropFromView(view, width, height, FRAME), width, height)

  // The scroll wheel zooms around the pointer. It needs a listener that may cancel the page scroll.
  useEffect(() => {
    const element = stage.current
    if (!element) return
    function handleWheel(event: WheelEvent) {
      event.preventDefault()
      const rect = element!.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left - frameWidth / 2, y: event.clientY - rect.top - frameHeight / 2 }
      const frame = { width: frameWidth, height: frameHeight }
      setView((v) => zoomView(v, v.zoom * Math.exp(-event.deltaY * 0.0015), width, height, frame, anchor))
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [width, height, frameWidth, frameHeight])

  function handleDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) }
    }
  }

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const now = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, now)

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const rect = stage.current!.getBoundingClientRect()
      const anchor = { x: (a.x + b.x) / 2 - rect.left - box.width / 2, y: (a.y + b.y) / 2 - rect.top - box.height / 2 }
      const ratio = pinch.current.distance > 0 ? distance / pinch.current.distance : 1
      pinch.current.distance = distance
      setView((v) => zoomView(v, v.zoom * ratio, width, height, FRAME, anchor))
      return
    }
    setView((v) => panView(v, now.x - last.x, now.y - last.y, width, height, FRAME))
  }

  function handleUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10
    const move = (dx: number, dy: number) => {
      event.preventDefault()
      setView((v) => panView(v, dx, dy, width, height, FRAME))
    }
    // Arrow keys nudge the picture the way a drag would: the picture follows the arrow.
    if (event.key === 'ArrowLeft') move(-step, 0)
    else if (event.key === 'ArrowRight') move(step, 0)
    else if (event.key === 'ArrowUp') move(0, -step)
    else if (event.key === 'ArrowDown') move(0, step)
    else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setView((v) => zoomView(v, v.zoom + 0.1, width, height, FRAME))
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      setView((v) => zoomView(v, v.zoom - 0.1, width, height, FRAME))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setView(initialView())
    }
  }

  const shownWidth = width * scale
  const shownHeight = height * scale

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <div
          ref={stage}
          role="group"
          tabIndex={0}
          aria-label="Crop area. Drag the picture to move it, pinch or scroll to zoom. Arrow keys move it, plus and minus zoom."
          data-testid="crop-stage"
          data-crop={`${crop.sx},${crop.sy},${crop.sw},${crop.sh}`}
          data-zoom={view.zoom.toFixed(2)}
          className="relative touch-none overflow-hidden rounded-lg bg-black select-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          style={{ width: box.width, height: box.height, cursor: 'grab' }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          onKeyDown={handleKey}
        >
          <img
            src={picture.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{
              width: shownWidth,
              height: shownHeight,
              left: box.width / 2 + view.ox - shownWidth / 2,
              top: box.height / 2 + view.oy - shownHeight / 2,
            }}
          />
          {/* The frame: everything outside its shape is dimmed. */}
          <div
            aria-hidden
            className={cn('pointer-events-none absolute inset-0 ring-2 ring-white/80', MASK_CLASS[mask])}
            style={{ boxShadow: '0 0 0 999px rgba(0,0,0,0.55)' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="crop-zoom" className="text-sm font-medium">
          Zoom
        </label>
        <input
          id="crop-zoom"
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          className="h-2 flex-1 accent-primary"
          onChange={(e) => setView((v) => zoomView(v, Number(e.target.value), width, height, FRAME))}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Back
        </Button>
        <Button type="button" disabled={busy} onClick={() => onConfirm(crop)}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

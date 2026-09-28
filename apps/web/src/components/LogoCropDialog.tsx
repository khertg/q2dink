import { useState } from 'react'
import { PhotoCropper, type CropMask } from '@/components/PhotoCropper'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Picture } from '@/lib/avatar'
import type { LogoCut } from '@/lib/logoImage'
import { LOGO_SHAPES, shapeFrame, type LogoShape } from '@/lib/logoShape'
import { cn } from '@/lib/utils'

const MASK: Record<Exclude<LogoShape, 'original'>, CropMask> = {
  circle: 'circle',
  square: 'rect',
  rounded: 'rounded',
  wide: 'rect',
}

// A checkerboard, so a white logo shows.
const CHECKERBOARD = 'repeating-conic-gradient(#94a3b8 0% 25%, #e2e8f0 0% 50%) 50% / 12px 12px'

interface Props {
  /** The picked file, decoded; the dialog is open while it is set. */
  picture: Picture | null
  busy?: boolean
  /** Add the logo: the whole picture (no cut) or the part chosen, cut to its shape. */
  onAdd: (cut?: LogoCut) => void
  onCancel: () => void
}

/** Before a club logo is added: keep the whole picture, or cut it to a circle, a square, rounded or wide. */
export function LogoCropDialog({ picture, busy, onAdd, onCancel }: Props) {
  const [shape, setShape] = useState<LogoShape>('original')

  return (
    <Dialog open={picture !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add logo</DialogTitle>
          <DialogDescription>
            Keep the whole picture, or choose a shape and move and zoom it so the part you want is inside.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Shape" className="flex flex-wrap justify-center gap-2">
          {LOGO_SHAPES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={shape === value}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium',
                shape === value ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted',
              )}
              onClick={() => setShape(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {picture &&
          (shape === 'original' ? (
            <div className="space-y-4">
              <div className="flex justify-center rounded-lg p-3" style={{ background: CHECKERBOARD }}>
                <img src={picture.url} alt="The whole logo" className="max-h-48 max-w-full object-contain" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
                  Back
                </Button>
                <Button type="button" disabled={busy} onClick={() => onAdd()}>
                  Add logo
                </Button>
              </div>
            </div>
          ) : (
            // Keyed by shape: a new frame starts from the whole picture again.
            <PhotoCropper
              key={shape}
              picture={picture}
              busy={busy}
              frame={shapeFrame(shape)}
              mask={MASK[shape]}
              confirmLabel="Add logo"
              onConfirm={(crop) => onAdd({ crop, shape })}
              onCancel={onCancel}
            />
          ))}
      </DialogContent>
    </Dialog>
  )
}

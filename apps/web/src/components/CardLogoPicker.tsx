import { MEDIA_LIMITS, type CardLogoChoice } from '@q2dink/shared'
import { ImagePlus, X } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { forgetCardLogo, pickCardLogo, saveCardLogo } from '@/cloud/sync'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { CardLogoRow } from '@/db/db'
import { LogoCropDialog } from '@/components/LogoCropDialog'
import { ImageError, loadPicture, type Picture } from '@/lib/avatar'
import { autoLogo } from '@/lib/cardLogos'
import type { CardColors } from '@/lib/cardPalette'
import { processLogo, type LogoCut } from '@/lib/logoImage'
import { useCardLogo } from '@/lib/useCardLogo'
import { cn } from '@/lib/utils'

// A checkerboard, so a white logo shows on the light pop-up.
const CHECKERBOARD = 'repeating-conic-gradient(#94a3b8 0% 25%, #e2e8f0 0% 50%) 50% / 12px 12px'
const OPTION = 'flex h-11 shrink-0 items-center justify-center rounded-lg border px-2 text-xs font-medium ring-offset-2 ring-offset-background'
const SELECTED = 'ring-2 ring-foreground'

/**
 * Which of the club's logos the share cards show: Automatic (the one that stands out on the card's colour), one staff
 * pick, or none; and the club's logos themselves (its logo in several colours), added and removed here.
 */
export function CardLogoPicker({ colors }: { colors: CardColors }) {
  const { logos, choice } = useCardLogo(colors)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [picture, setPicture] = useState<Picture | null>(null)
  const [removing, setRemoving] = useState<CardLogoRow | null>(null)
  const full = logos.length >= MEDIA_LIMITS.cardLogos
  const auto = autoLogo(logos, colors)
  const number = (logo: CardLogoRow) => logos.indexOf(logo) + 1
  const isPicked = (logo: CardLogoRow) => typeof choice === 'object' && choice.id === logo.id

  const failed = (error: unknown) =>
    toast.error(error instanceof ImageError || error instanceof RangeError ? error.message : 'That logo could not be added.')

  /** A file was picked: decode it for the shape step. */
  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setPicture(await loadPicture(file))
    } catch (error) {
      failed(error)
    }
  }

  function closeCrop() {
    picture?.release()
    setPicture(null)
  }

  async function add(cut?: LogoCut) {
    if (!picture) return
    setBusy(true)
    try {
      const { dataUrl, tone } = await processLogo(picture.file, cut)
      await saveCardLogo(dataUrl, tone)
      closeCrop()
    } catch (error) {
      failed(error)
    } finally {
      setBusy(false)
    }
  }

  const choose = (next: CardLogoChoice, label: string) => void pickCardLogo(next, label)

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Logo" className="flex flex-wrap items-center justify-center gap-2">
        {logos.length > 0 && (
          <button
            type="button"
            role="radio"
            aria-checked={choice === 'auto'}
            className={cn(OPTION, choice === 'auto' && SELECTED)}
            onClick={() => choose('auto', 'automatic')}
          >
            Automatic
          </button>
        )}
        {logos.map((logo) => (
          <span key={logo.id} className="relative">
            <button
              type="button"
              role="radio"
              aria-checked={isPicked(logo)}
              aria-label={`Logo ${number(logo)}`}
              className={cn(OPTION, 'w-16 p-1', isPicked(logo) && SELECTED)}
              style={{ background: CHECKERBOARD }}
              onClick={() => choose({ id: logo.id }, `logo ${number(logo)}`)}
            >
              <img src={logo.data} alt="" className="max-h-full max-w-full object-contain" />
            </button>
            <button
              type="button"
              aria-label={`Remove logo ${number(logo)}`}
              title="Remove"
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
              onClick={() => setRemoving(logo)}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {logos.length > 0 && (
          <button
            type="button"
            role="radio"
            aria-checked={choice === 'none'}
            className={cn(OPTION, choice === 'none' && SELECTED)}
            onClick={() => choose('none', 'none')}
          >
            No logo
          </button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={full}
          title={full ? `A club can keep ${MEDIA_LIMITS.cardLogos} logos` : undefined}
          onClick={() => input.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          Add logo
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Logo file"
          className="hidden"
          onChange={(e) => void handleFile(e)}
        />
      </div>
      {choice === 'auto' && auto && logos.length > 1 && (
        <p className="text-center text-xs text-muted-foreground">
          Automatic uses logo {number(auto)} on this colour, the one that stands out best.
        </p>
      )}
      {logos.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Add your club’s logo, in as many colours as you have: each card uses the one that stands out best.
        </p>
      )}

      {/* Keyed by the picture, so each new file starts on Original again. */}
      <LogoCropDialog key={picture?.url ?? 'none'} picture={picture} busy={busy} onAdd={(cut) => void add(cut)} onCancel={closeCrop} />

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove logo {removing ? number(removing) : ''}?</DialogTitle>
            <DialogDescription>It is removed for every staff device of the club.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removing) void forgetCardLogo(removing.id)
                setRemoving(null)
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

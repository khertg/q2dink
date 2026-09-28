import { Download, Share2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { CardColorPicker } from '@/components/CardColorPicker'
import { CardLogoPicker } from '@/components/CardLogoPicker'
import { StatsCard } from '@/components/StatsCard'
import { useCardImages } from '@/components/useCardImages'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cardColors, useCardChoice } from '@/lib/cardPalette'
import { useCardLogo } from '@/lib/useCardLogo'
import { canShareNatively, cardFileNames, downloadImages, shareImages } from '@/lib/share'
import type { Standing } from '@/rotation/standings'

interface Props {
  standing: Standing
  location: string
  date: string
}

const fileSafe = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** A player's stats card, shared as a PNG image (see useCardImages). */
export function StatsCardDialog({ standing, location, date }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const native = canShareNatively()
  const colors = cardColors(useCardChoice((s) => s.choice))
  const { logo } = useCardLogo(colors)
  const { name, rank, medal, wins, losses, games, winRate } = standing
  const { files, failed, retry } = useCardImages({
    open,
    // What the card shows, so an image made for other colours or results is never shared.
    imageKey: JSON.stringify([colors.from, colors.to, colors.text, logo?.id, logo?.v, location, date, name, rank, medal, wins, losses, games, winRate]),
    cards: () => [cardRef.current],
    fileNames: (count) => cardFileNames(`${fileSafe(name) || 'player'}-q2dink-stats`, count),
  })

  // Nothing is awaited before the share sheet opens, so the tap still counts when it does.
  function handleShare() {
    if (files) void shareImages({ files, title: `${name}'s Q2Dink stats`, text: `Finished #${rank} at ${location}` })
  }

  function handleDownload() {
    if (files) downloadImages(files)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Share card for ${name}`}>
          <Share2 />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stats card</DialogTitle>
          <DialogDescription>A square image for Instagram, Facebook, Messenger or WhatsApp.</DialogDescription>
        </DialogHeader>
        <CardColorPicker />
        <CardLogoPicker colors={colors} />
        <div className="flex justify-center overflow-hidden rounded-lg">
          <StatsCard
            ref={cardRef}
            standing={standing}
            location={location}
            date={date}
            colors={colors}
            logo={logo?.data}
          />
        </div>
        {failed ? (
          <div role="alert" className="space-y-2 text-center text-sm">
            <p className="text-destructive">Could not create the image.</p>
            <Button type="button" variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <Button className="h-11 w-full" onClick={handleShare} disabled={!files}>
              {native ? <Share2 /> : <Download />}{' '}
              {!files ? 'Preparing image…' : native ? 'Share card' : 'Download image'}
            </Button>
            {native && (
              <Button type="button" variant="ghost" className="w-full" onClick={handleDownload} disabled={!files}>
                <Download /> Download image instead
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

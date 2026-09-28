import { Download, Share2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useClubAuth } from '@/cloud/auth'
import { viewerUrl } from '@/cloud/url'
import { CardColorPicker } from '@/components/CardColorPicker'
import { CardLogoPicker } from '@/components/CardLogoPicker'
import { StandingsCard } from '@/components/StandingsCard'
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
import { Input } from '@/components/ui/input'
import { cardColors, useCardChoice } from '@/lib/cardPalette'
import { useCardLogo } from '@/lib/useCardLogo'
import { canShareNatively, cardFileNames, downloadImages, shareImages } from '@/lib/share'
import { pageStandings, type Standing } from '@/rotation/standings'
import type { SessionState } from '@/rotation/types'
import { repeatStats } from '@/rotation/repeats'

interface Props {
  session: SessionState
  location: string
  standings: Standing[]
  date: string
  /** Whether repeat stats can be computed (the running session and saved ones; not the public viewer). */
  repeatStats?: boolean
}

export function ShareStandingsDialog({ session, location, standings, date, repeatStats: withRepeats = false }: Props) {
  const club = useClubAuth((s) => s.club)
  const url = club ? viewerUrl(club.slug) : undefined
  const pages = pageStandings(standings)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const colors = cardColors(useCardChoice((s) => s.choice))
  const { logo } = useCardLogo(colors)
  const top = withRepeats ? repeatStats(session).summary.topPartnership : undefined
  const topPartnership = top
    ? { names: [session.players[top.a]?.name ?? 'Unknown', session.players[top.b]?.name ?? 'Unknown'] as [string, string], count: top.count }
    : undefined
  const [open, setOpen] = useState(false)
  // What the cards show, so an image made for other colours or results is never shared.
  const imageKey = JSON.stringify([
    colors.from,
    colors.to,
    colors.text,
    logo?.id,
    logo?.v,
    location,
    date,
    topPartnership?.names,
    pages.map((page) => page.map((row) => [row.id, row.name, row.rank, row.wins, row.losses, row.diff, row.scoredGames])),
  ])
  const { files, failed, retry } = useCardImages({
    open,
    imageKey,
    cards: () => pages.map((_, i) => refs.current[i]),
    fileNames: (count) => cardFileNames('q2dink-standings', count),
  })

  // Nothing is awaited before the share sheet opens, so the tap still counts when it does.
  function handleShare() {
    if (!files) return
    void shareImages({ files, title: 'Q2Dink standings', text: `Standings at ${location}`, url })
  }

  function handleDownload() {
    if (files) downloadImages(files)
  }

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied')
    } catch {
      toast.error('Could not copy. Select the link and copy it by hand.')
    }
  }

  const native = canShareNatively()
  const label = pages.length > 1 ? (native ? `Share ${pages.length} images` : `Download ${pages.length} images`) : native ? 'Share standings' : 'Download image'
  const downloadLabel = pages.length > 1 ? `Download ${pages.length} images instead` : 'Download image instead'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Share2 /> Share standings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share standings</DialogTitle>
          <DialogDescription>
            {pages.length > 1
              ? `${pages.length} images of up to 10 players each, ready for a group chat.`
              : 'An image of the standings, ready for a group chat.'}
          </DialogDescription>
        </DialogHeader>
        <CardColorPicker />
        <CardLogoPicker colors={colors} />
        <div className="flex max-h-[50vh] flex-col items-center gap-3 overflow-y-auto rounded-lg">
          {pages.map((page, i) => (
            <StandingsCard
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              page={page}
              pageNumber={i + 1}
              pageCount={pages.length}
              location={location}
              date={date}
              topPartnership={i === pages.length - 1 ? topPartnership : undefined}
              colors={colors}
              logo={logo?.data}
            />
          ))}
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
              {native ? <Share2 /> : <Download />} {files ? label : 'Preparing image…'}
            </Button>
            {native && (
              <Button type="button" variant="ghost" className="w-full" onClick={handleDownload} disabled={!files}>
                <Download /> {downloadLabel}
              </Button>
            )}
          </>
        )}
        {url && (
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label="Live board link" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={copyLink}>
              Copy link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useClubAuth } from '@/cloud/auth'
import { viewerUrl } from '@/cloud/url'
import { PhotoSharingToggle } from '@/components/PhotoSharingToggle'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { isLive } from '@/rotation/engine'
import { useSessionStore } from '@/store/session'

interface SharePanelProps {
  photoToggle?: boolean
  /** Share this session's own board rather than the club's (which shows its latest live session, or a choice). */
  sessionId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SharePanel({ photoToggle = false, sessionId, open, onOpenChange }: SharePanelProps) {
  const club = useClubAuth((s) => s.club)
  const [qr, setQr] = useState<string | null>(null)
  const url = club ? viewerUrl(club.slug, sessionId) : ''
  // Players opening the link before staff go live see "No game in progress".
  const notLive = useSessionStore((s) => s.session !== null && !isLive(s.session))

  useEffect(() => {
    if (!open || !url) return
    let cancelled = false
    QRCode.toDataURL(url, { margin: 1, width: 240 })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, url])

  if (!club) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied')
    } catch {
      toast.error('Could not copy. Select the link and copy it by hand.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share the live board</DialogTitle>
          <DialogDescription>
            Players scan the code or open the link to follow the courts, queue and standings on their
            own phones.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center">
          {qr ? (
            <img src={qr} alt="QR code for the live board" width={240} height={240} />
          ) : (
            <div className="size-60 animate-pulse rounded-lg bg-muted" aria-hidden />
          )}
        </div>
        <div className="flex gap-2">
          <Input readOnly value={url} aria-label="Live board link" onFocus={(e) => e.target.select()} />
          <Button onClick={copy}>Copy link</Button>
        </div>
        {notLive && (
          <p className="text-sm text-muted-foreground">
            This session is not live yet: players see “No game in progress” until you choose Go live in the session
            menu.
          </p>
        )}
        {photoToggle && <PhotoSharingToggle />}
      </DialogContent>
    </Dialog>
  )
}

import { ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { CardLogoPicker } from '@/components/CardLogoPicker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cardColors, useCardChoice } from '@/lib/cardPalette'

/**
 * The club's logos (its logo in each colour it has) from the setup screen, before any session: the same choices as in
 * the share pop-ups. Automatic is judged on the card colours last picked here, as the next share will be.
 */
export function ClubLogosDialog() {
  const [open, setOpen] = useState(false)
  const colors = cardColors(useCardChoice((s) => s.choice))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className="w-full">
          <ImageIcon aria-hidden="true" /> Club logos
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Club logos</DialogTitle>
          <DialogDescription>
            Your club’s logo in each colour you have. Standings and Stats images use the one that stands out on their
            colour, or the one you pick.
          </DialogDescription>
        </DialogHeader>
        <CardLogoPicker colors={colors} />
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

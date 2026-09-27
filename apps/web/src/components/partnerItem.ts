import { Lock, LockOpen } from 'lucide-react'

/** Lock or unlock this player's partner from the menu (doubles only). */
export interface PartnerOption {
  /** The partner's name while the player is locked (in force or waiting); the item then unlocks. */
  lockedWith?: string
  onLock: () => void
  onUnlock: () => void
}

/** The menu item for a partner option: Lock partner…, or Unlock from <name>. */
export const partnerItem = (partner: PartnerOption) =>
  partner.lockedWith === undefined
    ? { label: 'Lock partner…', icon: Lock, onClick: partner.onLock }
    : { label: `Unlock from ${partner.lockedWith}`, icon: LockOpen, onClick: partner.onUnlock }

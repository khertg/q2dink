import { Lock } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AvatarEditorDialog } from '@/components/AvatarEditorDialog'
import { AvatarViewDialog } from '@/components/AvatarViewDialog'
import { renamePlayer } from '@/lib/rename'
import { cn } from '@/lib/utils'
import { usePlayerAvatar, useRosterId, type ResolvedAvatar } from '@/lib/avatars'
import type { LockMark } from '@/lib/partners'

/** Each locked pair's colour (see --pair-N in index.css), as static class names so Tailwind generates them. */
const PAIR_RING = ['', 'outline-pair-1', 'outline-pair-2', 'outline-pair-3', 'outline-pair-4', 'outline-pair-5', 'outline-pair-6']
const PAIR_BADGE = ['', 'bg-pair-1', 'bg-pair-2', 'bg-pair-3', 'bg-pair-4', 'bg-pair-5', 'bg-pair-6']

const lockLabel = (lock: LockMark) => `${lock.waiting ? 'Will be locked' : 'Locked'} with ${lock.partner}`

/** The ring around a locked player's picture: the pair's colour, dashed while the lock still waits. */
const lockRing = (lock: LockMark) =>
  cn('outline-2 outline-offset-2', lock.waiting ? 'outline-dashed' : 'outline-solid', PAIR_RING[lock.colour])

/** The lock on the corner of a locked player's picture, saying who with. */
function LockBadge({ lock }: { lock: LockMark }) {
  const label = lockLabel(lock)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full ring-2 ring-card',
        PAIR_BADGE[lock.colour],
      )}
    >
      <Lock aria-hidden="true" className="size-3 text-white" />
    </span>
  )
}

/** Emoji fill more of the badge than letters do. */
const EMOJI_TEXT = { sm: 'text-xl', md: 'text-2xl', lg: 'text-4xl', xl: 'text-[8rem]' } as const

const SIZES = {
  sm: 'size-10 text-sm',
  md: 'size-12 text-base',
  lg: 'size-20 text-2xl',
  xl: 'size-64 text-8xl',
} as const

interface ViewProps {
  avatar: ResolvedAvatar
  name: string
  size?: keyof typeof SIZES
  className?: string
}

/** The round picture itself: a photo, an emoji on a colour, or initials on a colour. */
export function AvatarView({ avatar, name, size = 'md', className }: ViewProps) {
  return (
    <span
      role="img"
      aria-label={`${name}'s avatar`}
      data-avatar-kind={avatar.kind}
      // The letters or emoji are drawn from these attributes, so they are never text in the page:
      // lists and screen readers see only the name and the avatar's label.
      data-initials={avatar.kind === 'initials' ? avatar.text : undefined}
      data-emoji={avatar.kind === 'emoji' ? avatar.value : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold leading-none text-white select-none',
        avatar.kind === 'initials' && 'before:content-[attr(data-initials)]',
        avatar.kind === 'emoji' && 'before:content-[attr(data-emoji)]',
        SIZES[size],
        avatar.kind === 'emoji' && EMOJI_TEXT[size],
        className,
      )}
      style={avatar.kind === 'photo' ? undefined : { backgroundColor: avatar.color }}
    >
      {avatar.kind === 'photo' && (
        <img src={avatar.src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
      )}
    </span>
  )
}

interface Props {
  /** Whose avatar: matched by name to this device's saved player (and to the club's avatars). */
  name: string
  size?: keyof typeof SIZES
  /** Staff only: tap the avatar to see it large, and change it from there (for a player saved here). */
  editable?: boolean
  /** Anyone: tap the avatar to see it large (the players' live page, and Past sessions). */
  viewable?: boolean
  className?: string
  /** A locked partner: a ring in the pair's colour and a lock on the corner (see lockMarks). */
  lock?: LockMark
}

/**
 * A player's avatar. Tapping it (when `editable` or `viewable`) opens a large view of the picture;
 * staff can change it from there.
 */
export function PlayerAvatar({ name, size = 'md', editable = false, viewable = false, className, lock }: Props) {
  const avatar = usePlayerAvatar(name)
  const id = useRosterId(name)
  const [viewing, setViewing] = useState(false)
  const [editing, setEditing] = useState(false)
  const canEdit = editable && id !== undefined
  // The lock sits beside the picture, not inside the button, so it stays readable (a button hides what it holds).
  const marked = (node: ReactNode) =>
    lock ? (
      <span className={cn('relative inline-flex shrink-0', className)}>
        {node}
        <LockBadge lock={lock} />
      </span>
    ) : (
      node
    )
  const ring = lock ? lockRing(lock) : undefined

  if (!canEdit && !viewable) {
    return marked(<AvatarView avatar={avatar} name={name} size={size} className={cn(!lock && className, ring)} />)
  }

  return (
    <>
      {marked(
      <button
        type="button"
        title="Tap to see the picture large"
        aria-label={`View ${name}'s avatar`}
        className={cn(
          'inline-flex shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          !lock && className,
        )}
        onClick={(e) => {
          // Inside a checkbox row, tapping the avatar must not tick the box.
          e.preventDefault()
          e.stopPropagation()
          setViewing(true)
        }}
      >
        <AvatarView avatar={avatar} name={name} size={size} className={ring} />
      </button>,
      )}
      <AvatarViewDialog
        name={name}
        avatar={avatar}
        open={viewing}
        onOpenChange={setViewing}
        onRename={canEdit ? (next) => rename(name, next) : undefined}
        onChange={
          canEdit
            ? () => {
                setViewing(false)
                setEditing(true)
              }
            : undefined
        }
      />
      {canEdit && id !== undefined && <AvatarEditorDialog playerId={id} name={name} open={editing} onOpenChange={setEditing} />}
    </>
  )
}

/** Rename from the large view: says why in plain words when the name is refused, and tells staff when it worked. */
async function rename(current: string, name: string): Promise<string | null> {
  try {
    const { from, to } = await renamePlayer(current, name)
    if (from !== to) toast(`${from} is now ${to}`)
    return null
  } catch (error) {
    return error instanceof RangeError ? error.message : 'That name could not be saved. Try again.'
  }
}

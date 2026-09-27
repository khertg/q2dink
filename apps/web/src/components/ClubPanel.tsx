import {
  MAX_CLUB_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isValidSlug,
  liveBoardPath,
  slugify,
} from '@q2dink/shared'
import { PencilIcon, QrCodeIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { toCloudError } from '@/cloud/api'
import { useClubAuth } from '@/cloud/auth'
import { cloud } from '@/cloud/client'
import { useRecoveryCode } from '@/cloud/recovery'
import { recordAudit } from '@/cloud/audit'
import { flushAudit } from '@/cloud/sync'
import { PhotoSharingToggle } from '@/components/PhotoSharingToggle'
import { RenameDialog } from '@/components/RenameDialog'
import { ResetDeviceDialog } from '@/components/ResetDeviceDialog'
import { SharePanel } from '@/components/SharePanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Create a club and sign in to it. The recovery code is shown once, outside this dialog. */
export function CreateClubDialog() {
  const signIn = useClubAuth((s) => s.signIn)
  const showRecoveryCode = useRecoveryCode((s) => s.show)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const slug = slugify(name)
  const valid = name.trim() !== '' && password.length >= MIN_PASSWORD_LENGTH

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!cloud || !valid) return
    setBusy(true)
    setError(null)
    try {
      const { token, recoveryCode } = await cloud.createClub(name.trim(), slug, password)
      signIn({ slug, name: name.trim(), token })
      showRecoveryCode(recoveryCode)
      setOpen(false)
      setName('')
      setPassword('')
    } catch (err) {
      setError(toCloudError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="h-11">
          Create a club
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a club</DialogTitle>
          <DialogDescription>
            Your club gets its own link. Staff sign in on any device with the club link name and
            password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="club-name">Club name</Label>
            <Input
              id="club-name"
              value={name}
              maxLength={MAX_CLUB_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
            {name.trim() !== '' && (
              <p className="text-sm text-muted-foreground">
                Link: <span className="font-mono">{liveBoardPath(slug)}</span>
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="club-password">Password (min. {MIN_PASSWORD_LENGTH} characters)</Label>
            <Input
              id="club-password"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-11 w-full" disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Create club'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Log in to a club, or reset its password with the recovery code. */
export function LoginDialog() {
  const signIn = useClubAuth((s) => s.signIn)
  const showRecoveryCode = useRecoveryCode((s) => s.show)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [slug, setSlug] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const cleanSlug = slug.trim().toLowerCase()
  const resetting = mode === 'reset'
  const valid = isValidSlug(cleanSlug) && (resetting ? recoveryCode.trim() !== '' && password.length >= MIN_PASSWORD_LENGTH : password !== '')

  function changeMode(next: 'login' | 'reset') {
    setMode(next)
    setPassword('')
    setError(null)
  }

  function close() {
    setOpen(false)
    setMode('login')
    setSlug('')
    setPassword('')
    setRecoveryCode('')
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!cloud || !valid) return
    setBusy(true)
    setError(null)
    try {
      if (resetting) {
        const grant = await cloud.resetPassword(cleanSlug, recoveryCode.trim(), password)
        signIn({ slug: cleanSlug, name: grant.name, token: grant.token })
        // The old recovery code is now used up; show the replacement.
        showRecoveryCode(grant.recoveryCode)
      } else {
        const { token, name } = await cloud.login(cleanSlug, password)
        signIn({ slug: cleanSlug, name, token })
      }
      close()
    } catch (err) {
      setError(toCloudError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11">
          Log in
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resetting ? 'Reset your password' : 'Log in to your club'}</DialogTitle>
          <DialogDescription>
            {resetting
              ? 'Enter the recovery code you saved when the club was created, and choose a new password.'
              : 'Use the club link name, for example downtown-pickle-club.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-slug">Club link name</Label>
            <Input
              id="login-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
            />
          </div>
          {resetting && (
            <div className="space-y-2">
              <Label htmlFor="reset-code">Recovery code</Label>
              <Input
                id="reset-code"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                className="font-mono"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="login-password">
              {resetting ? `New password (min. ${MIN_PASSWORD_LENGTH} characters)` : 'Password'}
            </Label>
            <Input
              id="login-password"
              type="password"
              autoComplete={resetting ? 'new-password' : 'current-password'}
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-11 w-full" disabled={!valid || busy}>
            {busy ? (resetting ? 'Resetting…' : 'Logging in…') : resetting ? 'Reset password' : 'Log in'}
          </Button>
          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={() => changeMode(resetting ? 'login' : 'reset')}
          >
            {resetting ? 'Back to log in' : 'Forgot password?'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SignedIn() {
  const club = useClubAuth((s) => s.club)
  const signOut = useClubAuth((s) => s.signOut)
  const [shareOpen, setShareOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

  if (!club) return null

  /** The name lives on the club, so renaming needs the server; other staff devices follow within seconds. */
  async function renameClub(name: string): Promise<string | null> {
    const current = useClubAuth.getState().club
    if (!cloud || !current) return 'Not signed in to a club.'
    try {
      const saved = await cloud.renameClub(current.token, name)
      useClubAuth.getState().setClubName(saved.name)
      recordAudit('clubRenamed', `Renamed the club to “${saved.name}”`)
      toast(`Club renamed to “${saved.name}”`)
      return null
    } catch (error) {
      return toCloudError(error).message
    }
  }

  async function handleLogOut() {
    const token = club?.token
    // Logged, and sent while this device can still reach the club.
    recordAudit('signedOut', 'Logged out on this device')
    await flushAudit().catch(() => false)
    signOut()
    // Best effort: the token also expires by itself after 30 days.
    if (cloud && token) await cloud.logout(token).catch(() => undefined)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <p className="min-w-0 break-words font-medium">{club.name}</p>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Rename club" onClick={() => setRenaming(true)}>
          <PencilIcon aria-hidden="true" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Live link: <span className="font-mono">{liveBoardPath(club.slug)}</span>
      </p>
      <PhotoSharingToggle />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setShareOpen(true)}>
          <QrCodeIcon aria-hidden="true" /> Share live view
        </Button>
        <Button variant="outline" onClick={handleLogOut}>
          Log out
        </Button>
        <ResetDeviceDialog />
      </div>
      <SharePanel open={shareOpen} onOpenChange={setShareOpen} />
      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename club"
        description="Shown on every staff device, the live page and shared images. The live link stays the same."
        label="Club name"
        current={club.name}
        maxLength={MAX_CLUB_NAME_LENGTH}
        onSave={renameClub}
      />
    </div>
  )
}

/** The signed-in club on the setup screen. Hidden when no API is configured; logging in happens on the login screen. */
export function ClubPanel() {
  const club = useClubAuth((s) => s.club)
  if (!cloud || !club) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloud club</CardTitle>
        <CardDescription>
          Players follow the queue live on their phones, and all-time stats are kept across devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignedIn />
      </CardContent>
    </Card>
  )
}

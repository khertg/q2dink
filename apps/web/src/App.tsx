import { useEffect, useSyncExternalStore } from 'react'
import { clubSlugFromPath, liveSessionIdFromPath } from '@q2dink/shared'
import { useClubAuth } from '@/cloud/auth'
import { cloud } from '@/cloud/client'
import { requiresDeviceName, requiresLogin } from '@/cloud/gate'
import { startCloudSync } from '@/cloud/sync'
import { AvatarProvider } from '@/components/AvatarProvider'
import { DeviceNameGate } from '@/components/DeviceNameForm'
import { InstallBanner } from '@/components/InstallBanner'
import { LoginGate } from '@/components/LoginGate'
import { NavBar } from '@/components/NavBar'
import { RecoveryCodeHost } from '@/components/RecoveryCodeHost'
import { Toaster } from '@/components/ui/sonner'
import { SessionScreen } from '@/screens/SessionScreen'
import { SetupScreen } from '@/screens/SetupScreen'
import { useDevice } from '@/lib/device'
import { ViewerScreen } from '@/screens/ViewerScreen'
import { useSessionStore } from '@/store/session'

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export default function App() {
  const session = useSessionStore((s) => s.session)
  const signedIn = useClubAuth((s) => s.club !== null)
  const clubSlug = useClubAuth((s) => s.club?.slug ?? null)
  const namedFor = useDevice((s) => s.namedFor)
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const path = window.location.pathname
  // Anything under /club is the public viewer, which never runs staff features.
  const isViewerPath = path === '/club' || path.startsWith('/club/')
  const viewerSlug = clubSlugFromPath(path)
  const viewerSessionId = liveSessionIdFromPath(path) ?? undefined
  // With a cloud set up, staff log in to a club first; the saved login keeps the app working offline.
  const mustLogIn = requiresLogin({ cloudConfigured: cloud !== null, signedIn, isViewerPath })
  // Then the device gets a name, so the club's activity log can tell its devices apart.
  const mustNameDevice = requiresDeviceName({ cloudConfigured: cloud !== null, signedIn, isViewerPath, clubSlug, namedFor, online })

  useEffect(() => {
    if (isViewerPath) return
    return startCloudSync()
  }, [isViewerPath])

  return (
    // Extra bottom padding lets the last controls scroll clear of the toasts pinned to the screen bottom.
    // Screens with their own fixed bottom tab bar (SessionScreen, ViewerScreen) add further clearance themselves.
    <AvatarProvider viewerSlug={isViewerPath ? (viewerSlug ?? undefined) : undefined}>
    <NavBar />
    <main className="mx-auto max-w-5xl p-4 pb-24 sm:p-6 sm:pb-24">
      {/* Staff only: the manifest starts at "/", so installing from the viewer would open the staff app. */}
      {!isViewerPath && <InstallBanner />}
      {isViewerPath ? (
        viewerSlug ? (
          <ViewerScreen slug={viewerSlug} sessionId={viewerSessionId} />
        ) : (
          <p className="py-10 text-center text-muted-foreground">
            That club link isn&apos;t valid. Check the link or scan the QR code again.
          </p>
        )
      ) : mustLogIn ? (
        <LoginGate />
      ) : mustNameDevice ? (
        <DeviceNameGate />
      ) : session ? (
        <SessionScreen session={session} />
      ) : (
        <SetupScreen />
      )}
      <RecoveryCodeHost />
      <Toaster />
    </main>
    </AvatarProvider>
  )
}

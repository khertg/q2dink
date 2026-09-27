import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AuditDevice } from '@q2dink/shared'
import { newBatchId } from '@/cloud/id'
import type { DeviceRef } from '@/rotation/types'

/** What Chromium's User-Agent Client Hints say about the device (getHighEntropyValues). */
export interface DeviceHints {
  model?: string
  platform?: string
  platformVersion?: string
  brands?: { brand: string; version: string }[]
}

const BROWSERS: [RegExp, string][] = [
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/EdgA?\/|Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/FxiOS|Firefox\//, 'Firefox'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const browserOf = (ua: string) => BROWSERS.find(([pattern]) => pattern.test(ua))?.[1]

/** The OS, and on Android the model if the UA string still carries one ("K" is Chrome's placeholder). */
function fromUserAgent(ua: string): { model?: string; os?: string } {
  const ios = /\b(iPhone|iPad|iPod)\b.*?OS (\d+)[_.]?(\d+)?/.exec(ua)
  if (ios) return { model: ios[1], os: `iOS ${ios[2]}` }
  // iPadOS asks for desktop sites and says it is a Mac; a touch screen gives it away, which a pure function cannot see.
  const android = /Android (\d+(?:\.\d+)?)(?:; ([^;)]+))?/.exec(ua)
  if (android) {
    const model = android[2]?.trim()
    return { model: model && model !== 'K' ? model.replace(/ Build\/.*$/, '') : undefined, os: `Android ${android[1]}` }
  }
  if (/Windows/.test(ua)) return { os: 'Windows' }
  if (/CrOS/.test(ua)) return { os: 'ChromeOS' }
  if (/Mac OS X/.test(ua)) return { os: 'Mac' }
  if (/Linux/.test(ua)) return { os: 'Linux' }
  return {}
}

/** Android and iOS report the major version; desktops' versions mean little to staff. */
function osFromHints(hints: DeviceHints): string | undefined {
  const { platform, platformVersion } = hints
  if (!platform) return undefined
  const major = platformVersion?.split('.')[0]
  if (platform === 'Android' && major) return `Android ${major}`
  if (platform === 'macOS') return 'Mac'
  if (platform === 'Chrome OS') return 'ChromeOS'
  return platform
}

/**
 * What a device says about itself, for the audit log: "SM-S918B · Android 14 · Chrome", "iPhone · iOS 18 ·
 * Safari", "Windows · Edge". Chrome on Android gives the model code through client hints; Safari says only
 * "iPhone" or "iPad", which is why every device also has its own id and a name.
 */
export function deviceLabel(ua: string, rawHints: DeviceHints = {}): string {
  const fromUa = fromUserAgent(ua)
  // Apple's browsers send no client hints; any that come with an iOS user agent are not about this device.
  const hints = fromUa.os?.startsWith('iOS') ? {} : rawHints
  const model = hints.model?.trim() || fromUa.model
  const os = osFromHints(hints) ?? fromUa.os
  const parts = [model, os, browserOf(ua)].filter((p): p is string => !!p)
  return (parts.length > 0 ? parts.join(' · ') : 'Unknown device').slice(0, 80)
}

/** The short form of a device id shown next to its name: "#3f2a". */
export const shortDeviceId = (id: string) => `#${id.replace(/-/g, '').slice(0, 4)}`

/** How a device is shown in the log: its name, else its details, and always its short id. */
export function deviceDisplay(device: AuditDevice): { title: string; detail: string } {
  return device.name
    ? { title: device.name, detail: `${device.label} ${shortDeviceId(device.id)}` }
    : { title: device.label, detail: shortDeviceId(device.id) }
}

interface DeviceStore {
  /** Made once on this device; clearing the browser's data makes it a new device. */
  id: string
  /** The name staff gave this device, and the club it was registered with. */
  name: string | null
  namedFor: string | null
  /** The details, worked out once (client hints are asynchronous). */
  label: string | null
  setName: (name: string, clubSlug: string) => void
  setLabel: (label: string) => void
}

const DEVICE_KEY = 'q2dink-device'

export const useDevice = create<DeviceStore>()(
  persist(
    (set) => ({
      id: newBatchId(),
      name: null,
      namedFor: null,
      label: null,
      setName: (name, clubSlug) => set({ name, namedFor: clubSlug }),
      setLabel: (label) => set({ label }),
    }),
    {
      name: DEVICE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ id, name, namedFor, label }) => ({ id, name, namedFor, label }),
    },
  ),
)

/**
 * Save the id made on first launch straight away. The store is only written when it changes, so a device nobody
 * has named yet (always, in a build with no cloud) would otherwise be a new device after every reload, and take
 * its own pause for another device's.
 */
export function keepDeviceId(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): void {
  try {
    if (storage && storage.getItem(DEVICE_KEY) === null) useDevice.setState((s) => ({ id: s.id }))
  } catch {
    // Storage the browser will not let us read: nothing can be kept anyway.
  }
}
keepDeviceId()

/** Work out this device's details once, using client hints where the browser has them. */
export async function resolveDeviceLabel(): Promise<string> {
  const cached = useDevice.getState().label
  if (cached) return cached
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  let hints: DeviceHints = {}
  const uaData = (nav as { userAgentData?: { getHighEntropyValues?: (keys: string[]) => Promise<DeviceHints> } } | undefined)
    ?.userAgentData
  try {
    if (uaData?.getHighEntropyValues) hints = await uaData.getHighEntropyValues(['model', 'platform', 'platformVersion'])
  } catch {
    // Some browsers refuse; the UA string is enough.
  }
  const label = deviceLabel(nav?.userAgent ?? '', hints)
  useDevice.getState().setLabel(label)
  return label
}

/** This device as it appears in the log. */
export function currentDevice(): AuditDevice {
  const { id, name, label } = useDevice.getState()
  return { id, label: label ?? deviceLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent), ...(name ? { name } : {}) }
}

/** This device as a session records who started or paused it: its id, and its name (else its details). */
export function deviceRef(): DeviceRef {
  const device = currentDevice()
  return { deviceId: device.id, name: device.name ?? device.label }
}

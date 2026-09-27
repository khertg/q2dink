import { describe, expect, it, vi } from 'vitest'

// The device store persists to localStorage; give the node test environment a tiny in-memory one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  })
})

import { useDevice } from './device'

describe('the device id', () => {
  it('is saved on first launch, before anything else about the device is, so a reload keeps it', () => {
    const saved = JSON.parse(localStorage.getItem('q2dink-device')!) as { state: { id: string } }
    expect(saved.state.id).toBe(useDevice.getState().id)
  })
})

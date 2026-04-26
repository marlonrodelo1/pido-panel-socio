// Wrapper de Geolocation (Capacitor en nativo, navigator.geolocation en web).
// Mantenemos un loop con 2 cadencias:
//   - 15s cuando hay pedido activo
//   - 60s en idle online
// La app llama setActive(bool) segun haya o no pedidos en curso.

import { Capacitor } from '@capacitor/core'

let CapacitorGeolocation = null
async function getCapPlugin() {
  if (CapacitorGeolocation) return CapacitorGeolocation
  if (Capacitor.getPlatform() === 'web') return null
  const mod = await import('@capacitor/geolocation')
  CapacitorGeolocation = mod.Geolocation
  return CapacitorGeolocation
}

export async function getCurrentPosition() {
  const cap = await getCapPlugin()
  if (cap) {
    try {
      const perm = await cap.checkPermissions()
      if (perm.location !== 'granted') {
        const req = await cap.requestPermissions()
        if (req.location !== 'granted') throw new Error('permission_denied')
      }
    } catch (_) {}
    const pos = await cap.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no_geolocation'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  })
}

export function makeRiderTracker({ onTick, onError }) {
  let timer = null
  let activeMode = false
  let stopped = false

  const cadence = () => (activeMode ? 15000 : 60000)

  async function tick() {
    if (stopped) return
    try {
      const pos = await getCurrentPosition()
      onTick?.(pos)
    } catch (e) {
      onError?.(e)
    }
    if (!stopped) timer = setTimeout(tick, cadence())
  }

  return {
    start() {
      if (timer || stopped) return
      tick()
    },
    stop() {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
    },
    setActive(b) {
      activeMode = !!b
    },
  }
}

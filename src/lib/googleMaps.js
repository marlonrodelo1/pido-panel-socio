// Carga Google Maps JS API una sola vez. Devuelve google.maps cuando esta listo.
// Patron robusto: si el script ya existe (otra pestaña / hot reload), espera a que
// window.google.maps este listo en vez de inyectar otra vez.

let loadingPromise = null

export function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no_window'))
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps)
  if (loadingPromise) return loadingPromise

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error('no_api_key'))

  loadingPromise = new Promise((resolve, reject) => {
    const onReady = () => {
      if (window.google?.maps?.Map) resolve(window.google.maps)
      else reject(new Error('gmaps_not_ready'))
    }

    // Si ya hay un script cargandose, solo esperar
    const existing = document.querySelector('script[data-pidoo-gmaps]')
    if (existing) {
      existing.addEventListener('load', onReady, { once: true })
      existing.addEventListener('error', () => reject(new Error('gmaps_load_fail')), { once: true })
      // Por si ya termino antes de que llegaramos:
      const poll = setInterval(() => {
        if (window.google?.maps?.Map) { clearInterval(poll); resolve(window.google.maps) }
      }, 200)
      setTimeout(() => clearInterval(poll), 15000)
      return
    }

    // Inyecta el script (sin callback, con onload directo)
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
    s.async = true
    s.defer = true
    s.dataset.pidooGmaps = '1'
    s.onload = onReady
    s.onerror = () => reject(new Error('gmaps_load_fail'))
    document.head.appendChild(s)
  })
  // Si el promise rechaza, permitir reintento posterior
  loadingPromise.catch(() => { loadingPromise = null })
  return loadingPromise
}

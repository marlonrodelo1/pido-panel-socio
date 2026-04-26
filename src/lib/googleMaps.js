// Carga Google Maps JS API una sola vez. Devuelve el objeto google.maps.

let loadingPromise = null

export function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no_window'))
  if (window.google?.maps) return Promise.resolve(window.google.maps)
  if (loadingPromise) return loadingPromise
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error('no_api_key'))
  loadingPromise = new Promise((resolve, reject) => {
    const cb = '__pidoo_gmaps_cb_' + Math.floor(Math.random() * 1e9)
    window[cb] = () => { resolve(window.google.maps); try { delete window[cb] } catch (_) {} }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=${cb}&loading=async&libraries=places`
    s.async = true
    s.defer = true
    s.onerror = () => reject(new Error('gmaps_load_fail'))
    document.head.appendChild(s)
  })
  return loadingPromise
}

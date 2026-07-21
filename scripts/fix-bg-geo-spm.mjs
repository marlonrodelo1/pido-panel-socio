// fix-bg-geo-spm.mjs — postinstall.
// Varios plugins de la comunidad fijan capacitor-swift-pm a 7.x en su Package.swift
// (`from: "7.0.0"`), lo que CHOCA con el resto del proyecto, que usa Capacitor 8
// (capacitor-swift-pm 8.x, exigido por @capgo/capacitor-updater) -> el
// `xcodebuild archive` falla resolviendo dependencias SPM con un error tipo:
//   'apple-sign-in' depends on 'capacitor-swift-pm' 7.0.0..<8.0.0 and
//   'capacitor-updater' depends on 'capacitor-swift-pm' 8.0.0..<9.0.0
// Aquí relajamos ese límite a [7.0.0 ..< 9.0.0] en cada plugin afectado para que
// SPM pueda resolver a 8.x. Solo afecta a iOS; Android no usa SPM. Quitar cada
// entrada cuando el plugin publique una versión compatible con Capacitor 8.
import { readFileSync, writeFileSync } from 'node:fs'

const PKGS = [
  'node_modules/@capacitor-community/background-geolocation/Package.swift',
  'node_modules/@capacitor-community/apple-sign-in/Package.swift',
]

for (const PKG of PKGS) {
  try {
    let s = readFileSync(PKG, 'utf8')
    if (s.includes('from: "7.0.0"')) {
      s = s.replace('from: "7.0.0"', '"7.0.0" ..< "9.0.0"')
      writeFileSync(PKG, s)
      console.log(`[fix-spm] ${PKG} ajustado a capacitor-swift-pm 7..<9 (Capacitor 8 OK)`)
    }
  } catch (_) {
    // El plugin aún no está instalado o ya estaba parcheado: no hacer nada.
  }
}

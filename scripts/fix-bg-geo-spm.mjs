// fix-bg-geo-spm.mjs — postinstall.
// El plugin @capacitor-community/background-geolocation@1.2.26, en su Package.swift
// (Swift Package Manager), fija capacitor-swift-pm a 7.x (`from: "7.0.0"`), lo que
// CHOCA con el resto de plugins de este proyecto, que usan Capacitor 8
// (capacitor-swift-pm 8.x) -> el `xcodebuild archive` falla resolviendo dependencias.
// Aquí relajamos ese límite a [7.0.0 ..< 9.0.0] para que SPM resuelva a 8.x.
// Solo afecta a iOS; Android no usa SPM. Quitar cuando el plugin publique una
// versión compatible con Capacitor 8.
import { readFileSync, writeFileSync } from 'node:fs'

const PKG = 'node_modules/@capacitor-community/background-geolocation/Package.swift'

try {
  let s = readFileSync(PKG, 'utf8')
  if (s.includes('from: "7.0.0"')) {
    s = s.replace('from: "7.0.0"', '"7.0.0" ..< "9.0.0"')
    writeFileSync(PKG, s)
    console.log('[fix-bg-geo-spm] Package.swift del plugin ajustado a capacitor-swift-pm 7..<9 (Capacitor 8 OK)')
  }
} catch (_) {
  // El plugin aún no está instalado o ya estaba parcheado: no hacer nada.
}

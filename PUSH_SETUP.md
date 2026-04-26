# Push notifications — setup nativo (Android + iOS)

El panel-socio reusa el proyecto Firebase **`pidoo-push`** que ya tienes
(es donde están registradas `com.pidoo.app`, `com.pido.restaurante`, etc.).
Solo hay que añadir la app `com.pidoo.socios` y bajar los archivos de
configuración.

Console: https://console.firebase.google.com/project/pidoo-push/overview

---

## Android (FCM)

### 1. Registrar la app en Firebase

1. Console → ⚙ Configuración del proyecto → "Tus apps" → **Añadir app** → Android.
2. **Nombre del paquete:** `com.pidoo.socios`
3. **Apodo:** Pidoo Socios
4. **SHA-1:** opcional para FCM puro; obligatorio si usas Google Sign-In.
   Para obtenerlo (con la app ya creada):
   ```powershell
   cd pido-panel-socio\android
   ./gradlew signingReport
   ```
5. Descargar **`google-services.json`**.

### 2. Crear la app Android local

```powershell
cd "C:\Users\Marlon Rodelo Ayala\Desktop\Pidoo\pido-panel-socio"
npm run build
npx cap add android
```

### 3. Colocar el archivo

Copia `google-services.json` a `pido-panel-socio/android/app/google-services.json`.

### 4. Activar el plugin Google Services en Gradle

Capacitor 8 normalmente lo hace al hacer `cap add android`. Si NO lo hizo,
edita manualmente:

**`android/build.gradle`** (proyecto raíz Android):
```gradle
buildscript {
    dependencies {
        classpath 'com.google.gms:google-services:4.4.2'
    }
}
```

**`android/app/build.gradle`** (al final del archivo):
```gradle
apply plugin: 'com.google.gms.google-services'
```

### 5. Sync y prueba

```powershell
npx cap sync android
npx cap open android
```

Genera APK debug y verifica que al iniciar sesión como socio, aparece una
fila nueva en `push_subscriptions` con `user_type='socio'` y `fcm_token` con
valor real.

---

## iOS (APNs vía Firebase)

### 1. Registrar la app en Firebase

1. Console → ⚙ Configuración → "Tus apps" → **Añadir app** → iOS.
2. **Bundle ID:** `com.pidoo.socios`
3. **Apodo:** Pidoo Socios iOS
4. Descargar **`GoogleService-Info.plist`**.

### 2. Subir la clave APNs (si todavía no lo hiciste para otra app)

Esto se hace UNA VEZ por proyecto Firebase, así que probablemente ya está
hecho para `com.pidoo.app`. Si no:

1. Apple Developer Portal → Keys → Crear nueva → APNs.
2. Descarga el `.p8`.
3. En Firebase Console → Project settings → Cloud Messaging → APNs Authentication Key → Subir el `.p8`.

### 3. Crear la app iOS local (en Mac)

```bash
cd pido-panel-socio
npx cap add ios
```

### 4. Colocar el archivo

`GoogleService-Info.plist` → `pido-panel-socio/ios/App/App/`.

### 5. Capabilities en Xcode

Abrir Xcode (`npx cap open ios`) → target App → Signing & Capabilities:

- **Push Notifications**
- **Background Modes** → `Remote notifications`, `Background fetch`

### 6. AppDelegate

Copiar `pido-app/ios/App/App/AppDelegate.swift` a
`pido-panel-socio/ios/App/App/AppDelegate.swift` y cambiar:

- `SUPABASE_URL` (en realidad ya es la misma).
- El `user_type` que se pasa al claim si está hardcodeado: cambiar a `'socio'`.

---

## Verificación end-to-end

Una vez todo arriba:

1. Login como socio en la APK.
2. Abrir Supabase → Table editor → `push_subscriptions` → buscar tu user_id.
3. Debe haber una fila con `fcm_token` real (no `DEBUG`).
4. Activar modo reparto + Conectarme.
5. Que el restaurante (Come y Calla) acepte un pedido delivery.
6. El push debe llegar a la APK aunque esté cerrada.

Si no llega:

- Revisar `push_debug_logs` en Supabase, filtrando `event LIKE 'socio:%'`.
- Verificar que `pidoo-push` tiene la APNs key subida (Firebase Console).
- Verificar que el Capacitor logs muestran `plugin_registration` con un
  token válido al abrir la app.

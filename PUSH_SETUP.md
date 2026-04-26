# Push notifications — setup nativo (Android + iOS)

Bundle id: **`com.pido.socio`** (ya está registrado en Firebase `pidoo-push`).

Console: https://console.firebase.google.com/project/pidoo-push/overview

---

## Android (FCM)

### 1. Bajar el `google-services.json` ya existente

1. Console → ⚙ Configuración del proyecto → "Tus apps" → busca **`com.pido.socio`**.
2. Descarga el `google-services.json` desde ese tile (el archivo lleva los
   datos de las 4 apps registradas, pero al colocarlo dentro del proyecto
   Android del panel-socio el plugin selecciona la entrada que coincide con
   el `applicationId`).

### 2. Crear la app Android local

```powershell
cd "C:\Users\Marlon Rodelo Ayala\Desktop\Pidoo\pido-panel-socio"
npm run build
npx cap add android
```

Tras `cap add android`, verifica que `android/app/build.gradle` tenga
`applicationId "com.pido.socio"` (debería heredarlo de `capacitor.config.ts`).

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

### 1. Verificar app iOS en Firebase

1. Console → ⚙ Configuración → "Tus apps".
2. Si NO existe la entrada **iOS** para `com.pido.socio`, créala
   ("Añadir app" → iOS → bundle `com.pido.socio` → apodo "Pidoo Socio iOS").
3. Descarga **`GoogleService-Info.plist`**.

### 2. APNs key

Esto se hace UNA VEZ por proyecto Firebase. Como ya tienes `com.pidoo.app`
funcionando con push iOS, la APNs key de `pidoo-push` ya está subida; no
necesitas tocar nada.

Si el día de mañana hay que rotar:
1. Apple Developer Portal → Keys → Crear nueva → APNs.
2. Descarga el `.p8`.
3. Firebase Console → Project settings → Cloud Messaging → APNs Authentication Key → Subir.

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
`pido-panel-socio/ios/App/App/AppDelegate.swift` y cambiar el `user_type`
hardcodeado a `'socio'` si aparece (p. ej. en el `saveFcmTokenToSupabase`).

---

## Verificación end-to-end

1. Login como socio en la APK.
2. Abrir Supabase → Table editor → `push_subscriptions` → buscar tu user_id.
3. Debe haber una fila con `fcm_token` real (no `DEBUG`).
4. Activar modo reparto + Conectarme.
5. Que el restaurante (Come y Calla) acepte un pedido delivery.
6. El push debe llegar a la APK aunque esté cerrada, y reping cada 30s
   hasta que aceptes o expire (3 min).

Si no llega:

- Revisar `push_debug_logs` en Supabase: `select * from push_debug_logs where event like 'socio:%' order by id desc limit 50;`
- Verificar que `pidoo-push` tiene la APNs key subida (Firebase Console).
- Verificar que el Capacitor logs muestran `plugin_registration` con un
  token válido al abrir la app.

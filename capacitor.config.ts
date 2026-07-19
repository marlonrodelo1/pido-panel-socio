import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.pidoo.socio',
  appName: 'Pidoo Socio',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // Teclado (19-jul-2026). En iOS, WKWebView PANEA su UIScrollView nativo para enfocar
    // el input: la página entera se arrastraba dejando el formulario cortado arriba y un
    // hueco enorme abajo. Eso NO se puede evitar desde el DOM — se intentaron 100dvh,
    // visualViewport y position:fixed y ninguno sirve, porque el paneo ocurre en UIKit,
    // por debajo del CSS. resize:'native' hace que el WEBVIEW se encoja al abrir el
    // teclado, así que no hay nada que panear. Android ya hacía adjustResize.
    Keyboard: {
      resize: 'native',
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#16130F',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      androidSpinnerStyle: 'small',
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      // 'LIGHT' = iconos OSCUROS (para el fondo claro del socio). Con 'DARK' salían blancos/invisibles.
      style: 'LIGHT',
      backgroundColor: '#FAFAF7',
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Geolocation: {
      permissions: ['location'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#C5562C',
      sound: 'default',
    },
    // OTA (Capgo): actualiza la capa web sin pasar por la tienda. autoUpdate descarga la
    // version nueva en segundo plano y la aplica al reabrir la app. resetWhenUpdate limpia
    // estado viejo al aplicar. El vinculo con la cuenta Capgo lo hace `npx @capgo/cli init`.
    CapacitorUpdater: {
      autoUpdate: true,
      resetWhenUpdate: true,
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Requerido por @capacitor-community/background-geolocation: sin el bridge
    // legacy, los updates de ubicación se detienen tras 5 min en background.
    // Ref: https://github.com/capacitor-community/background-geolocation/issues/89
    useLegacyBridge: true,
  },
}

export default config

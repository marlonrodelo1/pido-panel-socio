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
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#FAFAF7',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      androidSpinnerStyle: 'small',
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
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

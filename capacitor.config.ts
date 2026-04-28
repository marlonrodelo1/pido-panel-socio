import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.pido.socio',
  appName: 'Pidoo Socio',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#FAFAF7',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#FAFAF7',
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#FF6B2C',
      sound: 'beep.wav',
    },
    Geolocation: {
      // Capacitor delega permisos a Info.plist (iOS) y AndroidManifest (Android)
    },
  },
  server: {
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
  },
}

export default config

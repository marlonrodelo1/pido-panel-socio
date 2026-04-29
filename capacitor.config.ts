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
      // Texto oscuro (iconos del sistema en negro) sobre fondo claro #FAFAF7.
      // overlaysWebView=false: el WebView no se mete debajo del status bar,
      // por lo que la barra del sistema NUNCA queda invisible al scrollear.
      style: 'DARK',
      backgroundColor: '#FAFAF7',
      overlaysWebView: false,
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
    // overlaysWebView=false ya evita que el WebView se meta bajo el status bar;
    // 'never' evita un doble safe-area-inset al scrollear.
    contentInset: 'never',
  },
}

export default config

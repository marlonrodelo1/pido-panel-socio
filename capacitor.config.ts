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
    // @capacitor-community/background-geolocation
    // Mantiene un foreground service en Android con notificacion persistente
    // mientras el rider esta online. La notificacion aparece al llamar
    // BackgroundGeolocation.addWatcher({ backgroundTitle, backgroundMessage })
    // y desaparece al hacer removeWatcher.
    BackgroundGeolocation: {
      // El plugin lee estos textos por defecto si addWatcher no los pasa
      // explicitamente. Los pasamos tambien en el call para mas control.
      notificationTitle: 'Pidoo - Recibiendo pedidos',
      notificationText: 'Tienes la ubicacion activada para recibir pedidos cerca.',
      // Icono: usa el launcher de la app (mipmap/ic_launcher).
      // En Android 13+ deberia ser un drawable monocromo, pero mientras tanto
      // ic_launcher funciona y no rompe.
      notificationIcon: 'ic_launcher',
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

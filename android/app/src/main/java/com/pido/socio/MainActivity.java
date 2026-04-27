package com.pido.socio;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Crear canal de notificaciones "pedidos" para que cuando llegue un push
        // FCM con `android.notification.channel_id = "pedidos"` el OS lo reproduzca
        // con sonido + vibracion + heads-up — incluso con la app cerrada o en
        // background. Sin este canal creado a nivel nativo, FCM cae al canal
        // "Miscellaneous" que NO suena.
        //
        // IMPORTANTE: las propiedades del canal son inmutables tras crearlo. Si
        // existia un canal "pedidos" creado por el plugin Capacitor sin sonido,
        // lo borramos y lo recreamos con sonido.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.pedido_rider);

                // Recreate canal si existia con otro sonido (asi forzamos migracion en
                // dispositivos que ya tenian la app instalada con sonido por defecto).
                NotificationChannel existing = manager.getNotificationChannel("pedidos");
                if (existing != null) {
                    Uri current = existing.getSound();
                    if (current == null || !soundUri.equals(current)) {
                        manager.deleteNotificationChannel("pedidos");
                    }
                }
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .build();

                NotificationChannel channel = new NotificationChannel(
                    "pedidos", "Pedidos nuevos", NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Avisos de pedidos para repartir");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500, 200, 500});
                channel.setSound(soundUri, audioAttributes);
                channel.enableLights(true);
                channel.setLightColor(0xFFFF6B2C);
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                channel.setBypassDnd(false);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    channel.setAllowBubbles(true);
                }
                manager.createNotificationChannel(channel);
            }
        }

        // Mantener pantalla encendida cuando la app esta abierta
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Permitir audio sin gesto del usuario (alarma de pedidos en foreground)
        WebView webView = getBridge().getWebView();
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}

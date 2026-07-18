package com.pidoo.socio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Canal NUEVO (18-jul-2026). Los NotificationChannel son INMUTABLES: cambiar el
    // sonido o la importancia de un canal ya creado es un no-op. Por eso el arreglo
    // exige un id distinto de los anteriores ('pedidos', 'pedidos_sonido').
    public static final String CH_PEDIDOS = "pedidos_alarma_v1";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin local: detecta el cierre de la app -> offline instantáneo (Parte B).
        registerPlugin(OfflineBeaconPlugin.class);
        super.onCreate(savedInstanceState);
        crearCanalPedidos();
    }

    /**
     * Canal de "pedido entrante" creado en NATIVO, no desde JS.
     *
     * Por qué en nativo (bug real que dejó la app MUDA durante semanas):
     *  - El canal se creaba desde JS con { sound: 'default' }. El plugin de Capacitor no
     *    interpreta ese literal: lo concatena y produce
     *    android.resource://com.pidoo.socio/raw/default → recurso inexistente → canal MUDO.
     *  - Además, con OTA (Capgo) la capa web se adelanta a la nativa: el JS podía crear el
     *    canal apuntando a un sonido que ese APK todavía no incluía, y el canal quedaba
     *    corrupto PARA SIEMPRE (son inmutables).
     *  Aquí R.raw.pedido_rider es una referencia COMPILADA: si el mp3 faltara, no compila
     *  el build en vez de romperse en producción.
     *
     * USAGE_ALARM es lo que lo hace sonar "como Uber": usa el volumen de ALARMA en vez del
     * de notificación, así que suena fuerte aunque el socio lleve el móvil bajo de volumen.
     */
    private void crearCanalPedidos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        // Canales viejos MUDOS. Borrarlos es la ÚNICA reparación posible en los móviles
        // que ya los tienen creados (instalar una versión nueva encima no los arregla).
        try {
            nm.deleteNotificationChannel("pedidos");
            nm.deleteNotificationChannel("pedidos_sonido");
        } catch (Exception ignored) { }

        NotificationChannel ch = new NotificationChannel(
                CH_PEDIDOS, "Pedidos entrantes", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Aviso sonoro cuando te asignan un pedido");
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.enableLights(true);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500, 200, 800});
        ch.setBypassDnd(true);   // solo surte efecto si el usuario concede acceso a No molestar
        ch.setShowBadge(true);

        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://"
                + getPackageName() + "/" + R.raw.pedido_rider);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build();
        ch.setSound(sound, attrs);

        nm.createNotificationChannel(ch);
    }
}

package com.pidoo.socio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

/**
 * PedidoAlarmService — 23-jul-2026. El sonido del pedido EN BUCLE con la app minimizada.
 *
 * Foreground service (tipo shortService, tarea corta <= 3 min) que:
 *  - Reproduce R.raw.pedido_rider EN BUCLE (MediaPlayer.setLooping(true)) con USAGE_ALARM
 *    (volumen de ALARMA, suena fuerte aunque el movil este bajo de volumen).
 *  - Muestra una notificacion persistente "Nuevo pedido" con full-screen intent (heads-up)
 *    en un canal SILENCIOSO propio (el sonido lo pone el MediaPlayer, no el canal, para no
 *    duplicar el aviso).
 *  - Se detiene solo a los 150 s (misma ventana que el cron de reasignacion) o cuando el
 *    rider ABRE la app (MainActivity.onResume -> ACTION_STOP) para aceptar/rechazar.
 *
 * No hace bucle en iOS (limitacion de APNs); esto es Android.
 */
public class PedidoAlarmService extends Service {

    public static final String ACTION_START = "com.pidoo.socio.ALARM_START";
    public static final String ACTION_STOP = "com.pidoo.socio.ALARM_STOP";
    private static final String CH_LOOP = "pedidos_alarma_loop_v1";
    private static final int NOTIF_ID = 4711;
    // Ventana de aceptacion = 150 s (alineada con el cron de reasignacion y el modal).
    private static final long MAX_MS = 150_000L;

    private static volatile boolean sonando = false;

    private MediaPlayer player;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = new Runnable() {
        @Override public void run() { detenerTodo(); }
    };

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            detenerTodo();
            return START_NOT_STICKY;
        }
        // ACTION_START (o arranque por defecto)
        String codigo = intent != null ? intent.getStringExtra("codigo") : null;
        String titulo = intent != null ? intent.getStringExtra("titulo") : null;
        String cuerpo = intent != null ? intent.getStringExtra("cuerpo") : null;

        arrancarEnPrimerPlano(codigo, titulo, cuerpo);

        // Si ya estaba sonando (llegó otra asignación mientras seguía activa), refrescamos
        // la ventana de 150 s pero no reiniciamos el MediaPlayer (ya está en bucle).
        handler.removeCallbacks(autoStop);
        if (!sonando) {
            arrancarSonido();
            sonando = true;
        }
        handler.postDelayed(autoStop, MAX_MS);
        return START_NOT_STICKY;
    }

    private void arrancarEnPrimerPlano(String codigo, String titulo, String cuerpo) {
        asegurarCanal();
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        String tTitulo = (titulo != null && !titulo.isEmpty()) ? titulo
                : ("Nuevo pedido" + (codigo != null && !codigo.isEmpty() ? " · " + codigo : ""));
        String tCuerpo = (cuerpo != null && !cuerpo.isEmpty()) ? cuerpo
                : "Ábrelo para aceptar antes de que se reasigne";

        Notification n = new NotificationCompat.Builder(this, CH_LOOP)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(tTitulo)
                .setContentText(tCuerpo)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setSilent(true) // el sonido lo pone el MediaPlayer en bucle, no la notif
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .build();

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void asegurarCanal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CH_LOOP, "Pedido entrante (en curso)", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Aviso persistente mientras suena la alarma del pedido");
        ch.setSound(null, null); // SILENCIOSO: el MediaPlayer pone el sonido en bucle
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 400, 300, 400, 300, 400});
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);
    }

    private void arrancarSonido() {
        try {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .build();
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(attrs);
            AssetFileDescriptor afd = getResources().openRawResourceFd(R.raw.pedido_rider);
            mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            mp.setLooping(true);
            mp.setVolume(1f, 1f);
            mp.prepare();
            mp.start();
            player = mp;
        } catch (Exception e) {
            // si el audio falla, la notificacion + vibracion siguen avisando.
            player = null;
        }
    }

    private void detenerTodo() {
        sonando = false;
        handler.removeCallbacks(autoStop);
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {}
        stopSelf();
    }

    // API 34+ (shortService): si el sistema nos avisa de que se acaba el tiempo, paramos limpio.
    @Override
    public void onTimeout(int startId) {
        detenerTodo();
    }

    @Override
    public void onDestroy() {
        detenerTodo();
        super.onDestroy();
    }

    /**
     * Detiene la alarma desde fuera (MainActivity.onResume: el rider abrió la app).
     * No-op si no estaba sonando.
     */
    public static void detener(Context ctx) {
        if (!sonando) return;
        try {
            Intent i = new Intent(ctx, PedidoAlarmService.class);
            i.setAction(ACTION_STOP);
            ctx.startService(i);
        } catch (Exception ignored) {}
    }
}

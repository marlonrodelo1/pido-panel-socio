package com.pidoo.socio;

import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.IBinder;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * OfflineBeaconService
 *
 * Servicio "vacío" cuyo único fin es recibir onTaskRemoved(): Android lo llama cuando el
 * usuario DESLIZA/CIERRA la app desde recientes. En ese momento, con el proceso a punto de
 * morir, mandamos un POST rápido a `rider-offline` con el token guardado por la capa JS al
 * ponerse online -> el socio pasa a fuera de línea AL INSTANTE (y su restaurante a solo
 * recogida) sin esperar al gate de frescura (12 min).
 *
 * Best-effort: si el token está caducado o no hay red en ese instante, el POST falla y la
 * red de seguridad (frescura 12 min / auto-offline 60 min) se encarga igual. En OEM que
 * matan el proceso sin llamar a onTaskRemoved, también cae ese backstop.
 *
 * El servicio se arranca desde primer plano (al ponerse online) -> sin restricción de
 * background-start. No es foreground service (la ubicación ya tiene el suyo); solo necesita
 * existir para recibir el callback.
 */
public class OfflineBeaconService extends Service {

    private static final String PREFS = "pidoo_offline_beacon";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // No queremos que Android lo reinicie solo; solo vive mientras el proceso viva.
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // v305 (28-sep-2026): si el latido nativo (PresenceBeatService) está corriendo o ya
        // gestionó el cierre, él manda el Fuera de línea con la llave, el motivo y el aviso al
        // socio. Este beacon viejo (JWT) solo actúa cuando el latido nativo no está: así no
        // salen dos rider-offline ni el registro se queda con el motivo equivocado.
        // Los dos servicios viven en el mismo proceso y sus onTaskRemoved corren en el mismo
        // hilo principal, uno detrás de otro, así que las dos banderas estáticas bastan.
        if (!PresenceBeatService.latiendo && !PresenceBeatService.cierreGestionado) {
            sendOfflineBeacon();
        }
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    private void sendOfflineBeacon() {
        final SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        final String functionsUrl = prefs.getString("functions_url", null);
        final String token = prefs.getString("access_token", null);
        final String anonKey = prefs.getString("anon_key", null);
        if (functionsUrl == null || token == null) return;

        // v305: marca de cierre del todo también por esta vía (sin aviso: el aviso es cosa del
        // latido nativo). Sin ella, si este POST falla (JWT caducado, sin red), al reabrir la
        // app se pondría En línea sola, contra la regla de Marlon.
        try {
            getSharedPreferences(PresenceBeatService.PREFS_CIERRE, MODE_PRIVATE).edit()
                    .putLong(PresenceBeatService.K_CERRADA_AT, System.currentTimeMillis())
                    .putBoolean(PresenceBeatService.K_CERRADA_CON_PEDIDO,
                            getSharedPreferences(PresenceBeatService.PREFS_CIERRE, MODE_PRIVATE)
                                    .getBoolean(PresenceBeatService.K_PEDIDO_EN_CURSO, false))
                    .commit();
            // Y desarmado: si el latido nativo estaba armado pero su servicio no llegó a arrancar
            // (por eso no gestionó él el cierre), el siguiente ping de FCM lo resucitaría
            // (reviveSiArmado) latiendo por quien ha cerrado la app.
            prefs.edit().putBoolean("presence_armed", false).commit();
        } catch (Exception ignored) {
        }

        // onTaskRemoved corre en el hilo principal; la red no puede ir ahí. Lanzamos un hilo
        // corto y esperamos su fin con un timeout breve (Android da un instante antes de matar).
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    URL u = new URL(functionsUrl + "/rider-offline");
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(3000);
                    conn.setReadTimeout(3000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                    if (anonKey != null) conn.setRequestProperty("apikey", anonKey);
                    OutputStream os = conn.getOutputStream();
                    // v305: motivo para socio_presencia_log (rider-offline v13+; las versiones
                    // anteriores lo ignoran).
                    os.write("{\"motivo\":\"cierre_app_android\"}".getBytes("UTF-8"));
                    os.flush();
                    os.close();
                    conn.getResponseCode(); // dispara la petición
                } catch (Exception e) {
                    // best-effort; la red de seguridad cubre el fallo
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        });
        t.start();
        try {
            t.join(3500);
        } catch (InterruptedException ignored) {
        }
    }
}

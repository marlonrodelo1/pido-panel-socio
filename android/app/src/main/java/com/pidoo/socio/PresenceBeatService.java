package com.pidoo.socio;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * PresenceBeatService (v300, 2-ago-2026) — EL LATIDO QUE NO DEPENDE DEL WEBVIEW.
 *
 * Por qué existe: el latido de presencia dependía de JS (el timer de RiderContext en
 * foreground y el callback del watcher de riderGeo en background). Android congela el
 * WebView en segundo plano en muchos móviles → el callback no corre → el socio deja de
 * dar señal a los pocos minutos aunque siga "En línea", y desde el minuto 12 el cliente
 * ve "no hay repartidores" (caso Edinson/Misael, 2-ago). Este servicio late cada 60s EN
 * JAVA, con la LLAVE DE PRESENCIA (socio_presence_tokens, header x-presence-token) en
 * vez del JWT — la llave no caduca ni rota con la sesión, así que tampoco muere por el
 * token (causa del "me desconecto a las 2 horas" del 1-ago).
 *
 * Contrato con la regla de Marlon (2-ago): el socio SOLO se desconecta al (1) cerrar la
 * app del todo → onTaskRemoved manda rider-offline con la llave (ya no muere por JWT
 * caducado como el beacon viejo) o (2) pulsar "Salir de línea" → JS llama disarmPresence.
 * Minimizada / pantalla apagada / OEM matando el proceso → START_STICKY lo resucita y
 * sigue latiendo.
 *
 * Coordenadas: incluye la última posición del sistema (getLastKnownLocation) SOLO si el
 * fix tiene <2 min — un fix viejo diría "sigo ahí" siendo mentira; sin coordenadas el
 * latido estampa solo last_location_at (presencia), nunca last_gps_at (posición real).
 *
 * Se apaga solo si: la llave deja de valer (3×401 seguidos — otro dispositivo tomó la
 * cuenta o hubo logout) o el socio lleva 5 latidos seguidos offline en DB (alive:false —
 * p. ej. el superadmin lo desconectó y la app no está para enterarse).
 */
public class PresenceBeatService extends Service {

    private static final String PREFS = "pidoo_offline_beacon"; // mismas prefs que el beacon
    private static final String CHANNEL_ID = "presencia_v1";
    private static final int NOTIF_ID = 4102;
    private static final long BEAT_MS = 60_000L;
    private static final long MAX_FIX_AGE_MS = 120_000L;
    private static final int MAX_401 = 3;
    private static final int MAX_DEAD = 5;

    private HandlerThread thread;
    private Handler handler;
    private int auth401Count = 0;
    private int deadCount = 0;

    private final Runnable beatRunnable = new Runnable() {
        @Override
        public void run() {
            boolean seguir = doBeat();
            if (seguir && handler != null) {
                handler.postDelayed(this, BEAT_MS);
            } else {
                marcarDesarmado();
                stopSelf();
            }
        }
    };

    /**
     * v303 (2-sep-2026) — Rearrancar el latido si el socio sigue EN SERVICIO (presence_armed).
     * Lo llama PidooMessagingService al recibir el ping de presencia (FCM prioridad alta):
     * la ventana de ejecucion que concede ese push permite arrancar un foreground service
     * desde segundo plano. Si el socio se desconecto o cerro la app (presence_armed=false),
     * no hace nada — el ping no resucita a quien no debe estar En linea.
     *
     * La llave de presencia sobrevive en SharedPreferences a la muerte del proceso, asi que
     * el servicio revive latiendo con la misma llave, sin necesitar JS ni sesion Supabase.
     */
    public static void reviveSiArmado(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.getBoolean("presence_armed", false)) return;
            if (prefs.getString("presence_token", null) == null) return;
            Intent i = new Intent(ctx, PresenceBeatService.class);
            boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            // Mismo criterio que OfflineBeaconPlugin.armPresence: startForegroundService solo
            // si el servicio va a poder llamar a startForeground (permiso fine); si no,
            // startService normal dentro de la ventana del push de alta prioridad.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && fine) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Exception ignored) {
            // Restriccion del OEM o ventana FCM agotada: el siguiente ping (cada ~3-4 min)
            // lo reintenta; la red de seguridad (aviso 10 min / auto-offline) sigue detras.
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        crearCanal();
        thread = new HandlerThread("pidoo-presence-beat");
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!prefs.getBoolean("presence_armed", false)) {
            // Restart STICKY tras un disarm (o arranque espurio): no hay nada que latir.
            stopSelf();
            return START_NOT_STICKY;
        }
        // Foreground con tipo location SOLO si tenemos el permiso (en Android 14 declarar
        // el tipo sin permiso lanza SecurityException). Sin foreground el servicio late
        // igual mientras el proceso viva (peor que foreground, nunca peor que antes).
        try {
            boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            if (fine) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                } else {
                    startForeground(NOTIF_ID, buildNotification());
                }
            }
        } catch (Exception ignored) {
            // best-effort: sin foreground seguimos latiendo mientras el proceso viva
        }
        auth401Count = 0;
        deadCount = 0;
        if (handler != null) {
            handler.removeCallbacks(beatRunnable);
            handler.post(beatRunnable);
        }
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Caso 1 de la regla: cerrar la app del todo = fuera de línea AL INSTANTE.
        // Con la llave de presencia este POST ya no muere por JWT caducado (fallo 7 del 1-ago).
        sendOfflineBeacon();
        marcarDesarmado();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (handler != null) handler.removeCallbacks(beatRunnable);
        if (thread != null) thread.quitSafely();
        handler = null;
        thread = null;
        super.onDestroy();
    }

    private void marcarDesarmado() {
        try {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("presence_armed", false).apply();
        } catch (Exception ignored) {
        }
    }

    // ─── Latido ───

    private boolean doBeat() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!prefs.getBoolean("presence_armed", false)) return false;
        String functionsUrl = prefs.getString("functions_url", null);
        String anonKey = prefs.getString("anon_key", null);
        String presenceToken = prefs.getString("presence_token", null);
        if (functionsUrl == null || presenceToken == null) return false;

        JSONObject body = new JSONObject();
        try {
            Location fix = ultimaPosicionFresca();
            if (fix != null) {
                body.put("latitud", fix.getLatitude());
                body.put("longitud", fix.getLongitude());
                body.put("accuracy", (double) fix.getAccuracy());
            }
        } catch (Exception ignored) {
        }

        HttpURLConnection conn = null;
        try {
            URL u = new URL(functionsUrl + "/rider-heartbeat");
            conn = (HttpURLConnection) u.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("x-presence-token", presenceToken);
            if (anonKey != null) conn.setRequestProperty("apikey", anonKey);
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            if (code == 401 || code == 403) {
                // Llave revocada/rotada: otro dispositivo tomó la cuenta o hubo logout.
                auth401Count++;
                return auth401Count < MAX_401;
            }
            auth401Count = 0;
            if (code >= 200 && code < 300) {
                boolean alive = leerAlive(conn);
                if (!alive) {
                    deadCount++;
                    return deadCount < MAX_DEAD;
                }
                deadCount = 0;
            }
            // Errores 5xx / red rara: seguir intentando (la red vuelve).
            return true;
        } catch (Exception e) {
            // Sin red: seguir latiendo; cuando vuelva la cobertura, revive solo.
            return true;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private boolean leerAlive(HttpURLConnection conn) {
        try {
            InputStream is = conn.getInputStream();
            BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null && sb.length() < 4096) sb.append(line);
            br.close();
            JSONObject res = new JSONObject(sb.toString());
            return res.optBoolean("alive", true);
        } catch (Exception e) {
            return true; // si no se puede leer, no castigar
        }
    }

    /** Última posición del sistema con fix de <2 min (el watcher de riderGeo mantiene el GPS caliente). */
    private Location ultimaPosicionFresca() {
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) return null;
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location mejor = null;
            for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                try {
                    Location l = lm.getLastKnownLocation(provider);
                    if (l == null) continue;
                    if (mejor == null || l.getTime() > mejor.getTime()) mejor = l;
                } catch (Exception ignored) {
                }
            }
            if (mejor == null) return null;
            if (System.currentTimeMillis() - mejor.getTime() > MAX_FIX_AGE_MS) return null;
            return mejor;
        } catch (Exception e) {
            return null;
        }
    }

    // ─── Beacon de cierre (con la llave, ya no muere por JWT caducado) ───

    private void sendOfflineBeacon() {
        final SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        final String functionsUrl = prefs.getString("functions_url", null);
        final String presenceToken = prefs.getString("presence_token", null);
        final String anonKey = prefs.getString("anon_key", null);
        if (functionsUrl == null || presenceToken == null) return;

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
                    conn.setRequestProperty("x-presence-token", presenceToken);
                    if (anonKey != null) conn.setRequestProperty("apikey", anonKey);
                    OutputStream os = conn.getOutputStream();
                    os.write("{}".getBytes("UTF-8"));
                    os.flush();
                    os.close();
                    conn.getResponseCode();
                } catch (Exception e) {
                    // best-effort; la red de seguridad (auto-offline) cubre el fallo
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

    // ─── Notificación ───

    private void crearCanal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "En línea (presencia)", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Mantiene tu conexión con Pidoo mientras estás En línea");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 4102, open, piFlags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Pidoo — En línea")
                .setContentText("Manteniendo tu conexión para recibir pedidos.")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }
}

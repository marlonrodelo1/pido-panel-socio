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
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicReference;

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
 *
 * v305 (28-sep-2026) — AVISO AL CERRAR LA APP DEL TODO. Regla de Marlon: cerrar la app del
 * todo = Fuera de línea, y el socio tiene que ENTERARSE. En onTaskRemoved, si estaba En línea:
 *  1) guarda 'cerrada_por_usuario_at' en unas prefs PROPIAS (PREFS_CIERRE). Van aparte de
 *     PREFS porque disarm() del plugin hace clear() de PREFS y se llevaría la marca antes de
 *     que el JS la lea al reabrir. Con esa marca, al reabrir la app NO se pone En línea sola.
 *  2) publica un aviso en el canal 'avisos_socio_v1' (importancia alta, sonido normal de
 *     notificación, SIN uso de alarma: no puede sonar como un pedido) con un id distinto del de
 *     la notificación fija del servicio (4102). Antes de publicarlo retira el aviso de un cierre
 *     anterior: si siguiera en la bandeja, el nuevo con el mismo id sería una actualización
 *     muda (sin sonido ni ventanita) y el socio no se enteraría.
 *     Si el servidor tarda más de 0,7 s en responder, se publica antes un aviso provisional
 *     ("te estamos poniendo Fuera de línea…"): si el sistema mata el proceso durante la espera,
 *     el socio ya se ha enterado y el aviso no miente. Si responde antes, un solo aviso.
 *  3) manda rider-offline con motivo 'cierre_app_android' (queda en socio_presencia_log) y el
 *     aviso se CORRIGE según lo que pase de verdad (revisión del 28-sep: antes decía "estás Fuera
 *     de línea" aunque el POST fallara, y con las redes de seguridad del servidor apagadas el
 *     socio seguía En línea recibiendo pedidos creyéndose desconectado):
 *       - el servidor lo confirma (2xx) → "Estás Fuera de línea..." sin volver a sonar;
 *       - sin red / error del servidor → "No hemos podido desconectarte..." (vuelve a sonar: ha
 *         cambiado el sentido) y el servicio NO se para: sigue vivo en MODO REINTENTO, manda
 *         rider-offline con la llave cada 30 s (y en cuanto vuelve la red) hasta 30 min. Cuando
 *         lo consigue, el aviso pasa a "Estás Fuera de línea" (o se retira, si el socio tiene la
 *         app delante). Si el socio reabre la app, el reintento SIGUE (el JS intenta lo mismo a
 *         la vez; es idempotente): así, si la vuelve a cerrar sin red, el apagado no se pierde.
 *         Se abandona cuando el JS confirma el Fuera de línea (borra la marca) o cuando el socio
 *         pulsa En línea (el JS para este servicio antes de conectarse; la llave nueva deja la
 *         vieja sin valor: 401);
 *       - la llave ya no vale (401/403) → "No hemos podido desconectarte, abre la app".
 *     En los dos casos de fallo la marca se queda: al reabrir, el JS completa el apagado.
 * Límite honesto: onTaskRemoved solo llega al deslizar la app en recientes (o "cerrar todo"
 * en los móviles que lo implementan así). El cierre forzado desde Ajustes o el OEM matando el
 * proceso NO lo llaman: ahí ni aviso ni Fuera de línea (y eso, por la regla, es lo correcto
 * si el socio no la cerró él).
 */
public class PresenceBeatService extends Service {

    private static final String PREFS = "pidoo_offline_beacon"; // mismas prefs que el beacon
    private static final String CHANNEL_ID = "presencia_v1";
    private static final int NOTIF_ID = 4102;

    // v305: marca de cierre del todo + pedido en curso (prefs propias, ver cabecera).
    public static final String PREFS_CIERRE = "pidoo_cierre_app";
    public static final String K_CERRADA_AT = "cerrada_por_usuario_at";
    public static final String K_CERRADA_CON_PEDIDO = "cerrada_con_pedido";
    public static final String K_PEDIDO_EN_CURSO = "pedido_en_curso";
    // Apagado pendiente (modo reintento): la llave y la dirección con las que seguir intentando
    // rider-offline si el proceso muere y Android resucita el servicio (START_STICKY). Van aquí y
    // no en PREFS porque disarm()/disarmPresence() del plugin borran la llave de PREFS.
    public static final String K_PEND_TOKEN = "apagado_pendiente_token";
    public static final String K_PEND_URL = "apagado_pendiente_url";
    public static final String K_PEND_ANON = "apagado_pendiente_anon";
    // Canal NUEVO de avisos (los canales son inmutables: nunca reutilizar el de pedidos).
    public static final String CANAL_AVISOS = "avisos_socio_v1";
    public static final int NOTIF_ID_AVISO_CIERRE = 4103;

    // Los cuatro momentos del aviso de cierre (ver cabecera).
    private static final int AVISO_ENVIANDO = 0;
    private static final int AVISO_HECHO = 1;
    private static final int AVISO_FALLO_REINTENTANDO = 2;
    private static final int AVISO_FALLO = 3;

    private static final String TITULO_ENVIANDO = "Cerrando Pidoo Socio";
    private static final String TEXTO_ENVIANDO =
            "Has cerrado Pidoo Socio por completo. Te estamos poniendo Fuera de línea…";
    private static final String TITULO_CIERRE = "Estás Fuera de línea";
    private static final String TEXTO_CIERRE =
            "Has cerrado Pidoo Socio por completo: estás Fuera de línea y no vas a recibir pedidos. "
            + "Abre la app y pulsa En línea para volver.";
    private static final String TEXTO_CIERRE_CON_PEDIDO =
            "Has cerrado Pidoo Socio por completo: estás Fuera de línea y no vas a recibir pedidos nuevos. "
            + "Tienes un pedido pendiente de entregar: abre la app para seguir con el reparto.";
    private static final String TITULO_FALLO = "No hemos podido desconectarte";
    private static final String TEXTO_FALLO_REINTENTANDO =
            "Has cerrado Pidoo Socio, pero no hay conexión y sigues En línea: te pueden llegar pedidos. "
            + "Lo seguimos intentando; si quieres desconectarte ya, abre la app.";
    private static final String TEXTO_FALLO =
            "Has cerrado Pidoo Socio, pero no hemos podido ponerte Fuera de línea y te pueden seguir "
            + "llegando pedidos. Abre la app para desconectarte.";
    private static final String COLETILLA_PEDIDO = " Tienes un pedido pendiente de entregar.";

    // Modo reintento del apagado (ver cabecera).
    private static final long REINTENTO_MS = 30_000L;
    private static final long REINTENTO_MAX_MS = 30 * 60_000L;

    // v305: coordinación con OfflineBeaconService (el beacon viejo, que también recibe
    // onTaskRemoved). Mismo proceso y mismo hilo principal: si este servicio está latiendo o ya
    // gestionó el cierre, el viejo no manda su rider-offline (evita el doble apagado y que el
    // registro quede con el motivo equivocado).
    static volatile boolean latiendo = false;
    static volatile boolean cierreGestionado = false;
    private static final long BEAT_MS = 60_000L;
    private static final long MAX_FIX_AGE_MS = 120_000L;
    private static final int MAX_401 = 3;
    private static final int MAX_DEAD = 5;

    private HandlerThread thread;
    private volatile Handler handler;
    private int auth401Count = 0;
    private int deadCount = 0;

    // v305: estado del modo reintento del apagado (se toca desde el hilo principal y desde el
    // del latido: volatile).
    private volatile boolean modoReintento = false;
    private volatile long pCierreAt = 0L;
    private volatile long pLimite = 0L;
    private volatile String pUrl, pToken, pAnon;
    private volatile boolean pConPedido = false;
    private ConnectivityManager.NetworkCallback redCallback;
    // La petición de reintento en vuelo, para cortarla si el socio vuelve a la app: un apagado
    // que llegara tarde podría caer DESPUÉS de un En línea recién pulsado.
    private final AtomicReference<HttpURLConnection> reintentoEnVuelo = new AtomicReference<>();

    private final Runnable beatRunnable = new Runnable() {
        @Override
        public void run() {
            // v305: tras un cierre del todo ya no se late (el apagado pendiente manda). Sin esta
            // guarda, un latido que estuviera en vuelo al cerrar la app acabaría en stopSelf()
            // y mataría el modo reintento.
            if (modoReintento) return;
            boolean seguir = doBeat();
            if (modoReintento) return;
            Handler h = handler;
            if (seguir && h != null) {
                h.postDelayed(this, BEAT_MS);
            } else {
                marcarDesarmado();
                stopSelf();
            }
        }
    };

    // v305: un intento del apagado pendiente (corre en el hilo del latido: puede usar la red).
    private final Runnable reintentoRunnable = new Runnable() {
        @Override
        public void run() {
            if (!modoReintento) return;
            if (!apagadoSigueHaciendoFalta()) {
                // El socio abrió la app o pulsó En línea: ya no es asunto nuestro.
                salirModoReintento();
                return;
            }
            ResultadoOffline r = postOffline(pUrl, pToken, pAnon, "cierre_app_android", 5000, reintentoEnVuelo);
            if (!modoReintento) return; // lo paró otra vía mientras esperábamos la respuesta
            if (r.ok()) {
                boolean real = r.enCurso >= 0 ? r.enCurso > 0 : pConPedido;
                cerrarApagadoPendiente(PresenceBeatService.this, real);
                if (MainActivity.appEnPrimerPlano) {
                    // El socio tiene la app delante: la pantalla ya le dice Fuera de línea (el JS se
                    // entera por la BD); un aviso sonando encima solo confundiría.
                    cancelarAvisoCierre(PresenceBeatService.this);
                } else {
                    // Suena otra vez: el aviso pasa de "no hemos podido" a "ya estás Fuera de línea".
                    avisarCierre(PresenceBeatService.this, AVISO_HECHO, real, false);
                }
                salirModoReintento();
                return;
            }
            if (r.llaveNoVale()) {
                // La llave rotó o se revocó: alguien pulsó En línea (aquí o en otro móvil) o cerró
                // sesión. Este aviso ya no describe la realidad: se retira.
                borrarPendiente(PresenceBeatService.this);
                cancelarAvisoCierre(PresenceBeatService.this);
                salirModoReintento();
                return;
            }
            if (System.currentTimeMillis() > pLimite) {
                // Media hora sin red: se deja de intentar. La marca sigue: al abrir la app, el JS
                // completa el apagado. El aviso se queda en "abre la app" (sin volver a sonar).
                borrarPendiente(PresenceBeatService.this);
                avisarCierre(PresenceBeatService.this, AVISO_FALLO, pConPedido, true);
                salirModoReintento();
                return;
            }
            Handler h = handler;
            if (h != null) h.postDelayed(this, REINTENTO_MS);
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
            // v305: si hay un apagado pendiente de un cierre del todo, seguir con él (también
            // cuando Android resucita el servicio tras matar el proceso).
            if (modoReintento) return START_STICKY;
            if (reanudarApagadoPendiente()) return START_STICKY;
            // Restart STICKY tras un disarm (o arranque espurio): no hay nada que latir.
            stopSelf();
            return START_NOT_STICKY;
        }
        // v305: el socio ha vuelto a ponerse En línea → el apagado pendiente de un cierre anterior
        // ya no toca (armPresence borró la marca y la llave nueva deja la vieja sin valor).
        if (modoReintento) abandonarReintento();
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
        latiendo = true;
        cierreGestionado = false;
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
        // v305: solo si estaba En línea (armado). Si no, no hay nada que apagar ni que avisar.
        if (modoReintento) {
            // Ya estamos reintentando el apagado de un cierre anterior (el socio abrió la app y la
            // volvió a cerrar antes de que el JS tomara el relevo): seguir con ello.
            super.onTaskRemoved(rootIntent);
            return;
        }
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean armado = prefs.getBoolean("presence_armed", false);
        if (!armado) {
            marcarDesarmado();
            stopSelf();
            super.onTaskRemoved(rootIntent);
            return;
        }

        cierreGestionado = true;
        Handler h = handler;
        if (h != null) h.removeCallbacks(beatRunnable);
        final String url = prefs.getString("functions_url", null);
        final String token = prefs.getString("presence_token", null);
        final String anon = prefs.getString("anon_key", null);
        SharedPreferences cierre = getSharedPreferences(PREFS_CIERRE, MODE_PRIVATE);
        boolean conPedido = cierre.getBoolean(K_PEDIDO_EN_CURSO, false);
        long at = System.currentTimeMillis();
        // commit() (síncrono) y no apply(): el proceso puede morir en cualquier momento.
        // La llave va también a PREFS_CIERRE por si hay que reintentar tras resucitar el servicio.
        SharedPreferences.Editor ed = cierre.edit()
                .putLong(K_CERRADA_AT, at)
                .putBoolean(K_CERRADA_CON_PEDIDO, conPedido);
        if (url != null && token != null) {
            ed.putString(K_PEND_TOKEN, token).putString(K_PEND_URL, url);
            if (anon != null) ed.putString(K_PEND_ANON, anon); else ed.remove(K_PEND_ANON);
        }
        ed.commit();
        // Desarmado YA: el ping de FCM no debe resucitar el latido de quien cerró la app.
        marcarDesarmado();

        // Retirar antes el aviso de un cierre anterior: si siguiera en la bandeja, el nuevo (mismo
        // id) sería una actualización muda y el socio no se enteraría (ver cabecera).
        cancelarAvisoCierre(this);

        // 1) Apagado en el servidor con su motivo. 2) El aviso dice lo que ha pasado de verdad.
        //    Si la respuesta tarda más de 0,7 s, antes se publica el provisional ("te estamos
        //    poniendo Fuera de línea…"), que suena: si el proceso muriera en la espera, el socio
        //    ya se ha enterado y el aviso no miente. Si responde rápido, un solo aviso, el bueno.
        ResultadoOffline r;
        boolean provisional = false;
        if (url != null && token != null) {
            EnvioOffline envio = new EnvioOffline(url, token, anon, "cierre_app_android");
            r = envio.esperar(700);
            if (r == null) {
                provisional = true;
                avisarCierre(this, AVISO_ENVIANDO, conPedido, false);
                r = envio.esperar(2800);
            }
            if (r == null) r = new ResultadoOffline(0, -1); // sin respuesta a tiempo: reintentar
        } else {
            r = new ResultadoOffline(401, -1); // sin llave no hay con qué apagar: que abra la app
        }
        if (r.ok()) {
            // El servidor sabe mejor si hay un pedido aceptado sin entregar.
            boolean real = r.enCurso >= 0 ? r.enCurso > 0 : conPedido;
            cerrarApagadoPendiente(this, real);
            // Tras el provisional, sin segundo sonido; si es el primer aviso, suena.
            avisarCierre(this, AVISO_HECHO, real, provisional);
            stopSelf();
        } else if (r.llaveNoVale()) {
            borrarPendiente(this);
            avisarCierre(this, AVISO_FALLO, conPedido, false); // suena: cambia el sentido
            stopSelf();
        } else {
            // Sin red, tiempo agotado o error del servidor: el servicio sigue vivo reintentando.
            avisarCierre(this, AVISO_FALLO_REINTENTANDO, conPedido, false);
            entrarModoReintento(at, url, token, anon, conPedido);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        latiendo = false;
        modoReintento = false;
        dejarDeEscucharRed();
        cortarReintentoEnVuelo(); // lo para el JS (disarmPresence) al pulsar En línea o al confirmar el apagado
        Handler h = handler;
        if (h != null) {
            h.removeCallbacks(beatRunnable);
            h.removeCallbacks(reintentoRunnable);
        }
        if (thread != null) thread.quitSafely();
        handler = null;
        thread = null;
        // v305: sin el permiso de ubicación el servicio no llega a primer plano, y entonces la
        // notificación fija "Desconectando" del modo reintento es una notificación suelta que
        // Android no retira al parar el servicio: quedaría para siempre (y no se puede deslizar).
        // En primer plano ya la retira el sistema; cancelarla aquí no molesta.
        try {
            NotificationManagerCompat.from(this).cancel(NOTIF_ID);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    // ─── v305: modo reintento del apagado tras un cierre del todo sin red ───

    private void entrarModoReintento(long cierreAt, String url, String token, String anon, boolean conPedido) {
        pCierreAt = cierreAt;
        pLimite = cierreAt + REINTENTO_MAX_MS;
        pUrl = url;
        pToken = token;
        pAnon = anon;
        pConPedido = conPedido;
        modoReintento = true;
        // La notificación fija decía "En línea · Manteniendo tu conexión": ya no es verdad.
        try {
            boolean puede = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                    || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (puede && nm != null) nm.notify(NOTIF_ID, buildNotificationDesconectando());
        } catch (Exception ignored) {
        }
        escucharRed();
        Handler h = handler;
        if (h != null) {
            h.removeCallbacks(reintentoRunnable);
            h.postDelayed(reintentoRunnable, REINTENTO_MS);
        }
    }

    /**
     * Android resucitó el servicio (START_STICKY) tras matar el proceso con un apagado pendiente:
     * se retoma con la llave guardada en PREFS_CIERRE. Solo si la marca de cierre sigue ahí y no
     * ha pasado la media hora.
     */
    private boolean reanudarApagadoPendiente() {
        try {
            SharedPreferences c = getSharedPreferences(PREFS_CIERRE, MODE_PRIVATE);
            long at = c.getLong(K_CERRADA_AT, 0L);
            String token = c.getString(K_PEND_TOKEN, null);
            String url = c.getString(K_PEND_URL, null);
            if (at <= 0L || token == null || url == null) return false;
            if (System.currentTimeMillis() - at > REINTENTO_MAX_MS) {
                borrarPendiente(this);
                return false;
            }
            try {
                boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
                if (fine) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIF_ID, buildNotificationDesconectando(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                    } else {
                        startForeground(NOTIF_ID, buildNotificationDesconectando());
                    }
                }
            } catch (Exception ignored) {
                // sin foreground se intenta igual mientras el proceso viva
            }
            cierreGestionado = true;
            latiendo = true; // el beacon viejo no debe mandar otro apagado por su cuenta
            entrarModoReintento(at, url, token, c.getString(K_PEND_ANON, null),
                    c.getBoolean(K_CERRADA_CON_PEDIDO, false));
            Handler h = handler;
            if (h != null) {
                h.removeCallbacks(reintentoRunnable);
                h.post(reintentoRunnable);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** La marca de ESTE cierre sigue sin leer y el socio no ha vuelto a ponerse En línea. */
    private boolean apagadoSigueHaciendoFalta() {
        try {
            long at = getSharedPreferences(PREFS_CIERRE, MODE_PRIVATE).getLong(K_CERRADA_AT, 0L);
            boolean armado = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("presence_armed", false);
            return at == pCierreAt && !armado;
        } catch (Exception e) {
            return true;
        }
    }

    /** Deja el modo reintento sin parar el servicio (el socio vuelve a estar En línea). */
    private void abandonarReintento() {
        modoReintento = false;
        dejarDeEscucharRed();
        Handler h = handler;
        if (h != null) h.removeCallbacks(reintentoRunnable);
        cortarReintentoEnVuelo();
    }

    /** Corta la petición de reintento que esté en vuelo (en otro hilo: cerrar el socket es E/S). */
    private void cortarReintentoEnVuelo() {
        final HttpURLConnection c = reintentoEnVuelo.getAndSet(null);
        if (c == null) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                }
            }
        }).start();
    }

    private void salirModoReintento() {
        abandonarReintento();
        stopSelf();
    }

    /** En cuanto vuelve la red, reintentar sin esperar a los 30 s. */
    private void escucharRed() {
        if (redCallback != null) return;
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            if (cm == null) return;
            ConnectivityManager.NetworkCallback cb = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    Handler h = handler;
                    if (h != null && modoReintento) {
                        h.removeCallbacks(reintentoRunnable);
                        h.postDelayed(reintentoRunnable, 2_000L); // margen para que la red asiente
                    }
                }
            };
            cm.registerDefaultNetworkCallback(cb);
            redCallback = cb;
        } catch (Exception ignored) {
            redCallback = null; // sin el aviso de red, los reintentos cada 30 s bastan
        }
    }

    private void dejarDeEscucharRed() {
        ConnectivityManager.NetworkCallback cb = redCallback;
        redCallback = null;
        if (cb == null) return;
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            if (cm != null) cm.unregisterNetworkCallback(cb);
        } catch (Exception ignored) {
        }
    }

    /** Apagado confirmado: fuera la llave pendiente; la marca se queda (la lee el JS al reabrir). */
    private static void cerrarApagadoPendiente(Context ctx, boolean conPedido) {
        try {
            ctx.getSharedPreferences(PREFS_CIERRE, Context.MODE_PRIVATE).edit()
                    .putBoolean(K_CERRADA_CON_PEDIDO, conPedido)
                    .remove(K_PEND_TOKEN)
                    .remove(K_PEND_URL)
                    .remove(K_PEND_ANON)
                    .commit();
        } catch (Exception ignored) {
        }
    }

    static void borrarPendiente(Context ctx) {
        try {
            ctx.getSharedPreferences(PREFS_CIERRE, Context.MODE_PRIVATE).edit()
                    .remove(K_PEND_TOKEN)
                    .remove(K_PEND_URL)
                    .remove(K_PEND_ANON)
                    .commit();
        } catch (Exception ignored) {
        }
    }

    private void marcarDesarmado() {
        try {
            // v305: commit() (síncrono) y no apply(): tras cerrar la app del todo el proceso puede
            // morir enseguida, y si el "desarmado" no llegara al disco, el siguiente ping de FCM
            // (reviveSiArmado) resucitaría el latido de quien cerró la app.
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("presence_armed", false).commit();
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
            // v305: qué app es (socios.app_plataforma / app_version). Hasta hoy no se podía
            // saber si un socio había actualizado ni medir si un arreglo había llegado.
            body.put("app_plataforma", "android");
            String version = versionApp(this);
            if (version != null) body.put("app_version", version);
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

    /**
     * v305: resultado de un rider-offline. http = código HTTP, o 0 si no hubo respuesta (sin red,
     * tiempo agotado). enCurso = pedidos en curso que dice el servidor (rider-offline v13+), o -1.
     * Hasta la revisión del 28-sep solo se devolvía enCurso, y -1 valía igual para "sin red" que
     * para "apagado bien con la edge v12": no había forma de saber si el socio quedó Fuera de línea.
     */
    static final class ResultadoOffline {
        final int http;
        final int enCurso;

        ResultadoOffline(int http, int enCurso) {
            this.http = http;
            this.enCurso = enCurso;
        }

        boolean ok() {
            return http >= 200 && http < 300;
        }

        /** La llave ya no existe (rotada por otro En línea, o revocada): no sirve reintentar. */
        boolean llaveNoVale() {
            return http == 401 || http == 403;
        }
    }

    /** rider-offline con la llave y el motivo. Síncrono: llamar fuera del hilo principal. */
    private static ResultadoOffline postOffline(String functionsUrl, String presenceToken, String anonKey,
                                                String motivo, int timeoutMs,
                                                AtomicReference<HttpURLConnection> enVuelo) {
        if (functionsUrl == null || presenceToken == null) return new ResultadoOffline(401, -1);
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("motivo", motivo);
            URL u = new URL(functionsUrl + "/rider-offline");
            conn = (HttpURLConnection) u.openConnection();
            if (enVuelo != null) enVuelo.set(conn);
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("x-presence-token", presenceToken);
            if (anonKey != null) conn.setRequestProperty("apikey", anonKey);
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.flush();
            os.close();
            int code = conn.getResponseCode();
            int enCurso = -1;
            if (code >= 200 && code < 300) {
                try {
                    BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null && sb.length() < 4096) sb.append(line);
                    br.close();
                    JSONObject res = new JSONObject(sb.toString());
                    if (res.has("pedidos_en_curso") && !res.isNull("pedidos_en_curso")) {
                        enCurso = res.optInt("pedidos_en_curso", -1);
                    }
                } catch (Exception ignored) {
                    // cuerpo ilegible: el apagado se hizo igual (2xx)
                }
            }
            return new ResultadoOffline(code, enCurso);
        } catch (Exception e) {
            return new ResultadoOffline(0, -1); // sin red / tiempo agotado (o cortada a propósito)
        } finally {
            if (enVuelo != null) enVuelo.compareAndSet(conn, null);
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * El rider-offline de onTaskRemoved (hilo principal, donde no puede ir la red): va en un hilo
     * corto y se espera por tramos (en total, 3,5 s como mucho). Si el hilo no ha terminado,
     * cuenta como "sin respuesta" y el modo reintento lo vuelve a mandar: rider-offline es
     * idempotente (socio_presencia_log solo apunta fila si en_servicio cambia).
     */
    private static final class EnvioOffline {
        private final Thread hilo;
        private final AtomicReference<ResultadoOffline> ref = new AtomicReference<>();

        EnvioOffline(final String url, final String token, final String anon, final String motivo) {
            hilo = new Thread(new Runnable() {
                @Override
                public void run() {
                    ref.set(postOffline(url, token, anon, motivo, 3000, null));
                }
            });
            hilo.start();
        }

        /** Espera hasta ms; null si todavía no hay respuesta. */
        ResultadoOffline esperar(long ms) {
            try {
                hilo.join(ms);
            } catch (InterruptedException ignored) {
            }
            return hilo.isAlive() ? null : ref.get();
        }
    }

    // ─── v305: aviso de "has cerrado la app del todo" ───

    /**
     * Canal de avisos del socio. Importancia ALTA para que se vea (heads-up), pero con el sonido
     * normal de notificación: nada de USAGE_ALARM ni del sonido del pedido. Lo crean también
     * MainActivity (para que exista desde el primer arranque y lo pueda usar una push del
     * servidor con channel_id 'avisos_socio_v1') y el propio aviso antes de publicarse.
     * createNotificationChannel es idempotente.
     */
    public static void crearCanalAvisos(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(
                    CANAL_AVISOS, "Avisos de tu conexión", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Te avisa si quedas Fuera de línea, por ejemplo al cerrar la app del todo");
            ch.enableVibration(true);
            ch.setShowBadge(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        } catch (Exception ignored) {
        }
    }

    /** Retira el aviso de cierre de la bandeja (lo usan también el plugin al abrir o ponerse En línea). */
    public static void cancelarAvisoCierre(Context ctx) {
        try {
            NotificationManagerCompat.from(ctx).cancel(NOTIF_ID_AVISO_CIERRE);
        } catch (Exception ignored) {
        }
    }

    /**
     * Publica (o corrige) el aviso de cierre. soloUnaVez=true: si el aviso ya está en la bandeja,
     * se cambia el texto sin volver a sonar; false: suena aunque ya estuviera. El primer aviso de
     * cada cierre va siempre precedido de cancelarAvisoCierre, así que suena seguro.
     */
    private static void avisarCierre(Context ctx, int tipo, boolean conPedido, boolean soloUnaVez) {
        try {
            // Android 13+: sin el permiso de notificaciones no se puede publicar nada.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return;
            }
            NotificationManagerCompat nmc = NotificationManagerCompat.from(ctx);
            if (!nmc.areNotificationsEnabled()) return;
            crearCanalAvisos(ctx);

            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(ctx, NOTIF_ID_AVISO_CIERRE, open, piFlags);

            String titulo;
            String texto;
            switch (tipo) {
                case AVISO_ENVIANDO:
                    titulo = TITULO_ENVIANDO;
                    texto = TEXTO_ENVIANDO;
                    break;
                case AVISO_HECHO:
                    titulo = TITULO_CIERRE;
                    texto = conPedido ? TEXTO_CIERRE_CON_PEDIDO : TEXTO_CIERRE;
                    break;
                case AVISO_FALLO_REINTENTANDO:
                    titulo = TITULO_FALLO;
                    texto = TEXTO_FALLO_REINTENTANDO + (conPedido ? COLETILLA_PEDIDO : "");
                    break;
                default:
                    titulo = TITULO_FALLO;
                    texto = TEXTO_FALLO + (conPedido ? COLETILLA_PEDIDO : "");
                    break;
            }
            Notification n = new NotificationCompat.Builder(ctx, CANAL_AVISOS)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(titulo)
                    .setContentText(texto)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(texto))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(soloUnaVez)
                    .setContentIntent(pi)
                    .build();
            nmc.notify(NOTIF_ID_AVISO_CIERRE, n);
        } catch (Exception ignored) {
            // best-effort: el apagado sigue su curso aunque el aviso no se pueda publicar
        }
    }

    // ─── v305: versión de la app para la telemetría del latido ───

    private static String versionCache = null;

    static String versionApp(Context ctx) {
        if (versionCache != null) return versionCache;
        try {
            android.content.pm.PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
            versionCache = pi.versionName + " (" + code + ")";
        } catch (Exception e) {
            versionCache = null;
        }
        return versionCache;
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

    /** v305: la notificación fija mientras se reintenta el apagado tras cerrar la app sin red. */
    private Notification buildNotificationDesconectando() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 4102, open, piFlags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Pidoo — Desconectando")
                .setContentText("Sin conexión: te pondremos Fuera de línea en cuanto vuelva.")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }
}

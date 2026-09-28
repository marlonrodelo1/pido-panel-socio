package com.pidoo.socio;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.nfc.NfcAdapter;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * OfflineBeacon (plugin Capacitor local).
 *
 * Puente entre la capa JS (RiderContext) y los servicios nativos.
 *  - arm({token, functionsUrl, anonKey}): guarda el token y arranca el servicio que
 *    detectará el cierre de la app -> offline instantáneo. Se llama al ponerse EN SERVICIO.
 *  - updateToken({token}): refresca el token guardado (la sesión Supabase rota cada ~1h).
 *  - disarm(): borra el token y para el servicio. Se llama al ponerse offline / logout.
 *  - requestBatteryExemption(): abre los ajustes de optimización de batería para que el SO
 *    no mate el proceso en segundo plano (variante SETTINGS, no el prompt directo, para no
 *    complicar la revisión de Play).
 *
 * v300 (2-ago-2026) — LATIDO NATIVO DE PRESENCIA:
 *  - armPresence({presenceToken, functionsUrl, anonKey}): guarda la LLAVE DE PRESENCIA y
 *    arranca PresenceBeatService (foreground, late cada 60s en Java, inmune a la
 *    congelación del WebView). Se llama al ponerse EN SERVICIO, tras emitir la llave.
 *  - disarmPresence(): apaga el latido nativo (botón "Salir de línea" / logout / superado).
 *  - checkPrereqs(): estado de los requisitos para latir de fondo: permiso de ubicación
 *    (primer plano y "Permitir siempre") + exención de batería. Lo usa RiderContext para
 *    avisar proactivamente en vez de esperar al fallo del watcher.
 *
 * v305 (28-sep-2026):
 *  - consumeClosedFlag({soloLeer?}): {cerrada, at, conPedido}. Dice si el socio CERRÓ LA APP
 *    DEL TODO estando En línea (lo apunta PresenceBeatService.onTaskRemoved) y borra la marca
 *    (salvo soloLeer:true). RiderContext la LEE al arrancar (soloLeer) y solo la borra cuando el
 *    Fuera de línea está confirmado en el servidor: si se borrase antes y el apagado fallara, el
 *    siguiente arranque reanudaría el turno solo. Al borrarla retira también el aviso de cierre
 *    de la bandeja (ya cumplió), igual que armPresence.
 *  - marcarPedidoEnCurso({enCurso}): el JS avisa si hay un pedido aceptado sin entregar, para
 *    que el aviso de cierre lo recuerde aunque en ese instante no haya red.
 *  - tapToPayChecks(): lo que el móvil ofrece para cobrar con Tap to Pay (NFC, opciones de
 *    desarrollador...). Solo informa; qué hacer con ello lo decide el JS.
 *  - openNfcSettings(): abre los ajustes de NFC (o los de conexiones si el móvil no los tiene).
 */
@CapacitorPlugin(name = "OfflineBeacon")
public class OfflineBeaconPlugin extends Plugin {

    private static final String PREFS = "pidoo_offline_beacon";

    @PluginMethod
    public void arm(PluginCall call) {
        String token = call.getString("token");
        String functionsUrl = call.getString("functionsUrl");
        String anonKey = call.getString("anonKey");
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putString("access_token", token)
                .putString("functions_url", functionsUrl)
                .putString("anon_key", anonKey)
                .apply();
        // Arrancar el servicio (desde primer plano -> permitido) para que reciba onTaskRemoved.
        try {
            ctx.startService(new Intent(ctx, OfflineBeaconService.class));
        } catch (Exception e) {
            // si falla el arranque, el gate de frescura sigue cubriendo
        }
        call.resolve();
    }

    @PluginMethod
    public void updateToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null) {
            call.resolve();
            return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString("access_token", token).apply();
        call.resolve();
    }

    @PluginMethod
    public void disarm(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().clear().apply();
        try {
            ctx.stopService(new Intent(ctx, OfflineBeaconService.class));
        } catch (Exception e) {
        }
        call.resolve();
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            // no disponible en algunos SO/OEM; no es crítico
        }
        call.resolve();
    }

    // ─── v300: latido nativo de presencia ───

    @PluginMethod
    public void armPresence(PluginCall call) {
        String presenceToken = call.getString("presenceToken");
        String functionsUrl = call.getString("functionsUrl");
        String anonKey = call.getString("anonKey");
        if (presenceToken == null || functionsUrl == null) {
            call.reject("presenceToken y functionsUrl son obligatorios");
            return;
        }
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = prefs.edit()
                .putString("presence_token", presenceToken)
                .putString("functions_url", functionsUrl)
                .putBoolean("presence_armed", true);
        if (anonKey != null) ed.putString("anon_key", anonKey);
        ed.apply();
        // v305: volver a estar En línea anula cualquier marca de cierre que no se llegara a leer
        // (si no, el próximo arranque tras un cierre del SISTEMA se creería un cierre del socio),
        // y retira el aviso del cierre anterior: si se quedara en la bandeja, el aviso del próximo
        // cierre sería una actualización muda con el mismo id (sin sonido).
        borrarMarcaCierre(ctx);
        PresenceBeatService.cancelarAvisoCierre(ctx);
        try {
            Intent i = new Intent(ctx, PresenceBeatService.class);
            boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            // startForegroundService exige que el servicio llame a startForeground; el
            // servicio solo lo hace con el permiso fine concedido (Android 14 lanza
            // SecurityException si declaras tipo location sin permiso). Sin permiso,
            // startService normal: late mientras el proceso viva (nunca peor que antes).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && fine) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Exception e) {
            // si no arranca, el latido JS y la red de seguridad siguen cubriendo
        }
        call.resolve();
    }

    @PluginMethod
    public void disarmPresence(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putBoolean("presence_armed", false).remove("presence_token").apply();
        try {
            ctx.stopService(new Intent(ctx, PresenceBeatService.class));
        } catch (Exception e) {
        }
        call.resolve();
    }

    @PluginMethod
    public void checkPrereqs(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        try {
            boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            boolean bg = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                bg = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
            }
            boolean battery = true;
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                battery = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            }
            out.put("fineLocation", fine);
            out.put("bgLocation", bg);
            out.put("batteryExempt", battery);
            // v303: fabricantes que matan procesos aunque haya foreground service + exencion
            // de bateria, salvo que el usuario conceda su "Inicio automatico" propietario
            // (caso Edinson, Xiaomi HyperOS). No hay API para CONSULTAR ese permiso: solo
            // se puede sospechar por fabricante y abrir su pantalla de ajustes.
            out.put("autostartSospechoso", esFabricanteAsesino());
        } catch (Exception e) {
            out.put("error", e.getMessage());
        }
        call.resolve(out);
    }

    // ─── v303: "Inicio automatico" en OEMs que matan el latido ───

    private static boolean esFabricanteAsesino() {
        String m = (Build.MANUFACTURER == null ? "" : Build.MANUFACTURER).toLowerCase();
        String b = (Build.BRAND == null ? "" : Build.BRAND).toLowerCase();
        String[] asesinos = { "xiaomi", "redmi", "poco", "huawei", "honor", "oppo", "realme", "vivo", "oneplus" };
        for (String a : asesinos) {
            if (m.contains(a) || b.contains(a)) return true;
        }
        return false;
    }

    /**
     * Abre la pantalla de "Inicio automatico" del fabricante (Xiaomi/Huawei/Oppo/Vivo...).
     * Sin ese permiso, el OEM mata el proceso en segundo plano y ni START_STICKY ni la
     * exencion de bateria lo salvan (medido con Edinson el 2-sep: proceso + servicio
     * muertos a la hora de ponerse En linea). No es consultable: se abre la pantalla y
     * se confia en el usuario. Fallback: ficha de la app en Ajustes.
     */
    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Context ctx = getContext();
        // Componentes conocidos de las pantallas de autostart por fabricante.
        String[][] componentes = {
                { "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" }, // Xiaomi/MIUI/HyperOS
                { "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
                { "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity" },
                { "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" }, // Oppo/Realme
                { "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },
                { "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity" },
        };
        for (String[] c : componentes) {
            try {
                Intent intent = new Intent();
                intent.setClassName(c[0], c[1]);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                call.resolve();
                return;
            } catch (Exception ignored) {
                // esa pantalla no existe en este SO: probar la siguiente
            }
        }
        // Fallback universal: la ficha de la app (desde ahi se llega a batería/autostart).
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    // ─── v305: cierre de la app del todo ───

    // Borra la marca y el apagado pendiente (la llave con la que PresenceBeatService reintenta
    // rider-offline si no había red al cerrar): sin marca, el reintento se abandona solo.
    private static void borrarMarcaCierre(Context ctx) {
        try {
            ctx.getSharedPreferences(PresenceBeatService.PREFS_CIERRE, Context.MODE_PRIVATE).edit()
                    .remove(PresenceBeatService.K_CERRADA_AT)
                    .remove(PresenceBeatService.K_CERRADA_CON_PEDIDO)
                    .remove(PresenceBeatService.K_PEND_TOKEN)
                    .remove(PresenceBeatService.K_PEND_URL)
                    .remove(PresenceBeatService.K_PEND_ANON)
                    .commit();
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void consumeClosedFlag(PluginCall call) {
        Context ctx = getContext();
        boolean soloLeer = Boolean.TRUE.equals(call.getBoolean("soloLeer", false));
        JSObject out = new JSObject();
        try {
            SharedPreferences c = ctx.getSharedPreferences(PresenceBeatService.PREFS_CIERRE, Context.MODE_PRIVATE);
            long at = c.getLong(PresenceBeatService.K_CERRADA_AT, 0L);
            boolean cerrada = at > 0L;
            out.put("cerrada", cerrada);
            if (cerrada) out.put("at", at);
            out.put("conPedido", cerrada && c.getBoolean(PresenceBeatService.K_CERRADA_CON_PEDIDO, false));
            if (!soloLeer) {
                // El JS solo lo pide así cuando el Fuera de línea ya está confirmado (o al pulsar
                // En línea): el aviso de la bandeja ya no hace falta.
                if (cerrada) borrarMarcaCierre(ctx);
                PresenceBeatService.cancelarAvisoCierre(ctx);
            }
        } catch (Exception e) {
            out.put("cerrada", false);
            out.put("conPedido", false);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void marcarPedidoEnCurso(PluginCall call) {
        boolean enCurso = Boolean.TRUE.equals(call.getBoolean("enCurso", false));
        try {
            getContext().getSharedPreferences(PresenceBeatService.PREFS_CIERRE, Context.MODE_PRIVATE).edit()
                    .putBoolean(PresenceBeatService.K_PEDIDO_EN_CURSO, enCurso)
                    .apply();
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    // ─── v305: comprobaciones para el cobro con el móvil (Tap to Pay) ───

    /**
     * Lo que el móvil ofrece para Tap to Pay. El SDK de Stripe se queda colgado en
     * discoverReaders si el móvil no vale (NFC apagado, opciones de desarrollador...) sin dar
     * error (nota del 28-sep), así que la app lo mira ANTES y se lo explica al socio.
     * Solo informa: no decide si el cobro está disponible.
     */
    @PluginMethod
    public void tapToPayChecks(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        out.put("plataforma", "android");
        boolean tieneNfc = false;
        boolean nfcActivado = false;
        try {
            NfcAdapter nfc = NfcAdapter.getDefaultAdapter(ctx);
            tieneNfc = nfc != null;
            nfcActivado = nfc != null && nfc.isEnabled();
        } catch (Exception ignored) {
        }
        boolean opcionesDesarrollador = false;
        boolean depuracionUsb = false;
        try {
            opcionesDesarrollador = Settings.Global.getInt(ctx.getContentResolver(),
                    Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1;
        } catch (Exception ignored) {
        }
        try {
            depuracionUsb = Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.ADB_ENABLED, 0) == 1;
        } catch (Exception ignored) {
        }
        out.put("tieneNfc", tieneNfc);
        out.put("nfcActivado", nfcActivado);
        out.put("androidSdk", Build.VERSION.SDK_INT);
        out.put("opcionesDesarrollador", opcionesDesarrollador);
        out.put("depuracionUsb", depuracionUsb);
        out.put("fabricante", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        out.put("modelo", Build.MODEL == null ? "" : Build.MODEL);
        call.resolve(out);
    }

    /** Abre los ajustes de NFC; si el móvil no tiene esa pantalla, los de conexiones; si no, Ajustes. */
    @PluginMethod
    public void openNfcSettings(PluginCall call) {
        Context ctx = getContext();
        String[] acciones = {
                Settings.ACTION_NFC_SETTINGS,
                Settings.ACTION_WIRELESS_SETTINGS,
                Settings.ACTION_SETTINGS,
        };
        for (String accion : acciones) {
            try {
                Intent intent = new Intent(accion);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                break;
            } catch (Exception ignored) {
                // esa pantalla no existe en este móvil: probar la siguiente
            }
        }
        call.resolve();
    }
}

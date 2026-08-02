package com.pidoo.socio;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
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
        } catch (Exception e) {
            out.put("error", e.getMessage());
        }
        call.resolve(out);
    }
}

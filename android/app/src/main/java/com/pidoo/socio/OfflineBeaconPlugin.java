package com.pidoo.socio;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * OfflineBeacon (plugin Capacitor local).
 *
 * Puente entre la capa JS (RiderContext) y el OfflineBeaconService nativo.
 *  - arm({token, functionsUrl, anonKey}): guarda el token y arranca el servicio que
 *    detectará el cierre de la app -> offline instantáneo. Se llama al ponerse EN SERVICIO.
 *  - updateToken({token}): refresca el token guardado (la sesión Supabase rota cada ~1h).
 *  - disarm(): borra el token y para el servicio. Se llama al ponerse offline / logout.
 *  - requestBatteryExemption(): abre los ajustes de optimización de batería para que el SO
 *    no mate el proceso en segundo plano (variante SETTINGS, no el prompt directo, para no
 *    complicar la revisión de Play).
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
}

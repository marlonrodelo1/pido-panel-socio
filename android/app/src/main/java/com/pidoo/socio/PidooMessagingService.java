package com.pidoo.socio;

import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * PidooMessagingService — 23-jul-2026. SONIDO EN BUCLE del pedido con la app minimizada.
 *
 * Extiende el MessagingService de Capacitor (que solo reenvia el push al JS cuando la app
 * esta en PRIMER PLANO; con la app en segundo plano un mensaje "data-only" NO muestra ni
 * suena nada). Aqui interceptamos el push de asignacion de pedido (data.loop_sound == "1")
 * y, si la app esta en SEGUNDO PLANO, arrancamos PedidoAlarmService, que reproduce el mismo
 * sonido EN BUCLE (USAGE_ALARM) hasta que el rider acepta (abre la app) o pasan 150 s.
 *
 * Por que funciona de forma fiable aqui: mientras el socio esta "en servicio" hay un
 * foreground service de ubicacion (background-geolocation) manteniendo el proceso VIVO, asi
 * que onMessageReceived se ejecuta aunque la app este minimizada o la pantalla apagada, y
 * el push de alta prioridad da permiso temporal para arrancar un foreground service.
 *
 * En PRIMER PLANO NO arrancamos la alarma: el ModalPedidoEntrante ya reproduce el audio HTML
 * en bucle. super.onMessageReceived() se llama SIEMPRE (reenvia al JS en primer plano y es
 * un no-op inofensivo en segundo plano) para no cambiar nada del flujo existente.
 *
 * Registrado en AndroidManifest con el intent-filter MESSAGING_EVENT; el service del plugin
 * de Capacitor se elimina alli con tools:node="remove" para que FCM entregue solo a este.
 */
public class PidooMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        try {
            Map<String, String> data = remoteMessage.getData();
            boolean esLoop = data != null && "1".equals(data.get("loop_sound"));
            boolean enPrimerPlano = MainActivity.appEnPrimerPlano;
            if (esLoop && !enPrimerPlano) {
                Intent i = new Intent(getApplicationContext(), PedidoAlarmService.class);
                i.setAction(PedidoAlarmService.ACTION_START);
                i.putExtra("codigo", data.get("codigo"));
                // _title/_body los inyecta enviar_push en el data del mensaje loop.
                i.putExtra("titulo", data.get("_title"));
                i.putExtra("cuerpo", data.get("_body"));
                i.putExtra("pedido_id", data.get("pedido_id"));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getApplicationContext().startForegroundService(i);
                } else {
                    getApplicationContext().startService(i);
                }
            }
        } catch (Exception e) {
            // best-effort: si falla el arranque de la alarma, el push sigue su curso normal.
        }
        // Preserva el comportamiento de Capacitor (reenvio a JS en primer plano + token).
        super.onMessageReceived(remoteMessage);
    }
}

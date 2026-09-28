import UIKit
import Capacitor
import CoreLocation
import UserNotifications
import FirebaseCore
import FirebaseMessaging

// ─────────────────────────────────────────────────────────────────────────────
// PRESENCIA DEL SOCIO EN iOS (14 ago 2026)
//
// El problema: el socio se queda "sin señal" y el servidor lo apaga. Traza real de
// Marlon: En línea a las 14:12, señal viva 11 horas, última señal 01:09 de madrugada
// (móvil quieto, app minimizada) y silencio hasta que la abrió por la mañana. Desde el
// minuto 12 sin señal el dispatcher ya no le ofrece pedidos; a los 60 min el cron lo
// pone Fuera de línea.
//
// Por qué pasa: en iOS el latido lo manda el JavaScript, y cuando el sistema mata la app
// por memoria no queda nadie mandándolo. En Android eso no ocurre porque hay un servicio
// nativo (PresenceBeatService.java) que late en Java.
//
// QUÉ SE DESCARTÓ, y por qué (revisión adversarial del 14 ago):
//  - `startMonitoringSignificantLocationChanges` NO sirve: solo dispara al moverse ~500 m.
//    El caso real es el móvil QUIETO toda la noche → cero eventos, cero resurrecciones.
//  - Un CLLocationManager permanente con precisión máxima se come entre un cuarto y la
//    mitad de la batería en 8 h, deja la flecha de ubicación encendida con la app
//    minimizada y es justo lo que Apple castiga con la guideline 2.5.4 (a esta app YA la
//    rechazaron por eso el 7 jul).
//  - (Texto del 14 ago, CORREGIDO el 28 sep — ver "CIERRE DEL TODO" más abajo.) Se pensó
//    que `applicationWillTerminate` no servía para nada. No es así: iOS lo llama cuando el
//    socio desliza la app fuera del selector SI la app estaba corriendo (primer plano, o
//    en segundo plano con la ubicación "Permitir siempre" activa). Si estaba SUSPENDIDA,
//    no llega nada: ese hueco lo cubre, apagado por defecto, el respaldo del servidor.
//
// QUÉ SE HACE EN SU LUGAR: el servidor manda un AVISO SILENCIOSO (content-available) al
// socio que lleva rato callado. Eso despierta la app aunque iOS la haya matado, pero NO
// si el usuario la cerró a mano — que es exactamente la regla que se quería. Al despertar
// se pide UNA sola posición y se late. Sin GPS encendido de forma continua.
//
// La llave de presencia (socio_presence_tokens) no caduca con la sesión: por eso el
// latido nativo sobrevive a la rotación del JWT, que fue la causa del "me desconecto a
// las 2 horas" del 1 ago.
//
// ⚠ 28 sep 2026 — NADA DE ESTO FUNCIONABA EN PRODUCCIÓN: el plugin OfflineBeacon NUNCA se
// registró en el puente de Capacitor (no está en packageClassList, que `cap sync` regenera,
// y el storyboard usaba CAPBridgeViewController tal cual). El JS de Capacitor pide la
// cabecera del plugin al hacer registerPlugin('OfflineBeacon'); sin cabecera, cada llamada
// fallaba con "not implemented on ios" y el JS se lo tragaba con catch(_). Prueba en BD: la
// llave de presencia de deltafood con last_used_at NULL. El fallback por NSClassFromString
// de handleJSCall nunca se alcanza. Arreglo: PidooBridgeViewController (al final de este
// fichero) registra el plugin en capacitorDidLoad, y Main.storyboard apunta a esa clase.
//
// CIERRE DEL TODO (28 sep 2026) — regla de Marlon: si el socio cierra la app del todo queda
// Fuera de línea y se le avisa. En applicationWillTerminate, si estaba En línea (armado):
//   1) marca 'cerrada_por_usuario_at' en UserDefaults (el JS la lee al reabrir y NO reanuda
//      el turno: tiene que pulsar En línea),
//   2) rider-offline con la llave y motivo 'cierre_app_ios', con ~2,5 s de margen,
//   3) notificación local con lo que ha pasado DE VERDAD (revisión del 28 sep: antes se
//      programaba antes del POST y decía "estás Fuera de línea" aunque fallara, y con las redes
//      de seguridad del servidor apagadas el socio seguía En línea recibiendo pedidos):
//        - el servidor lo confirma → "Has cerrado Pidoo Socio por completo: estás Fuera de
//          línea..." (variante si tenía un pedido aceptado sin entregar);
//        - sin red / sin respuesta a tiempo / error → "No hemos podido desconectarte... abre la
//          app". En iOS no hay forma de reintentar después (la app ya no existe y el ping
//          silencioso no despierta a una app cerrada a mano): la marca se queda y, al reabrir,
//          el JS completa el apagado.
// Límites honestos: solo llega si la app estaba CORRIENDO al cerrarla (sin "Permitir
// siempre" iOS la suspende y no avisa); y iOS también lo llama en algún cierre del sistema
// con la app corriendo (p. ej. al instalarse una actualización), que se toma como cierre.
// ─────────────────────────────────────────────────────────────────────────────

private let kAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtcmJ4cmFibmdkbXBncGZtamJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzAyNTksImV4cCI6MjA4OTYwNjI1OX0.Aj2VoA6XWcokJDJdhBwfNXnLCUEOlQfTdB0std1SNWE"

final class PidooPresence: NSObject, CLLocationManagerDelegate {

    static let shared = PidooPresence()

    // Mismos nombres que las SharedPreferences de Android, para que los dos lados se lean igual.
    private enum K {
        static let armed = "presence_armed"
        static let token = "presence_token"
        static let functionsUrl = "presence_functions_url"
        static let anonKey = "presence_anon_key"
        static let dead = "presence_dead_count"
        static let unauthorized = "presence_401_count"
        // 28 sep: cierre del todo (mismos nombres que en Android).
        static let cerradaAt = "cerrada_por_usuario_at"
        static let cerradaConPedido = "cerrada_con_pedido"
        static let pedidoEnCurso = "pedido_en_curso"
    }

    // Textos del aviso de cierre (iguales que en Android, PresenceBeatService).
    private let tituloCierre = "Estás Fuera de línea"
    private let textoCierre = "Has cerrado Pidoo Socio por completo: estás Fuera de línea y no vas a recibir pedidos. Abre la app y pulsa En línea para volver."
    private let textoCierreConPedido = "Has cerrado Pidoo Socio por completo: estás Fuera de línea y no vas a recibir pedidos nuevos. Tienes un pedido pendiente de entregar: abre la app para seguir con el reparto."

    // Cortacircuitos: los mismos que el servicio de Android (MAX_DEAD=5, MAX_401=3). Sin
    // esto, un iPhone olvidado seguiría latiendo para siempre con el socio fuera de turno.
    private let maxDead = 5
    private let maxUnauthorized = 3

    private let tituloFallo = "No hemos podido desconectarte"
    private let textoFallo = "Has cerrado Pidoo Socio, pero no hemos podido ponerte Fuera de línea y te pueden seguir llegando pedidos. Abre la app para desconectarte."
    private let coletillaPedido = " Tienes un pedido pendiente de entregar."
    private let idAvisoCierre = "pidoo_cierre_app"

    // Propiedad ALMACENADA y de larga vida: si el manager fuera local, ARC lo liberaría y
    // no llegaría ni un callback (fallo silencioso, sin error de compilación).
    //
    // Y se crea SOLO en el hilo principal (revisión del 28 sep): CoreLocation entrega los
    // callbacks del delegado en el run loop del hilo que creó el manager. Desde que el plugin
    // está registrado, el primer acceso a `shared` en una apertura normal llega desde un método
    // del plugin (marcarPedidoEnCurso al montar la app, consumeClosedFlag...), y Capacitor los
    // ejecuta en su cola "bridge", un hilo de GCD sin run loop: didUpdateLocations no llegaba
    // nunca y cada latido salía SIN coordenadas tras agotar los 8 s. Por eso AppDelegate llama a
    // prepararEnHiloPrincipal() al arrancar, y todo uso pasa por managerPrincipal(), que solo se
    // llama desde el hilo principal.
    private var _manager: CLLocationManager?

    private var pendingBeats: [(CLLocation?) -> Void] = []
    private var waitingForFix = false

    private override init() {
        super.init()
    }

    /// El CLLocationManager, creado la primera vez. SOLO desde el hilo principal (ver arriba).
    private func managerPrincipal() -> CLLocationManager {
        if let m = _manager { return m }
        let m = CLLocationManager()
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyHundredMeters
        _manager = m
        return m
    }

    /// Crea el CLLocationManager en el hilo principal. Lo llama AppDelegate al arrancar, antes de
    /// que el JS pueda tocar `shared` desde la cola del puente.
    func prepararEnHiloPrincipal() {
        if Thread.isMainThread {
            _ = managerPrincipal()
        } else {
            DispatchQueue.main.async { _ = self.managerPrincipal() }
        }
    }

    private var defaults: UserDefaults { UserDefaults.standard }

    var isArmed: Bool { defaults.bool(forKey: K.armed) }

    /// Permiso de ubicación actual. Desde el hilo principal usa el manager de siempre; desde otro
    /// hilo, una lectura suelta (sin delegado) para no crear ahí el manager bueno.
    var authorizationStatus: CLAuthorizationStatus {
        if Thread.isMainThread { return managerPrincipal().authorizationStatus }
        return CLLocationManager().authorizationStatus
    }

    func arm(token: String, functionsUrl: String, anonKey: String?) {
        defaults.set(true, forKey: K.armed)
        defaults.set(token, forKey: K.token)
        defaults.set(functionsUrl, forKey: K.functionsUrl)
        defaults.set(anonKey ?? kAnonKey, forKey: K.anonKey)
        defaults.set(0, forKey: K.dead)
        defaults.set(0, forKey: K.unauthorized)
        // Volver a estar En línea anula una marca de cierre que no se llegara a leer (si no,
        // el próximo arranque tras un cierre del SISTEMA se tomaría por un cierre del socio), y
        // retira el aviso del cierre anterior de la bandeja.
        defaults.removeObject(forKey: K.cerradaAt)
        defaults.removeObject(forKey: K.cerradaConPedido)
        retirarAvisoCierre()
    }

    /// Quita el aviso de cierre de la bandeja (ya cumplió o ya no describe la realidad).
    func retirarAvisoCierre() {
        let centro = UNUserNotificationCenter.current()
        centro.removeDeliveredNotifications(withIdentifiers: [idAvisoCierre])
        centro.removePendingNotificationRequests(withIdentifiers: [idAvisoCierre])
    }

    /// El JS avisa si hay un pedido aceptado sin entregar: el aviso de cierre lo recuerda.
    func marcarPedidoEnCurso(_ enCurso: Bool) {
        defaults.set(enCurso, forKey: K.pedidoEnCurso)
    }

    /// Lee (y borra, salvo soloLeer) la marca de "cerró la app del todo estando En línea".
    /// El JS la lee al arrancar con soloLeer y solo la borra cuando el Fuera de línea está
    /// confirmado en el servidor (si no, el siguiente arranque reanudaría el turno solo).
    func consumirCierre(soloLeer: Bool) -> [String: Any] {
        let at = defaults.double(forKey: K.cerradaAt)
        let cerrada = at > 0
        var out: [String: Any] = [
            "cerrada": cerrada,
            "conPedido": cerrada && defaults.bool(forKey: K.cerradaConPedido)
        ]
        if cerrada { out["at"] = at }
        if !soloLeer {
            if cerrada {
                defaults.removeObject(forKey: K.cerradaAt)
                defaults.removeObject(forKey: K.cerradaConPedido)
            }
            retirarAvisoCierre()
        }
        return out
    }

    /// Resultado del rider-offline del cierre. La respuesta llega en una cola de fondo y se lee
    /// en el hilo principal (quizá tras agotar la espera): va protegido con un candado.
    private final class ResultadoCierre {
        private let candado = NSLock()
        private var _ok = false
        private var _enCurso: Int?
        func fijar(ok: Bool, enCurso: Int?) {
            candado.lock(); _ok = ok; _enCurso = enCurso; candado.unlock()
        }
        func leer() -> (Bool, Int?) {
            candado.lock(); defer { candado.unlock() }
            return (_ok, _enCurso)
        }
    }

    /// applicationWillTerminate: el socio cerró la app del todo. Ver "CIERRE DEL TODO" arriba.
    /// Solo si estaba En línea. iOS da unos 5 s: se espera como mucho 2,5 s al servidor y 0,8 s a
    /// que el sistema acepte el aviso.
    func registrarCierreDelUsuario() {
        guard isArmed else { return }
        var conPedido = defaults.bool(forKey: K.pedidoEnCurso)
        // La llave se lee ANTES de desarmar (disarm la borra).
        let token = defaults.string(forKey: K.token)
        let base = defaults.string(forKey: K.functionsUrl)
        let key = defaults.string(forKey: K.anonKey) ?? kAnonKey

        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: K.cerradaAt)
        defaults.set(conPedido, forKey: K.cerradaConPedido)
        // Desarmado: el ping silencioso ya no debe resucitar a quien cerró la app.
        disarm()
        defaults.synchronize() // el proceso muere enseguida: escribir ya

        var tarea: UIBackgroundTaskIdentifier = .invalid
        tarea = UIApplication.shared.beginBackgroundTask(withName: "pidoo-cierre-app") {
            if tarea != .invalid {
                UIApplication.shared.endBackgroundTask(tarea)
                tarea = .invalid
            }
        }

        // 1) Fuera de línea en el servidor, con la llave (no depende de la sesión) y el motivo.
        //    Las respuestas llegan en colas de fondo: esperar aquí en el hilo principal no bloquea.
        let resultado = ResultadoCierre()
        if let token = token, let base = base, let url = URL(string: base + "/rider-offline") {
            let espera = DispatchSemaphore(value: 0)
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 2.5
            req.addValue("application/json", forHTTPHeaderField: "Content-Type")
            req.addValue(key, forHTTPHeaderField: "apikey")
            req.addValue(token, forHTTPHeaderField: "x-presence-token")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["motivo": "cierre_app_ios"])
            URLSession.shared.dataTask(with: req) { data, resp, error in
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let bien = error == nil && (200..<300).contains(status)
                var enCursoServidor: Int?
                if bien, let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let n = json["pedidos_en_curso"] as? Int {
                    enCursoServidor = n
                }
                resultado.fijar(ok: bien, enCurso: enCursoServidor)
                espera.signal()
            }.resume()
            _ = espera.wait(timeout: .now() + 2.5)
        }
        let (ok, enCurso) = resultado.leer()
        if ok, let n = enCurso {
            // El servidor sabe mejor si hay un pedido aceptado sin entregar.
            conPedido = n > 0
            defaults.set(conPedido, forKey: K.cerradaConPedido)
        }

        // 2) Aviso local con lo que ha pasado de verdad. Disparo a 1 s: lo entrega el sistema
        //    aunque la app ya no exista. Se retira antes el de un cierre anterior.
        retirarAvisoCierre()
        let contenido = UNMutableNotificationContent()
        if ok {
            contenido.title = tituloCierre
            contenido.body = conPedido ? textoCierreConPedido : textoCierre
        } else {
            contenido.title = tituloFallo
            contenido.body = textoFallo + (conPedido ? coletillaPedido : "")
        }
        contenido.sound = .default   // sonido normal, nunca el del pedido
        let disparo = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let peticion = UNNotificationRequest(identifier: idAvisoCierre, content: contenido, trigger: disparo)
        let esperaAviso = DispatchSemaphore(value: 0)
        UNUserNotificationCenter.current().add(peticion) { _ in esperaAviso.signal() }
        _ = esperaAviso.wait(timeout: .now() + 0.8)

        if tarea != .invalid {
            UIApplication.shared.endBackgroundTask(tarea)
            tarea = .invalid
        }
    }

    /// Versión de la app para la telemetría (socios.app_version), p. ej. "2.9.5 (46)".
    private var versionApp: String? {
        let info = Bundle.main.infoDictionary
        guard let v = info?["CFBundleShortVersionString"] as? String else { return nil }
        let b = (info?["CFBundleVersion"] as? String) ?? "?"
        return "\(v) (\(b))"
    }

    func disarm() {
        defaults.set(false, forKey: K.armed)
        defaults.removeObject(forKey: K.token)
        defaults.set(0, forKey: K.dead)
        defaults.set(0, forKey: K.unauthorized)
    }

    /// Late una vez. Pide UNA posición (no deja el GPS encendido) y postea. Si no hay
    /// permiso o el fix tarda, late igual sin coordenadas: mejor "vivo sin posición nueva"
    /// que "muerto", porque sin latido el socio desaparece del reparto.
    func beatNow(completion: @escaping (Bool) -> Void) {
        guard isArmed else { completion(false); return }
        requestOneFix { [weak self] location in
            self?.postHeartbeat(location: location, completion: completion)
        }
    }

    private func requestOneFix(_ done: @escaping (CLLocation?) -> Void) {
        // Todo el trato con CLLocationManager va en el hilo principal, igual que hace el
        // plugin de background-geolocation que ya usa la app.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { done(nil); return }
            let manager = self.managerPrincipal()
            let status = manager.authorizationStatus
            guard status == .authorizedAlways || status == .authorizedWhenInUse else {
                done(nil); return
            }
            self.pendingBeats.append(done)
            if self.waitingForFix { return }
            self.waitingForFix = true
            manager.requestLocation()
            // Red de seguridad: si el fix no llega, no dejamos el latido colgado.
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                self?.flushPending(with: nil)
            }
        }
    }

    private func flushPending(with location: CLLocation?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.waitingForFix else { return }
            self.waitingForFix = false
            let callbacks = self.pendingBeats
            self.pendingBeats = []
            callbacks.forEach { $0(location) }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        flushPending(with: locations.last)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        flushPending(with: nil)
    }

    private func postHeartbeat(location: CLLocation?, completion: @escaping (Bool) -> Void) {
        guard
            let base = defaults.string(forKey: K.functionsUrl),
            let token = defaults.string(forKey: K.token),
            let url = URL(string: base + "/rider-heartbeat")
        else { completion(false); return }

        let key = defaults.string(forKey: K.anonKey) ?? kAnonKey
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.addValue("application/json", forHTTPHeaderField: "Content-Type")
        req.addValue(key, forHTTPHeaderField: "apikey")
        req.addValue(token, forHTTPHeaderField: "x-presence-token")

        var body: [String: Any] = ["origen": "ios_silent_push", "app_plataforma": "ios"]
        if let v = versionApp { body["app_version"] = v }
        if let loc = location {
            body["latitud"] = loc.coordinate.latitude
            body["longitud"] = loc.coordinate.longitude
            body["accuracy"] = loc.horizontalAccuracy
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: req) { [weak self] data, resp, _ in
            guard let self = self else { completion(false); return }
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0

            // 401 = la llave fue rotada (otro dispositivo se puso En línea). Tres seguidos
            // y se apaga: este iPhone ya no manda.
            if status == 401 {
                let n = self.defaults.integer(forKey: K.unauthorized) + 1
                self.defaults.set(n, forKey: K.unauthorized)
                if n >= self.maxUnauthorized { self.disarm() }
                completion(false); return
            }
            if status == 200 { self.defaults.set(0, forKey: K.unauthorized) }

            // alive:false = el servidor dice que el socio ya NO está en servicio (lo apagó
            // él desde otro sitio, el cron o el superadmin). Cinco seguidos y paramos.
            var alive = true
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let a = json["alive"] as? Bool {
                alive = a
            }
            if alive {
                self.defaults.set(0, forKey: K.dead)
            } else {
                let n = self.defaults.integer(forKey: K.dead) + 1
                self.defaults.set(n, forKey: K.dead)
                if n >= self.maxDead { self.disarm() }
            }
            completion(status == 200 && alive)
        }.resume()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Capacitor declarado DENTRO del target de la app.
//
// ⚠ CORREGIDO el 28 sep: el texto de agosto decía que no hacía falta registrarlo porque
// handleJSCall lo resolvía con NSClassFromString. FALSO: el JS de Capacitor necesita la
// CABECERA del plugin (se exporta al registrarlo en el puente) para crear el proxy; sin ella
// cada llamada falla antes de llegar a handleJSCall. Lo registra PidooBridgeViewController
// (al final del fichero), a la que apunta Main.storyboard. Así no hay que tocar el
// project.pbxproj (todo sigue en este mismo fichero, ya incluido en el target).
//
// Los métodos coinciden con los que llama src/lib/offlineBeacon.js. Los exclusivos de
// Android se resuelven sin hacer nada para no dejar promesas colgadas.
// ─────────────────────────────────────────────────────────────────────────────
@objc(OfflineBeacon)
public class OfflineBeaconPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "OfflineBeacon"
    public let jsName = "OfflineBeacon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "arm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBatteryExemption", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "armPresence", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disarmPresence", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPrereqs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAutostartSettings", returnType: CAPPluginReturnPromise),
        // 28 sep 2026
        CAPPluginMethod(name: "consumeClosedFlag", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "marcarPedidoEnCurso", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tapToPayChecks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNfcSettings", returnType: CAPPluginReturnPromise)
    ]

    // arm/updateToken/disarm son el beacon de cierre de app, que en iOS no tiene evento
    // fiable (ver cabecera). Se resuelven sin hacer nada para no dejar promesas colgadas.
    @objc func arm(_ call: CAPPluginCall) { call.resolve() }
    @objc func updateToken(_ call: CAPPluginCall) { call.resolve() }
    @objc func disarm(_ call: CAPPluginCall) { call.resolve() }

    // Exclusivo de Android (exencion de bateria). En iOS no existe.
    @objc func requestBatteryExemption(_ call: CAPPluginCall) { call.resolve() }

    @objc func armPresence(_ call: CAPPluginCall) {
        guard
            let token = call.getString("presenceToken"),
            let functionsUrl = call.getString("functionsUrl")
        else {
            call.reject("Faltan presenceToken o functionsUrl")
            return
        }
        PidooPresence.shared.arm(token: token, functionsUrl: functionsUrl, anonKey: call.getString("anonKey"))
        call.resolve()
    }

    @objc func disarmPresence(_ call: CAPPluginCall) {
        PidooPresence.shared.disarm()
        call.resolve()
    }

    // Mismas claves que Android (fineLocation / bgLocation / batteryExempt / autostartSospechoso),
    // que son las que lee RiderContext. Batería y autostart no existen en iOS: van a "todo bien"
    // para que la app no pida algo imposible. Se mantienen las claves viejas de iOS
    // (ubicacionSiempre / bateria) por si algo las leyera.
    // Sin "Permitir siempre" iOS suspende la app en segundo plano: ni latido ni aviso de cierre.
    @objc func checkPrereqs(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status = PidooPresence.shared.authorizationStatus
            let siempre = status == .authorizedAlways
            let alguna = siempre || status == .authorizedWhenInUse
            call.resolve([
                "fineLocation": alguna,
                "bgLocation": siempre,
                "batteryExempt": true,
                "autostartSospechoso": false,
                "ubicacionSiempre": siempre,
                "bateria": true
            ])
        }
    }

    // Exclusivo de Android (Inicio automático de Xiaomi/Huawei...). En iOS no existe.
    @objc func openAutostartSettings(_ call: CAPPluginCall) { call.resolve() }

    // ─── 28 sep 2026: cierre del todo ───

    @objc func consumeClosedFlag(_ call: CAPPluginCall) {
        let soloLeer = call.getBool("soloLeer") ?? false
        call.resolve(PidooPresence.shared.consumirCierre(soloLeer: soloLeer))
    }

    @objc func marcarPedidoEnCurso(_ call: CAPPluginCall) {
        PidooPresence.shared.marcarPedidoEnCurso(call.getBool("enCurso") ?? false)
        call.resolve()
    }

    // ─── 28 sep 2026: cobro con el móvil ───
    // En iPhone el cobro con el móvil necesita el permiso "Tap to Pay on iPhone" de Apple, que
    // todavía no está: se dice que no está disponible para que la app no enseñe el botón.
    @objc func tapToPayChecks(_ call: CAPPluginCall) {
        call.resolve(["plataforma": "ios", "disponible": false])
    }

    // iOS no tiene ajustes de NFC para el usuario.
    @objc func openNfcSettings(_ call: CAPPluginCall) { call.resolve() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro del plugin en el puente (28 sep 2026). Main.storyboard apunta a esta clase
// (customClass PidooBridgeViewController, customModule App). Va en este fichero a propósito:
// un .swift nuevo habría que darlo de alta en el project.pbxproj a mano (4 secciones con ids
// únicos), y un error ahí rompe la build en la Mac.
// capacitorDidLoad corre antes de cargar la web, así que la cabecera del plugin ya está
// cuando el JS hace registerPlugin('OfflineBeacon').
// ─────────────────────────────────────────────────────────────────────────────
class PidooBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(OfflineBeaconPlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 28 sep 2026: el CLLocationManager del latido nativo tiene que nacer en el hilo
        // principal (ver PidooPresence). Esto corre antes de que cargue la web.
        PidooPresence.shared.prepararEnHiloPrincipal()
        if FirebaseApp.app() == nil {
            // Lee ios/App/App/GoogleService-Info.plist del bundle (NO en git).
            FirebaseApp.configure()
            sendDebugLog(event: "ios_firebase_configured")
        }
        Messaging.messaging().delegate = self
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    // 28 sep 2026: cerrar la app del todo estando En línea = Fuera de línea + aviso + marca
    // para no reanudar al reabrir. Ver "CIERRE DEL TODO" en la cabecera.
    func applicationWillTerminate(_ application: UIApplication) {
        PidooPresence.shared.registrarCierreDelUsuario()
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        sendDebugLog(event: "ios_apns_token_received")
        NotificationCenter.default.post(name: Notification.Name("capacitorDidRegisterForRemoteNotifications"), object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        sendDebugLog(event: "ios_apns_register_failed", extra: error.localizedDescription)
        NotificationCenter.default.post(name: Notification.Name("capacitorDidFailToRegisterForRemoteNotifications"), object: error)
    }

    /// AVISO SILENCIOSO. Es la pieza que resucita al socio: iOS entrega este mensaje aunque
    /// haya matado la app por memoria (y NO si el usuario la cerró a mano, que es justo la
    /// regla que se busca). Hay ~30 s de ejecución: se pide una posición y se late.
    ///
    /// Cualquier otro push sigue su curso normal: se avisa a Firebase y se responde .noData.
    /// El completionHandler se llama SIEMPRE — si no, iOS deja de entregar avisos a esta app.
    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Messaging.messaging().appDidReceiveMessage(userInfo)

        let tipo = (userInfo["tipo"] as? String) ?? ""
        guard tipo == "presence_ping" else {
            completionHandler(.noData)
            return
        }

        sendDebugLog(event: "ios_presence_ping")
        var respondido = false
        let responder: (UIBackgroundFetchResult) -> Void = { resultado in
            guard !respondido else { return }
            respondido = true
            completionHandler(resultado)
        }
        // Tope propio: iOS corta a los ~30 s y castiga a quien no responde a tiempo.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { responder(.noData) }

        PidooPresence.shared.beatNow { ok in
            responder(ok ? .newData : .noData)
        }
    }

    public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken, !token.isEmpty else {
            sendDebugLog(event: "ios_fcm_token_empty")
            return
        }
        sendDebugLog(event: "ios_fcm_token_received", extra: String(token.prefix(24)))
        saveFcmTokenToSupabase(fcmToken: token)
    }

    private func saveFcmTokenToSupabase(fcmToken: String) {
        guard let url = URL(string: "https://rmrbxrabngdmpgpfmjbo.supabase.co/rest/v1/push_subscriptions") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.addValue("application/json", forHTTPHeaderField: "Content-Type")
        req.addValue(anonKey, forHTTPHeaderField: "apikey")
        req.addValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = [
            "endpoint": "fcm:\(fcmToken)",
            "p256dh": "",
            "auth": "",
            "fcm_token": fcmToken,
            "user_type": "socio"
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { _, resp, err in
            if let err = err {
                self.sendDebugLog(event: "ios_fcm_save_error", extra: err.localizedDescription)
            } else if let http = resp as? HTTPURLResponse {
                self.sendDebugLog(event: "ios_fcm_saved", extra: "status=\(http.statusCode)")
            }
        }.resume()
    }

    private let anonKey = kAnonKey

    private func sendDebugLog(event: String, extra: String? = nil) {
        guard let url = URL(string: "https://rmrbxrabngdmpgpfmjbo.supabase.co/rest/v1/push_debug_logs") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.addValue("application/json", forHTTPHeaderField: "Content-Type")
        req.addValue(anonKey, forHTTPHeaderField: "apikey")
        req.addValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        var body: [String: Any] = ["platform": "ios", "event": event]
        if let extra = extra { body["details"] = extra }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }
}

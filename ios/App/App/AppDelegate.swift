import UIKit
import Capacitor
import CoreLocation
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
//  - `applicationWillTerminate` NO se llama al deslizar la app fuera del selector, y
//    cuando sí se llama es porque la mató el SISTEMA — indistinguible de un cierre a
//    mano. Usarlo para mandar el offline haría lo contrario de lo que se busca.
//    CONSECUENCIA HONESTA: "cerrar la app del todo = Fuera de línea" NO se puede
//    garantizar desde el cliente en iOS. Lo cubre la red de seguridad del servidor.
//
// QUÉ SE HACE EN SU LUGAR: el servidor manda un AVISO SILENCIOSO (content-available) al
// socio que lleva rato callado. Eso despierta la app aunque iOS la haya matado, pero NO
// si el usuario la cerró a mano — que es exactamente la regla que se quería. Al despertar
// se pide UNA sola posición y se late. Sin GPS encendido de forma continua.
//
// La llave de presencia (socio_presence_tokens) no caduca con la sesión: por eso el
// latido nativo sobrevive a la rotación del JWT, que fue la causa del "me desconecto a
// las 2 horas" del 1 ago.
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
    }

    // Cortacircuitos: los mismos que el servicio de Android (MAX_DEAD=5, MAX_401=3). Sin
    // esto, un iPhone olvidado seguiría latiendo para siempre con el socio fuera de turno.
    private let maxDead = 5
    private let maxUnauthorized = 3

    // Propiedad ALMACENADA y de larga vida: si el manager fuera local, ARC lo liberaría y
    // no llegaría ni un callback (fallo silencioso, sin error de compilación).
    private let manager = CLLocationManager()

    private var pendingBeats: [(CLLocation?) -> Void] = []
    private var waitingForFix = false

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    private var defaults: UserDefaults { UserDefaults.standard }

    var isArmed: Bool { defaults.bool(forKey: K.armed) }

    /// Permiso de ubicación actual. Solo se lee desde el hilo principal.
    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

    func arm(token: String, functionsUrl: String, anonKey: String?) {
        defaults.set(true, forKey: K.armed)
        defaults.set(token, forKey: K.token)
        defaults.set(functionsUrl, forKey: K.functionsUrl)
        defaults.set(anonKey ?? kAnonKey, forKey: K.anonKey)
        defaults.set(0, forKey: K.dead)
        defaults.set(0, forKey: K.unauthorized)
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
            let status = self.manager.authorizationStatus
            guard status == .authorizedAlways || status == .authorizedWhenInUse else {
                done(nil); return
            }
            self.pendingBeats.append(done)
            if self.waitingForFix { return }
            self.waitingForFix = true
            self.manager.requestLocation()
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

        var body: [String: Any] = ["origen": "ios_silent_push"]
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
// No hace falta tocar el project.pbxproj ni el storyboard: CapacitorBridge.handleJSCall
// resuelve el plugin con NSClassFromString(call.pluginId) y lo carga en caliente
// (CapacitorBridge.swift:473 y loadPlugin:378), asi que basta con que el nombre expuesto a
// Objective-C sea EXACTAMENTE el que usa el JS en registerPlugin('OfflineBeacon').
//
// Los metodos son los mismos que ya llama src/lib/offlineBeacon.js en produccion, asi que
// el JavaScript no cambia: hoy en iOS esas llamadas fallan y se tragan con catch(_) {}.
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
        CAPPluginMethod(name: "checkPrereqs", returnType: CAPPluginReturnPromise)
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

    // El equivalente de Android informa de permiso "siempre" + exencion de bateria. Aqui
    // solo hay permiso de ubicacion; `bateria` va a true para que la UI no pida algo que
    // en iOS no se puede conceder.
    @objc func checkPrereqs(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status = PidooPresence.shared.authorizationStatus
            call.resolve([
                "ubicacionSiempre": status == .authorizedAlways,
                "bateria": true
            ])
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
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
    func applicationWillTerminate(_ application: UIApplication) {}

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

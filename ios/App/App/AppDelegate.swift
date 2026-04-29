import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
            sendDebugLog(event: "ios_firebase_configured")
        }

        Messaging.messaging().delegate = self

        // UNUserNotificationCenter delegate (CRITICO: necesario para foreground delivery
        // y para que swizzling=NO funcione correctamente con FCM).
        UNUserNotificationCenter.current().delegate = self

        // Pedir permiso explicitamente y registrarse para APNs. No dependemos solo del
        // plugin Capacitor PushNotifications — registramos directamente para asegurar
        // que se dispare didRegisterForRemoteNotificationsWithDeviceToken aunque el
        // plugin tarde en arrancar.
        let authOptions: UNAuthorizationOptions = [.alert, .badge, .sound]
        UNUserNotificationCenter.current().requestAuthorization(options: authOptions) { [weak self] granted, error in
            self?.sendDebugLog(event: "ios_auth_request", extra: "granted=\(granted) err=\(error?.localizedDescription ?? "nil")")
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                    self?.sendDebugLog(event: "ios_register_for_remote_called")
                }
            }
        }

        return true
    }

    // Foreground delivery: muestra el banner aunque la app este abierta
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        sendDebugLog(event: "ios_notif_will_present", extra: notification.request.content.title)
        completionHandler([.banner, .badge, .sound, .list])
    }

    // Tap en notificacion (background o cerrada)
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        sendDebugLog(event: "ios_notif_tapped", extra: response.notification.request.content.title)
        completionHandler()
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

    public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken, !token.isEmpty else {
            sendDebugLog(event: "ios_fcm_token_empty")
            return
        }
        sendDebugLog(event: "ios_fcm_token_received", extra: String(token.prefix(24)))
        saveFcmTokenToSupabase(fcmToken: token)
    }

    private func saveFcmTokenToSupabase(fcmToken: String) {
        // Plain INSERT (sin on_conflict). Si ya existe la fila devuelve 409 (unique
        // violation) — no es un error real, solo significa que el token ya esta
        // guardado. Evitamos on_conflict porque requiere UPDATE policy.
        // NOTA: la tabla push_subscriptions NO tiene columna 'plataforma'.
        // Solo: id, user_id, user_type, establecimiento_id, endpoint, p256dh, auth, created_at, fcm_token.
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

    private let anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtcmJ4cmFibmdkbXBncGZtamJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzAyNTksImV4cCI6MjA4OTYwNjI1OX0.Aj2VoA6XWcokJDJdhBwfNXnLCUEOlQfTdB0std1SNWE"

    private func sendDebugLog(event: String, extra: String? = nil) {
        guard let url = URL(string: "https://rmrbxrabngdmpgpfmjbo.supabase.co/rest/v1/push_debug_logs") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.addValue("application/json", forHTTPHeaderField: "Content-Type")
        req.addValue(anonKey, forHTTPHeaderField: "apikey")
        req.addValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        // Usamos platform="ios" + prefijo "socio:" en event (mismo patron que pushNative.js)
        // para que claim_orphan_push_tokens y los filtros JS encuentren consistencia.
        var body: [String: Any] = ["platform": "ios", "event": "socio:\(event)"]
        if let extra = extra { body["details"] = extra }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }
}

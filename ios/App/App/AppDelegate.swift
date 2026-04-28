import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if FirebaseApp.app() == nil {
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
            "user_type": "socio",
            "plataforma": "ios_socio"
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
        var body: [String: Any] = ["platform": "ios_socio", "event": event]
        if let extra = extra { body["details"] = extra }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }
}

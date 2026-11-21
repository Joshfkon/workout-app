import Foundation
import Capacitor
import WatchConnectivity

/// Native half of the Apple Watch bridge (JS: `lib/watch/watchBridge.ts`).
///
/// The phone is the source of truth. The web app pushes a JSON snapshot of the
/// active set with `sendState`; it goes to the watch as the WatchConnectivity
/// application context (latest-wins, delivered even if the watch app launches
/// later) and, when the watch app is open, as an immediate message too.
///
/// Commands from the watch (log set, next/previous, finish, request state)
/// arrive as JSON and are forwarded to JS as `watchMessage` events. They are
/// retained until a listener exists, so a set logged on the wrist while the
/// phone app was closed is delivered once the workout page is ready. JS
/// validates and de-duplicates every message (`lib/watch/protocol.ts`).
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sendState", returnType: CAPPluginReturnPromise),
    ]

    static let stateKey = "state"
    static let commandKey = "command"
    static let messageEvent = "watchMessage"

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    override public func load() {
        guard let session else { return }
        session.delegate = self
        session.activate()
    }

    @objc func sendState(_ call: CAPPluginCall) {
        guard let state = call.getObject("state") else {
            call.reject("state is required")
            return
        }
        guard let session, session.activationState == .activated,
              session.isPaired, session.isWatchAppInstalled else {
            // No watch, or the HyperTrack watch app isn't installed: nothing to do.
            call.resolve()
            return
        }
        do {
            // JSON bytes, not the dictionary: JS nulls become NSNull, which
            // isn't a property-list type and would make WatchConnectivity throw.
            let data = try JSONSerialization.data(withJSONObject: state)
            try session.updateApplicationContext([Self.stateKey: data])
            if session.isReachable {
                session.sendMessage([Self.stateKey: data], replyHandler: nil, errorHandler: nil)
            }
            call.resolve()
        } catch {
            call.reject("Could not send state to the watch: \(error.localizedDescription)")
        }
    }

    // MARK: - Inbound

    private func forward(_ payload: [String: Any]) {
        guard let data = payload[Self.commandKey] as? Data,
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any] else { return }
        let message = JSTypes.coerceDictionaryToJSObject(dict) ?? [:]
        DispatchQueue.main.async {
            self.notifyListeners(Self.messageEvent, data: ["message": message], retainUntilConsumed: true)
        }
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        forward(message)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                        replyHandler: @escaping ([String: Any]) -> Void) {
        forward(message)
        replyHandler(["received": true])
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        forward(userInfo)
    }

    // MARK: - Session lifecycle

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                        error: Error?) {}

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    public func sessionDidDeactivate(_ session: WCSession) {
        // Switching to another paired watch: reactivate for the new one.
        session.activate()
    }
}

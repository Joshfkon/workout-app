import Foundation
import Capacitor
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Local Capacitor plugin behind lib/integrations/liveActivity.ts:
///  - the rest-timer Live Activity (lock screen + Dynamic Island)
///  - home-screen widget data in the App Group container
/// Registered in HyperTrackBridgeViewController.capacitorDidLoad().
@objc(HyperTrackNativePlugin)
public class HyperTrackNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HyperTrackNativePlugin"
    public let jsName = "HyperTrackNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startRestTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateRestTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endRestTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
    ]

    // MARK: Live Activity

    /// JS fires start / update / end without awaiting them, and each one
    /// suspends (ending the previous activity, pushing an update). Run them
    /// strictly in call order, so a ±15s or a pause that arrives while a new
    /// rest is still replacing the old activity applies to the replacement
    /// instead of racing it.
    private let opLock = NSLock()
    private var lastOp: Task<Void, Never>?

    private func enqueue(_ op: @escaping @Sendable () async -> Void) {
        opLock.lock()
        let previous = lastOp
        lastOp = Task {
            await previous?.value
            await op()
        }
        opLock.unlock()
    }

    @objc func startRestTimer(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        guard let state = Self.contentState(from: call) else {
            return call.reject("endTimeMs is required")
        }
        enqueue {
            // One rest at a time: a new set's rest replaces the previous one.
            await Self.endAll()
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return call.resolve() }
            do {
                _ = try Activity<RestTimerAttributes>.request(
                    attributes: RestTimerAttributes(),
                    content: ActivityContent(state: state, staleDate: state.endTime),
                    pushType: nil
                )
                call.resolve()
            } catch {
                call.reject("Could not start Live Activity: \(error.localizedDescription)")
            }
        }
    }

    @objc func updateRestTimer(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        guard let state = Self.contentState(from: call) else {
            return call.reject("endTimeMs is required")
        }
        enqueue {
            for activity in Activity<RestTimerAttributes>.activities {
                await activity.update(ActivityContent(state: state, staleDate: state.endTime))
            }
            call.resolve()
        }
    }

    @objc func endRestTimer(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        enqueue {
            await Self.endAll()
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private static func endAll() async {
        for activity in Activity<RestTimerAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    @available(iOS 16.1, *)
    private static func contentState(from call: CAPPluginCall) -> RestTimerAttributes.ContentState? {
        guard let endMs = call.getDouble("endTimeMs") else { return nil }
        let end = Date(timeIntervalSince1970: endMs / 1000)
        let startMs = call.getDouble("startTimeMs") ?? (Date().timeIntervalSince1970 * 1000)
        let start = min(Date(timeIntervalSince1970: startMs / 1000), end.addingTimeInterval(-1))
        return RestTimerAttributes.ContentState(
            startTime: start,
            endTime: end,
            exerciseName: call.getString("exerciseName") ?? "Rest",
            nextSet: call.getString("nextSet") ?? ""
        )
    }

    // MARK: Widgets

    private static let widgetKeys: [String: String] = [
        "todayWorkout": HyperTrackShared.todayWorkoutKey,
        "nutritionToday": HyperTrackShared.nutritionTodayKey,
    ]

    @objc func setWidgetData(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let storageKey = Self.widgetKeys[key] else {
            return call.reject("Unknown widget key")
        }
        guard let json = call.getString("json") else {
            return call.reject("json is required")
        }
        guard let defaults = HyperTrackShared.defaults else {
            return call.reject("App Group unavailable")
        }
        defaults.set(json, forKey: storageKey)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}

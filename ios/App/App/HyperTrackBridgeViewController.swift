import UIKit
import Capacitor

/// Bridge view controller that registers plugins compiled into the app target
/// itself (Capacitor only auto-registers plugins from packages).
class HyperTrackBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HyperTrackNativePlugin())
        bridge?.registerPluginInstance(WatchBridgePlugin())
        bridge?.registerPluginInstance(HyperTrackPurchasesPlugin())
        #if DEBUG
        runNativeDemoIfRequested()
        #endif
    }

    #if DEBUG
    /// Simulator check for the Live Activity and widgets without a deployed
    /// web build: launch with `-HTNativeDemo` and, once the page has loaded,
    /// this drives HyperTrackNativePlugin through the real JS bridge with
    /// sample data. Debug builds only.
    private func runNativeDemoIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains("-HTNativeDemo") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            let script = """
            (function () {
              var C = window.Capacitor, now = Date.now();
              C.nativePromise('HyperTrackNative', 'setWidgetData', { key: 'todayWorkout',
                json: JSON.stringify({ sessionName: 'Upper A', detail: '6 exercises', path: '/dashboard', updatedAt: now }) });
              C.nativePromise('HyperTrackNative', 'setWidgetData', { key: 'nutritionToday',
                json: JSON.stringify({ caloriesLeft: 812, caloriesTarget: 2600, proteinLeft: 64, proteinTarget: 190,
                  path: '/dashboard/nutrition', updatedAt: now }) });
              return C.nativePromise('HyperTrackNative', 'startRestTimer', { endTimeMs: now + 150000,
                startTimeMs: now - 30000, exerciseName: 'Barbell Bench Press', nextSet: 'Set 3 of 4' });
            })();
            """
            self?.webView?.evaluateJavaScript(script) { _, error in
                if let error { print("[HTNativeDemo] \(error)") }
            }
        }
    }
    #endif
}

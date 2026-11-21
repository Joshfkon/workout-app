import UIKit
import Capacitor

/// The app's Capacitor bridge controller. Plugins that live in the app target
/// itself (not in an npm package) are registered here.
class HyperTrackBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WatchBridgePlugin())
    }
}

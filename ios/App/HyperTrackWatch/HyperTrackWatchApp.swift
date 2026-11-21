import SwiftUI

@main
struct HyperTrackWatchApp: App {
    @StateObject private var store = WorkoutStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.requestState() }
        }
    }
}

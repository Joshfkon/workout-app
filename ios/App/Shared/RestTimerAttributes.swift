import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// App Group shared by the app and the HyperTrackWidgets extension. The app
/// writes widget data here (HyperTrackNativePlugin.setWidgetData); the widgets
/// read it in their timeline providers.
enum HyperTrackShared {
    static let appGroup = "group.app.hypertrack.workout"
    static let todayWorkoutKey = "widget.todayWorkout"
    static let nutritionTodayKey = "widget.nutritionToday"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }
}

#if canImport(ActivityKit)
/// The rest-timer Live Activity. Compiled into BOTH the app (which starts,
/// updates and ends it) and the widget extension (which draws it), so the
/// two must agree on this type exactly.
@available(iOS 16.1, *)
struct RestTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the countdown started (full allotment, for the progress bar).
        var startTime: Date
        /// When rest is over. `Text(timerInterval:)` ticks toward it on its
        /// own, so the app never has to push per-second updates.
        var endTime: Date
        var exerciseName: String
        /// e.g. "Set 3 of 4"; empty when unknown.
        var nextSet: String
    }
}
#endif

import WidgetKit
import SwiftUI

@main
struct HyperTrackWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TodayWorkoutWidget()
        NutritionWidget()
        RestTimerLiveActivity()
    }
}

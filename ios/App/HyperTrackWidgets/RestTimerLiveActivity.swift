import ActivityKit
import WidgetKit
import SwiftUI

struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            RestTimerLockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(HTColor.background)
                .activitySystemActionForegroundColor(HTColor.ink)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Rest", systemImage: "timer")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(HTColor.accent)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CountdownText(state: state, isStale: context.isStale)
                        .font(.title2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(HTColor.ink)
                        .frame(maxWidth: 90, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(state.exerciseName)
                                .font(.headline)
                                .lineLimit(1)
                            Spacer()
                            if !state.nextSet.isEmpty {
                                Text(state.nextSet)
                                    .font(.subheadline)
                                    .foregroundStyle(HTColor.ink2)
                                    .lineLimit(1)
                            }
                        }
                        RestProgress(state: state)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(HTColor.accent)
            } compactTrailing: {
                CountdownText(state: state, isStale: context.isStale)
                    .monospacedDigit()
                    .frame(maxWidth: 44)
                    .foregroundStyle(HTColor.accent)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(HTColor.accent)
            }
            .keylineTint(HTColor.accent)
        }
    }
}

/// Counts down by itself; shows "Go" once rest is over.
struct CountdownText: View {
    let state: RestTimerAttributes.ContentState
    let isStale: Bool

    var body: some View {
        if isStale || state.endTime <= Date() {
            Text("Go")
        } else {
            Text(timerInterval: Date()...state.endTime, countsDown: true)
                .multilineTextAlignment(.trailing)
        }
    }
}

struct RestProgress: View {
    let state: RestTimerAttributes.ContentState

    var body: some View {
        ProgressView(timerInterval: state.startTime...state.endTime, countsDown: false) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(HTColor.accent)
    }
}

struct RestTimerLockScreenView: View {
    let state: RestTimerAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(isStale ? "Rest over" : "Resting")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(HTColor.accent)
                    Text(state.exerciseName)
                        .font(.headline)
                        .foregroundStyle(HTColor.ink)
                        .lineLimit(1)
                    if !state.nextSet.isEmpty {
                        Text(state.nextSet)
                            .font(.subheadline)
                            .foregroundStyle(HTColor.ink2)
                            .lineLimit(1)
                    }
                }
                Spacer()
                CountdownText(state: state, isStale: isStale)
                    .font(.system(size: 40, weight: .semibold).monospacedDigit())
                    .foregroundStyle(HTColor.ink)
                    .frame(maxWidth: 140, alignment: .trailing)
            }
            RestProgress(state: state)
        }
        .padding(16)
    }
}

#if DEBUG
@available(iOS 17.0, *)
#Preview("Lock screen", as: .content, using: RestTimerAttributes()) {
    RestTimerLiveActivity()
} contentStates: {
    RestTimerAttributes.ContentState(
        startTime: .now, endTime: .now.addingTimeInterval(150),
        exerciseName: "Barbell Bench Press", nextSet: "Set 3 of 4"
    )
}
#endif

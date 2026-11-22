import WidgetKit
import SwiftUI

/// Written by the app: lib/integrations/liveActivity.ts updateTodayWorkoutWidget.
struct TodayWorkoutData: Codable {
    var sessionName: String?
    var detail: String?
    var path: String?
    var updatedAt: Double?
}

struct TodayWorkoutEntry: TimelineEntry {
    let date: Date
    let data: TodayWorkoutData?
}

struct TodayWorkoutProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayWorkoutEntry {
        TodayWorkoutEntry(date: .now, data: TodayWorkoutData(sessionName: "Upper A", detail: "6 exercises", path: "/dashboard"))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayWorkoutEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayWorkoutEntry>) -> Void) {
        // The app reloads timelines whenever it writes new data; also refresh
        // after midnight so yesterday's plan doesn't linger.
        let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400))
        completion(Timeline(entries: [current()], policy: .after(midnight)))
    }

    private func current() -> TodayWorkoutEntry {
        var data = readShared(TodayWorkoutData.self, key: HyperTrackShared.todayWorkoutKey)
        // Stale (written on an earlier day): don't claim it's today's plan.
        if let ts = data?.updatedAt,
           !Calendar.current.isDateInToday(Date(timeIntervalSince1970: ts / 1000)) {
            data = nil
        }
        return TodayWorkoutEntry(date: .now, data: data)
    }
}

struct TodayWorkoutView: View {
    let entry: TodayWorkoutEntry

    var body: some View {
        let name = entry.data?.sessionName
        VStack(alignment: .leading, spacing: 4) {
            Label("Today", systemImage: "dumbbell.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(HTColor.accent)
            Spacer(minLength: 0)
            if entry.data == nil {
                Text("Open HyperTrack")
                    .font(.headline)
                    .foregroundStyle(HTColor.ink)
                Text("to load today's plan")
                    .font(.caption)
                    .foregroundStyle(HTColor.ink2)
            } else if let name {
                Text(name)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(HTColor.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                if let detail = entry.data?.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(HTColor.ink2)
                        .lineLimit(1)
                }
            } else {
                Text("Rest day")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(HTColor.ink)
                Text("Recover well")
                    .font(.caption)
                    .foregroundStyle(HTColor.ink2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(deepLink(entry.data?.path ?? "/dashboard"))
        .htWidgetBackground()
    }
}

struct TodayWorkoutWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayWorkoutWidget", provider: TodayWorkoutProvider()) { entry in
            TodayWorkoutView(entry: entry)
        }
        .configurationDisplayName("Today's workout")
        .description("Your next planned session, or a rest day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

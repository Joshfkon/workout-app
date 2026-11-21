import WidgetKit
import SwiftUI

/// Written by the app: lib/integrations/liveActivity.ts updateNutritionWidget.
struct NutritionData: Codable {
    var caloriesLeft: Double
    var caloriesTarget: Double
    var proteinLeft: Double
    var proteinTarget: Double
    var path: String?
    var updatedAt: Double?
}

struct NutritionEntry: TimelineEntry {
    let date: Date
    let data: NutritionData?
}

struct NutritionProvider: TimelineProvider {
    func placeholder(in context: Context) -> NutritionEntry {
        NutritionEntry(date: .now, data: NutritionData(
            caloriesLeft: 820, caloriesTarget: 2600, proteinLeft: 64, proteinTarget: 190, path: "/dashboard/nutrition"))
    }

    func getSnapshot(in context: Context, completion: @escaping (NutritionEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NutritionEntry>) -> Void) {
        let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400))
        completion(Timeline(entries: [current()], policy: .after(midnight)))
    }

    private func current() -> NutritionEntry {
        guard var data = readShared(NutritionData.self, key: HyperTrackShared.nutritionTodayKey) else {
            return NutritionEntry(date: .now, data: nil)
        }
        // A new day starts with the full target left.
        if let ts = data.updatedAt,
           !Calendar.current.isDateInToday(Date(timeIntervalSince1970: ts / 1000)) {
            data.caloriesLeft = data.caloriesTarget
            data.proteinLeft = data.proteinTarget
        }
        return NutritionEntry(date: .now, data: data)
    }
}

struct MacroLeftRow: View {
    let title: String
    let left: Double
    let target: Double
    let unit: String
    let color: Color

    var body: some View {
        let over = left < 0
        let progress = target > 0 ? min(1, max(0, (target - left) / target)) : 0
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(Int(abs(left).rounded()))")
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .foregroundStyle(HTColor.ink)
                Text(over ? "\(unit) over" : "\(unit) left")
                    .font(.caption)
                    .foregroundStyle(over ? HTColor.over : HTColor.ink2)
                Spacer(minLength: 0)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            ProgressView(value: progress)
                .progressViewStyle(.linear)
                .tint(over ? HTColor.over : color)
            Text(title)
                .font(.caption2)
                .foregroundStyle(HTColor.ink2)
        }
    }
}

struct NutritionView: View {
    let entry: NutritionEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Eat", systemImage: "fork.knife")
                .font(.caption.weight(.semibold))
                .foregroundStyle(HTColor.accent)
            if let data = entry.data {
                MacroLeftRow(title: "Calories", left: data.caloriesLeft, target: data.caloriesTarget,
                             unit: "kcal", color: HTColor.accent)
                MacroLeftRow(title: "Protein", left: data.proteinLeft, target: data.proteinTarget,
                             unit: "g", color: HTColor.protein)
            } else {
                Spacer(minLength: 0)
                Text("Open HyperTrack to set your targets")
                    .font(.subheadline)
                    .foregroundStyle(HTColor.ink)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(deepLink(entry.data?.path ?? "/dashboard/nutrition"))
        .htWidgetBackground()
    }
}

struct NutritionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NutritionWidget", provider: NutritionProvider()) { entry in
            NutritionView(entry: entry)
        }
        .configurationDisplayName("Calories & protein")
        .description("What's left of today's calorie and protein targets.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

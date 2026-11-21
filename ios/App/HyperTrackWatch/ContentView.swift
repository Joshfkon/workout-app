import SwiftUI

/// HyperTrack accent (sky-400 in the app's dark theme).
let accent = Color(red: 56 / 255, green: 189 / 255, blue: 248 / 255)

struct ContentView: View {
    @EnvironmentObject var store: WorkoutStore

    var body: some View {
        NavigationStack {
            Group {
                if store.handedOffFinish {
                    MessageView(icon: "iphone", title: "Finish on your iPhone",
                                detail: "Your summary is open there.")
                } else if !store.isActive {
                    MessageView(icon: "dumbbell.fill", title: "No workout",
                                detail: "Start a workout in HyperTrack on your iPhone.")
                } else if let end = store.restEnd {
                    RestView(end: end, total: store.restTotal)
                } else if store.awaitingPhone {
                    MessageView(icon: "iphone", title: "Sent to iPhone",
                                detail: "Next set appears when your iPhone catches up.")
                } else if store.canLog {
                    LoggerView()
                } else if store.allSetsDone {
                    ExerciseDoneView()
                } else {
                    MessageView(icon: "iphone", title: "Continue on your iPhone",
                                detail: "This step isn't on the watch yet.")
                }
            }
            .toolbar {
                // Neutral glass buttons: the accent tint filled them and hid the chevrons.
                if store.isActive && !store.handedOffFinish {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { store.navigate("prev") } label: {
                            Image(systemName: "chevron.left").foregroundStyle(.white)
                        }
                            .disabled(!(store.phone.canPrev ?? false))
                            .accessibilityLabel("Previous exercise")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { store.navigate("next") } label: {
                            Image(systemName: "chevron.right").foregroundStyle(.white)
                        }
                            .disabled(!(store.phone.canNext ?? false))
                            .accessibilityLabel("Next exercise")
                    }
                }
            }
        }
        .tint(accent)
    }
}

private enum Field: Hashable { case weight, reps }

struct LoggerView: View {
    @EnvironmentObject var store: WorkoutStore
    @FocusState private var focus: Field?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                ExerciseHeader()

                HStack(spacing: 6) {
                    if store.weightIsEditable {
                        ValueTile(value: formatWeight(store.weight), label: store.unit, selected: focus == .weight)
                            .focusable()
                            .focused($focus, equals: .weight)
                            .digitalCrownRotation($store.weight, from: 0, through: 1000, by: store.weightStep,
                                                  sensitivity: .low, isContinuous: false,
                                                  isHapticFeedbackEnabled: true)
                            .onTapGesture { focus = .weight }
                            .accessibilityLabel("Weight \(formatWeight(store.weight)) \(store.unit)")
                    } else {
                        ValueTile(value: "BW", label: "bodyweight", selected: false)
                    }
                    ValueTile(value: "\(Int(store.reps.rounded()))", label: store.phone.repsLabel ?? "reps",
                              selected: focus == .reps)
                        .focusable()
                        .focused($focus, equals: .reps)
                        .digitalCrownRotation($store.reps, from: 1, through: store.maxReps, by: store.repsStep,
                                              sensitivity: .low, isContinuous: false,
                                              isHapticFeedbackEnabled: true)
                        .onTapGesture { focus = .reps }
                        .accessibilityLabel("\(Int(store.reps.rounded())) \(store.phone.repsLabel ?? "reps")")
                }

                Text("How many more could you have done?")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 4) {
                    ForEach(rirChips, id: \.self) { chip in
                        Button { store.rir = chip } label: {
                            Text(rirChipLabel(chip))
                                .font(.system(size: 15, weight: .semibold).monospacedDigit())
                                .frame(maxWidth: .infinity, minHeight: 30)
                                .background(store.rir == chip ? accent : Color.white.opacity(0.12),
                                            in: RoundedRectangle(cornerRadius: 8))
                                .foregroundStyle(store.rir == chip ? Color.black : Color.white)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(rirChipLabel(chip)) reps in reserve")
                        .accessibilityAddTraits(store.rir == chip ? .isSelected : [])
                    }
                }

                Button {
                    store.logSet()
                } label: {
                    Text("Done").font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(accent)
                .foregroundStyle(.black)
                .padding(.top, 2)

                FinishButton()
            }
        }
        // Give the crown to a value tile, not the scroll view. Focus set
        // synchronously in onAppear doesn't stick on watchOS, so defer it.
        .task(id: store.setNumber) {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if focus == nil { focus = store.weightIsEditable ? .weight : .reps }
        }
    }
}

struct ExerciseHeader: View {
    @EnvironmentObject var store: WorkoutStore

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(store.phone.exerciseName ?? "Exercise")
                .font(.system(size: 17, weight: .semibold))
                .lineLimit(2)
            HStack(spacing: 4) {
                Text("Set \(store.setNumber) of \(store.phone.targetSets ?? store.setNumber)")
                if let n = store.phone.exerciseNumber, let count = store.phone.exerciseCount {
                    Text("·")
                    Text("\(n)/\(count)")
                }
            }
            .font(.system(size: 13).monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }
}

struct ValueTile: View {
    let value: String
    let label: String
    let selected: Bool

    var body: some View {
        VStack(spacing: 0) {
            Text(value)
                .font(.system(size: 26, weight: .semibold).monospacedDigit())
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 58)
        .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? accent : .clear, lineWidth: 2))
    }
}

struct RestView: View {
    @EnvironmentObject var store: WorkoutStore
    let end: Date
    let total: TimeInterval

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                ProgressView(timerInterval: end.addingTimeInterval(-max(total, 1))...end, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.circular)
                .tint(accent)
                .scaleEffect(2.6)
                VStack(spacing: 0) {
                    Text("Rest").font(.system(size: 13)).foregroundStyle(.secondary)
                    // Clamped: a render just after the rest ends would build an
                    // inverted range (now > end), which traps.
                    Text(timerInterval: min(Date(), end)...end, countsDown: true)
                        .font(.system(size: 32, weight: .semibold).monospacedDigit())
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 120)

            Text("Next: set \(store.setNumber) · \(store.phone.exerciseName ?? "")")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Button("Log next set") { store.dismissRest() }
                .buttonStyle(.bordered)
        }
        .padding(.horizontal, 4)
    }
}

struct ExerciseDoneView: View {
    @EnvironmentObject var store: WorkoutStore

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ExerciseHeader().frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "checkmark.circle.fill").font(.system(size: 34)).foregroundStyle(accent)
                Text("All \(store.phone.targetSets ?? 0) sets done").font(.system(size: 15, weight: .semibold))
                if store.phone.canNext ?? false {
                    Button("Next exercise") { store.navigate("next") }
                        .buttonStyle(.borderedProminent)
                        .foregroundStyle(.black)
                }
                FinishButton()
            }
        }
    }
}

struct FinishButton: View {
    @EnvironmentObject var store: WorkoutStore

    var body: some View {
        Button("Finish workout") { store.finishOnPhone() }
            .buttonStyle(.bordered)
            .font(.system(size: 15))
    }
}

struct MessageView: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 28)).foregroundStyle(accent)
            Text(title).font(.system(size: 17, weight: .semibold)).multilineTextAlignment(.center)
            Text(detail).font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding()
    }
}

import Foundation

/// Mirrors `lib/watch/protocol.ts` (WATCH_PROTOCOL_VERSION 1). The phone is the
/// source of truth; these are snapshots it sends and commands we send back.
let watchProtocolVersion = 1

struct WatchRestState: Codable, Equatable {
    /// Epoch milliseconds the rest ends.
    var endsAt: Double
    var totalSeconds: Double

    var endDate: Date { Date(timeIntervalSince1970: endsAt / 1000) }
}

/// The phone's active set. `active == false` means no workout is on screen.
struct WatchWorkoutState: Codable, Equatable {
    var v: Int
    var active: Bool
    var sessionId: String?
    var blockId: String?
    var exerciseName: String?
    var exerciseNumber: Int?
    var exerciseCount: Int?
    var canLog: Bool?
    var canQueueNext: Bool?
    var allSetsDone: Bool?
    var setNumber: Int?
    var targetSets: Int?
    /// Display units; nil for plain bodyweight.
    var weight: Double?
    var weightStep: Double?
    var unit: String?
    var reps: Int?
    var repsStep: Int?
    var maxReps: Int?
    var repsLabel: String?
    var targetRir: Int?
    var canPrev: Bool?
    var canNext: Bool?
    var rest: WatchRestState?
    var defaultRestSeconds: Double?

    static let inactive = WatchWorkoutState(v: watchProtocolVersion, active: false)

    init(v: Int, active: Bool) {
        self.v = v
        self.active = active
    }
}

/// Commands to the phone. Each carries a unique id; the phone ignores repeats,
/// so resending after a failed delivery can never log a set twice.
enum WatchCommand {
    case logSet(sessionId: String, blockId: String, setNumber: Int, weight: Double?, reps: Int, rir: Int)
    case navigate(sessionId: String, blockId: String, direction: String)
    case finish(sessionId: String)
    case requestState

    func payload(id: String = UUID().uuidString) -> [String: Any] {
        var body: [String: Any] = ["v": watchProtocolVersion, "id": id]
        switch self {
        case let .logSet(sessionId, blockId, setNumber, weight, reps, rir):
            body["type"] = "logSet"
            body["sessionId"] = sessionId
            body["blockId"] = blockId
            body["setNumber"] = setNumber
            body["weight"] = weight.map { $0 as Any } ?? NSNull()
            body["reps"] = reps
            body["rir"] = rir
        case let .navigate(sessionId, blockId, direction):
            body["type"] = "navigate"
            body["sessionId"] = sessionId
            body["blockId"] = blockId
            body["direction"] = direction
        case let .finish(sessionId):
            body["type"] = "finish"
            body["sessionId"] = sessionId
        case .requestState:
            body["type"] = "requestState"
        }
        return body
    }
}

/// RIR chips, 0 → 4+ (same order and faces as the phone's effort chips).
let rirChips: [Int] = [0, 1, 2, 3, 4]
func rirChipLabel(_ rir: Int) -> String { rir >= 4 ? "4+" : "\(rir)" }

func formatWeight(_ value: Double) -> String {
    if value.rounded() == value { return String(Int(value)) }
    return String(format: "%g", (value * 100).rounded() / 100)
}

import Foundation
import WatchConnectivity
import WatchKit

/// The watch's view of the phone's workout. The phone owns the truth; this
/// keeps the lifter's in-progress edits (weight, reps, RIR) and an optimistic
/// set counter + rest timer so the wrist stays responsive while a log is in
/// flight or queued for a phone whose app isn't running.
@MainActor
final class WorkoutStore: NSObject, ObservableObject {
    static let stateKey = "state"
    static let commandKey = "command"

    @Published private(set) var phone: WatchWorkoutState = .inactive
    @Published var weight: Double = 0
    @Published var reps: Double = 1
    @Published var rir: Int = 2
    /// Set number shown on the wrist: ahead of the phone's while logs are pending.
    @Published private(set) var setNumber: Int = 1
    @Published private(set) var restEnd: Date?
    @Published private(set) var restTotal: TimeInterval = 0
    @Published private(set) var handedOffFinish = false
    @Published private(set) var pendingLogs = 0

    /// Values the phone last sent for the current set, to tell a phone-side
    /// edit (adopt it) from our own unchanged edit.
    private var lastPhoneKey: String?
    private var lastPhoneWeight: Double?
    private var lastPhoneReps: Int?
    private var lastPhoneRir: Int?
    private var lastLogAt: Date?
    private var lastBlockId: String?
    private var restHapticTask: Task<Void, Never>?

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    var isActive: Bool { phone.active }
    var weightIsEditable: Bool { phone.weight != nil }
    var unit: String { phone.unit ?? "kg" }
    var weightStep: Double { max(phone.weightStep ?? 2.5, 0.25) }
    var repsStep: Double { Double(max(phone.repsStep ?? 1, 1)) }
    var maxReps: Double { Double(phone.maxReps ?? 100) }
    var canLog: Bool { phone.canLog ?? false }
    var allSetsDone: Bool { phone.allSetsDone ?? false }

    // MARK: - Phone state

    func apply(_ state: WatchWorkoutState) {
        guard state.v == watchProtocolVersion else { return }
        phone = state
        guard state.active, let blockId = state.blockId, let phoneSet = state.setNumber else {
            pendingLogs = 0
            stopRest()
            return
        }
        handedOffFinish = false

        // A phone snapshot that hasn't caught up with logs still in flight
        // keeps our optimistic set number (and edits) instead of flickering back.
        let key = "\(blockId)#\(phoneSet)"
        let pendingIsFresh = lastLogAt.map { Date().timeIntervalSince($0) < 60 } ?? false
        let behind = pendingLogs > 0 && pendingIsFresh && blockId == lastBlockId && phoneSet < setNumber
        if !behind { pendingLogs = 0 }
        lastBlockId = blockId

        if !behind {
            let newSet = key != lastPhoneKey
            if newSet || state.weight != lastPhoneWeight { weight = state.weight ?? 0 }
            if newSet || state.reps != lastPhoneReps { reps = Double(state.reps ?? 1) }
            if newSet || state.targetRir != lastPhoneRir { rir = state.targetRir ?? 2 }
            setNumber = phoneSet
            lastPhoneKey = key
            lastPhoneWeight = state.weight
            lastPhoneReps = state.reps
            lastPhoneRir = state.targetRir
        }

        if let rest = state.rest, rest.endDate > Date() {
            startRest(until: rest.endDate, total: rest.totalSeconds)
        } else if pendingLogs == 0 {
            stopRest()
        }
    }

    // MARK: - Actions

    func logSet() {
        guard canLog, let sessionId = phone.sessionId, let blockId = phone.blockId else { return }
        send(.logSet(
            sessionId: sessionId,
            blockId: blockId,
            setNumber: setNumber,
            weight: weightIsEditable ? weight : nil,
            reps: Int(reps.rounded()),
            rir: rir
        ), guaranteed: true)
        WKInterfaceDevice.current().play(.success)
        pendingLogs += 1
        lastLogAt = Date()
        let target = phone.targetSets ?? setNumber
        if setNumber < target { setNumber += 1 }
        // Local rest until the phone's (effort-modulated) timer arrives.
        let rest = phone.defaultRestSeconds ?? 0
        if rest > 0 { startRest(until: Date().addingTimeInterval(rest), total: rest) }
    }

    func navigate(_ direction: String) {
        guard let sessionId = phone.sessionId, let blockId = phone.blockId else { return }
        send(.navigate(sessionId: sessionId, blockId: blockId, direction: direction), guaranteed: false)
    }

    func finishOnPhone() {
        guard let sessionId = phone.sessionId else { return }
        send(.finish(sessionId: sessionId), guaranteed: false)
        handedOffFinish = true
    }

    func dismissRest() { stopRest() }

    func requestState() {
        send(.requestState, guaranteed: false)
    }

    // MARK: - Rest timer

    private func startRest(until end: Date, total: Double) {
        restEnd = end
        restTotal = total
        restHapticTask?.cancel()
        let delay = end.timeIntervalSinceNow
        restHapticTask = Task { [weak self] in
            if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
            guard !Task.isCancelled else { return }
            WKInterfaceDevice.current().play(.notification)
            self?.restEnd = nil
        }
    }

    private func stopRest() {
        restHapticTask?.cancel()
        restHapticTask = nil
        restEnd = nil
    }

    // MARK: - Transport

    /// `guaranteed` commands (logging a set) fall back to the queued
    /// transferUserInfo channel when the phone isn't reachable, so the set is
    /// delivered once the phone app runs. The phone de-duplicates by id.
    private func send(_ command: WatchCommand, guaranteed: Bool) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated,
              let data = try? JSONSerialization.data(withJSONObject: command.payload()) else { return }
        let message: [String: Any] = [Self.commandKey: data]
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { _ in
                if guaranteed { session.transferUserInfo(message) }
            }
        } else if guaranteed {
            session.transferUserInfo(message)
        }
    }

    fileprivate func receive(_ payload: [String: Any]) {
        guard let data = payload[Self.stateKey] as? Data,
              let state = try? JSONDecoder().decode(WatchWorkoutState.self, from: data) else { return }
        apply(state)
    }
}

extension WorkoutStore: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                             error: Error?) {
        let context = session.receivedApplicationContext
        Task { @MainActor in
            self.receive(context)
            self.requestState()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.receive(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.receive(message) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in self.requestState() }
    }
}

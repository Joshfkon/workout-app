import Foundation
import Capacitor
import StoreKit

/// Local Capacitor plugin behind lib/integrations/applePurchases.ts: App Store
/// subscriptions with StoreKit 2.
///
/// The web app does the account work. This plugin only talks to the App
/// Store: it lists products, buys one (tagged with the HyperTrack account id
/// as `appAccountToken`), lists current entitlements, restores, and opens
/// Apple's manage-subscriptions sheet. Every transaction goes to JS as
/// Apple's signed `jwsRepresentation`; the server verifies it
/// (/api/apple/sync) before anything is unlocked.
///
/// Registered in HyperTrackBridgeViewController.capacitorDidLoad().
@objc(HyperTrackPurchasesPlugin)
public class HyperTrackPurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HyperTrackPurchasesPlugin"
    public let jsName = "HyperTrackPurchases"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise),
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Renewals, purchases approved later (Ask to Buy), and purchases made
        // on another device arrive here. Hand them to JS, which syncs them.
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result else { continue }
                await transaction.finish()
                self?.notifyListeners("transaction", data: ["jws": result.jwsRepresentation])
            }
        }
    }

    deinit { updatesTask?.cancel() }

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("productIds", String.self) ?? []
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["products": products.map(Self.describe)])
            } catch {
                call.reject("Could not load App Store products: \(error.localizedDescription)")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else { return call.reject("productId is required") }
        guard let token = call.getString("appAccountToken").flatMap(UUID.init(uuidString:)) else {
            return call.reject("appAccountToken (the account id) is required")
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    return call.reject("Product \(productId) is not available")
                }
                let result = try await product.purchase(options: [.appAccountToken(token)])
                switch result {
                case .success(let verification):
                    guard case .verified(let transaction) = verification else {
                        return call.reject("The App Store could not verify this purchase")
                    }
                    await transaction.finish()
                    call.resolve(["status": "success", "jws": verification.jwsRepresentation])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    // Ask to Buy or a payment that needs approval; it arrives
                    // later through Transaction.updates.
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "unknown"])
                }
            } catch {
                call.reject("Purchase failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func currentEntitlements(_ call: CAPPluginCall) {
        Task { call.resolve(["transactions": await Self.entitlementJws()]) }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                // Asks the App Store for the latest transactions; may prompt
                // for the Apple ID password. Only on an explicit Restore tap.
                try await AppStore.sync()
            } catch {
                return call.reject("Restore failed: \(error.localizedDescription)")
            }
            call.resolve(["transactions": await Self.entitlementJws()])
        }
    }

    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                return call.reject("No window to present from")
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                call.reject("Could not open subscriptions: \(error.localizedDescription)")
            }
        }
    }

    private static func entitlementJws() async -> [String] {
        var out: [String] = []
        for await result in Transaction.currentEntitlements {
            guard case .verified = result else { continue }
            out.append(result.jwsRepresentation)
        }
        return out
    }

    private static func describe(_ p: Product) -> [String: Any] {
        var d: [String: Any] = [
            "id": p.id,
            "displayName": p.displayName,
            "description": p.description,
            "displayPrice": p.displayPrice,
            "price": NSDecimalNumber(decimal: p.price).doubleValue,
            "currencyCode": p.priceFormatStyle.currencyCode,
        ]
        if let sub = p.subscription {
            let unit: String
            switch sub.subscriptionPeriod.unit {
            case .day: unit = "day"
            case .week: unit = "week"
            case .month: unit = "month"
            case .year: unit = "year"
            @unknown default: unit = "unknown"
            }
            d["period"] = ["unit": unit, "value": sub.subscriptionPeriod.value]
            if let intro = sub.introductoryOffer {
                d["introOffer"] = ["displayPrice": intro.displayPrice, "paymentMode": "\(intro.paymentMode)"]
            }
        }
        return d
    }
}

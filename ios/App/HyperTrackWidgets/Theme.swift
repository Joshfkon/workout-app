import SwiftUI

/// Colours from the app's dark theme (app/globals.css).
enum HTColor {
    static let background = Color(red: 11 / 255, green: 11 / 255, blue: 13 / 255)
    static let ink = Color(red: 244 / 255, green: 244 / 255, blue: 245 / 255)
    static let ink2 = Color(red: 169 / 255, green: 169 / 255, blue: 178 / 255)
    static let fill = Color(red: 42 / 255, green: 42 / 255, blue: 48 / 255)
    /// Accent: sky-400.
    static let accent = Color(red: 56 / 255, green: 189 / 255, blue: 248 / 255)
    /// Protein: teal-400.
    static let protein = Color(red: 45 / 255, green: 212 / 255, blue: 191 / 255)
    static let over = Color(red: 251 / 255, green: 191 / 255, blue: 36 / 255)
}

/// `hypertrack:///dashboard/train` style URL for an in-app path.
func deepLink(_ path: String?) -> URL? {
    guard let path, path.hasPrefix("/") else { return URL(string: "hypertrack://dashboard") }
    return URL(string: "hypertrack:/" + path)
}

/// Decode a JSON blob the app wrote to the App Group container.
func readShared<T: Decodable>(_ type: T.Type, key: String) -> T? {
    guard let json = HyperTrackShared.defaults?.string(forKey: key),
          let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
}

extension View {
    @ViewBuilder
    func htWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(HTColor.background, for: .widget)
        } else {
            background(HTColor.background)
        }
    }
}

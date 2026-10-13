import SwiftUI

struct ContentView: View {
    var body: some View {
        if let assetsDir = Bundle.main.url(forResource: "WebAssets", withExtension: nil),
           FileManager.default.fileExists(atPath: assetsDir.appendingPathComponent("index.html").path) {
            WebView(rootDirectory: assetsDir)
        } else {
            Text("Client UI assets not found in app bundle.")
                .padding()
        }
    }
}

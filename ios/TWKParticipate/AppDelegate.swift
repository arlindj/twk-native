import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "TWKParticipate",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // twk:// deep links
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal links: https://test.tawakkalnaos.app/t/<token>
  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    return RCTLinkingManager.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    // Prefer Metro for live reload, but NEVER show the red "No script URL"
    // screen: when the packager isn't reachable, fall back to the
    // main.jsbundle embedded at build time (FORCE_BUNDLING in the
    // "Bundle React Native code and images" phase guarantees it exists).
    if let metroURL = RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index"),
       metroReachable(metroURL) {
      return metroURL
    }
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

#if DEBUG
  /// Synchronous ~600ms probe of the Metro /status endpoint.
  private func metroReachable(_ jsBundleURL: URL) -> Bool {
    guard var components = URLComponents(url: jsBundleURL, resolvingAgainstBaseURL: false) else {
      return false
    }
    components.path = "/status"
    components.query = nil
    guard let statusURL = components.url else { return false }

    var request = URLRequest(url: statusURL)
    request.timeoutInterval = 0.6

    var reachable = false
    let semaphore = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { data, response, _ in
      if let http = response as? HTTPURLResponse, http.statusCode == 200,
         let data, String(data: data, encoding: .utf8)?.contains("packager-status:running") == true {
        reachable = true
      }
      semaphore.signal()
    }.resume()
    _ = semaphore.wait(timeout: .now() + 1.0)
    return reachable
  }
#endif
}

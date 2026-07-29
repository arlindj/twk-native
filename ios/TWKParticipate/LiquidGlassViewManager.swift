import UIKit

/** Exposes `LiquidGlassView` to RN as the native view `LiquidGlassView`. */
@objc(LiquidGlassViewManager)
final class LiquidGlassViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }

  override func view() -> UIView! {
    LiquidGlassView()
  }
}

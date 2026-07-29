import UIKit

/**
 * Backs the `LiquidGlassView` RN component with Apple's real Liquid Glass
 * material (`UIGlassEffect`, iOS 26+ — see "Adopting Liquid Glass":
 * https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).
 * Pre-26 devices fall back to a system blur material so the same component
 * still renders something reasonable on the current 15.1 floor.
 *
 * Used as an absolute-fill background layer behind sibling RN content (same
 * pattern the old `@react-native-community/blur` usage followed) — this view
 * has no reparented subviews of its own.
 */
@objc(LiquidGlassView)
final class LiquidGlassView: UIView {
  private let effectView = UIVisualEffectView()

  @objc var interactive: Bool = false {
    didSet { applyEffect() }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    effectView.frame = bounds
    effectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(effectView)
    applyEffect()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  private func applyEffect() {
    if #available(iOS 26.0, *) {
      let glass = UIGlassEffect()
      glass.isInteractive = interactive
      effectView.effect = glass
    } else {
      effectView.effect = UIBlurEffect(style: .systemThinMaterialDark)
    }
  }
}

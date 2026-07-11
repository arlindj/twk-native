import Foundation
import ReplayKit
import UIKit

/**
 * In-app screen recording via ReplayKit, exposed to JS as the
 * `ScreenRecorder` native module (see ScreenRecorderModule.m).
 *
 * ReplayKit only captures this app's own screen (never other apps),
 * shows a system consent dialog the first time recording starts, and
 * displays the standard iOS recording indicator while active — the
 * recording can never be hidden from the participant.
 */
@objc(ScreenRecorder)
class ScreenRecorder: NSObject {
  private let recorder = RPScreenRecorder.shared()

  @objc static func requiresMainQueueSetup() -> Bool { false }

  /// e.g. "iPhone15,2" — used by DeviceContext analytics.
  @objc func constantsToExport() -> [AnyHashable: Any]! {
    var systemInfo = utsname()
    uname(&systemInfo)
    let machine = withUnsafeBytes(of: &systemInfo.machine) { rawPtr -> String in
      let ptr = rawPtr.baseAddress!.assumingMemoryBound(to: CChar.self)
      return String(cString: ptr)
    }
    return ["deviceModel": machine]
  }

  @objc(isAvailable:rejecter:)
  func isAvailable(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // The iOS Simulator reports ReplayKit as available, but a capture
    // started there stalls on stop and never yields a usable file, so we
    // treat the simulator as unavailable — recording is a real-device
    // capability only.
    #if targetEnvironment(simulator)
      resolve(false)
    #else
      resolve(recorder.isAvailable)
    #endif
  }

  /// Removes session files left behind by a crashed/killed app. Only
  /// files older than 6h are touched — segments of the current session
  /// that are still waiting for upload must survive.
  private func cleanupStaleRecordings() {
    let fm = FileManager.default
    let tmp = fm.temporaryDirectory
    guard let files = try? fm.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil) else { return }
    let cutoff = Date().timeIntervalSince1970 - 6 * 3600
    for url in files where url.lastPathComponent.hasPrefix("twk-session-") {
      let stamp = url.deletingPathExtension().lastPathComponent
        .replacingOccurrences(of: "twk-session-", with: "")
      if let epoch = Double(stamp), epoch < cutoff {
        try? fm.removeItem(at: url)
      }
    }
  }

  @objc(startRecording:rejecter:)
  func startRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    cleanupStaleRecordings()
    guard recorder.isAvailable else {
      reject("E_UNAVAILABLE", "Screen recording is not available on this device.", nil)
      return
    }
    guard !recorder.isRecording else {
      reject("E_ALREADY_RECORDING", "A recording is already in progress.", nil)
      return
    }
    // Session evidence is screen-only; think-aloud audio is a separate,
    // explicitly consented feature and is off by default.
    recorder.isMicrophoneEnabled = false
    recorder.startRecording { error in
      if let error = error {
        reject("E_START_FAILED", error.localizedDescription, error)
      } else {
        resolve(nil)
      }
    }
  }

  @objc(stopRecording:rejecter:)
  func stopRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard recorder.isRecording else {
      reject("E_NOT_RECORDING", "No recording is in progress.", nil)
      return
    }
    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("twk-session-\(Int(Date().timeIntervalSince1970)).mp4")
    recorder.stopRecording(withOutput: outputURL) { error in
      if let error = error {
        reject("E_STOP_FAILED", error.localizedDescription, error)
      } else {
        resolve(outputURL.absoluteString)
      }
    }
  }

  @objc(discardRecording:rejecter:)
  func discardRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard recorder.isRecording else {
      resolve(nil)
      return
    }
    recorder.stopRecording { _, error in
      self.recorder.discardRecording {
        if let error = error {
          reject("E_DISCARD_FAILED", error.localizedDescription, error)
        } else {
          resolve(nil)
        }
      }
    }
  }

  /// Replaces expo-keep-awake: the prototype player must not let the
  /// screen sleep mid-task.
  @objc(setKeepScreenOn:)
  func setKeepScreenOn(_ on: Bool) {
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = on
    }
  }
}

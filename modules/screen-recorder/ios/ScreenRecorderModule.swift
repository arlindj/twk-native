import ExpoModulesCore
import ReplayKit

/**
 * In-app screen recording via ReplayKit.
 *
 * ReplayKit only captures this app's own screen (never other apps),
 * shows a system consent dialog the first time recording starts, and
 * displays the standard iOS recording indicator while active — the
 * recording can never be hidden from the participant.
 */
public class ScreenRecorderModule: Module {
  private let recorder = RPScreenRecorder.shared()

  public func definition() -> ModuleDefinition {
    Name("ScreenRecorder")

    AsyncFunction("isAvailable") { () -> Bool in
      // The iOS Simulator reports ReplayKit as available, but a capture
      // started there stalls on stop and never yields a usable file, so we
      // treat the simulator as unavailable — recording is a real-device
      // capability only.
      #if targetEnvironment(simulator)
        return false
      #else
        return self.recorder.isAvailable
      #endif
    }

    AsyncFunction("startRecording") { (promise: Promise) in
      guard self.recorder.isAvailable else {
        promise.reject("E_UNAVAILABLE", "Screen recording is not available on this device.")
        return
      }
      guard !self.recorder.isRecording else {
        promise.reject("E_ALREADY_RECORDING", "A recording is already in progress.")
        return
      }
      // Session evidence is screen-only; think-aloud audio is a separate,
      // explicitly consented feature and is off by default.
      self.recorder.isMicrophoneEnabled = false
      self.recorder.startRecording { error in
        if let error = error {
          promise.reject("E_START_FAILED", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      guard self.recorder.isRecording else {
        promise.reject("E_NOT_RECORDING", "No recording is in progress.")
        return
      }
      let outputURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("twk-session-\(Int(Date().timeIntervalSince1970)).mp4")
      self.recorder.stopRecording(withOutput: outputURL) { error in
        if let error = error {
          promise.reject("E_STOP_FAILED", error.localizedDescription)
        } else {
          promise.resolve(outputURL.absoluteString)
        }
      }
    }

    AsyncFunction("discardRecording") { (promise: Promise) in
      guard self.recorder.isRecording else {
        promise.resolve(nil)
        return
      }
      self.recorder.stopRecording { _, error in
        self.recorder.discardRecording {
          if let error = error {
            promise.reject("E_DISCARD_FAILED", error.localizedDescription)
          } else {
            promise.resolve(nil)
          }
        }
      }
    }
  }
}

import AVFoundation
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
 *
 * ## Why startCapture + AVAssetWriter instead of startRecording
 *
 * `RPScreenRecorder.startRecording` / `stopRecording(withOutput:)` is the
 * two-line API, but it encodes at the device's native resolution with its own
 * bitrate and no knobs at all. Measured on an iPhone 13 Pro Max (1284x2778):
 * **13.2 MiB/min** — a 7.5-minute session came to 98.9 MiB, which is how a
 * normal multi-task run produced a video the upload endpoint rejected.
 *
 * `startCapture` hands us raw sample buffers instead, so we own the encode:
 *  - **Downscale** to `maxLongEdge` (720p-class). Prototype screens are flat UI,
 *    not film — text stays legible well below native retina density, and pixel
 *    count is the single biggest lever on bitrate.
 *  - **Cap the bitrate** (`videoBitrate`). H.264 on mostly-static UI spends very
 *    little on a capped budget; motion is limited to screen transitions.
 *  - **Throttle to `targetFPS`** (30). ReplayKit can deliver 60; nothing in a
 *    usability replay needs it, and half the frames is half the encoder work.
 *
 * Everything the participant is promised stays true: still this app's screen
 * only, still the system consent dialog, still the OS recording indicator.
 */
@objc(ScreenRecorder)
class ScreenRecorder: NSObject {
  private let recorder = RPScreenRecorder.shared()

  // MARK: - Encode budget

  /// Longest output edge in pixels. 1280 keeps UI text crisp while cutting a
  /// 1284x2778 screen to ~591x1280 — about 4.7x fewer pixels to encode.
  private let maxLongEdge: CGFloat = 1280
  /// Average H.264 bitrate — a CEILING, not a target. Measured result on the
  /// same device and prototype: **1.35 MiB/min** (a 12-minute session came to
  /// 16.1 MiB), i.e. ~9.8x smaller than the 13.2 MiB/min above. The encoder
  /// lands far under this cap because flat prototype UI is nearly static and
  /// H.264 only needs bits during screen transitions — so raising the cap would
  /// change little, and lowering it would start costing visible quality first.
  ///
  /// At 1280 long edge this is also MORE bits per pixel than the old encode had
  /// at native resolution, which is why files shrink without looking worse.
  private let videoBitrate = 1_000_000
  /// Mono AAC is plenty for think-aloud speech.
  private let audioBitrate = 64_000
  private let targetFPS: Int32 = 30

  // MARK: - Writer state (all touched only on `writerQueue`)

  private let writerQueue = DispatchQueue(label: "com.tawakkalnaos.screenrecorder.writer")
  private var assetWriter: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var audioInput: AVAssetWriterInput?
  private var sessionStarted = false
  private var outputURL: URL?
  private var lastVideoPTS: CMTime = .invalid
  /// Diagnostics: a video-only file when audio was requested is otherwise silent.
  private var videoSamplesAppended = 0
  private var audioSamplesAppended = 0
  private var audioRequested = false
  /// Minimum spacing between kept frames, from `targetFPS`.
  private var minFrameInterval: CMTime {
    CMTime(value: 1, timescale: targetFPS)
  }

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

  @objc(startRecording:resolver:rejecter:)
  func startRecording(
    _ withAudio: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
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
    // Think-aloud audio is opt-in: the microphone is captured only when the
    // participant consented to audio on the "Before you start" screen.
    // ReplayKit surfaces the microphone permission prompt inside its own
    // consent dialog when this is on (needs NSMicrophoneUsageDescription).
    recorder.isMicrophoneEnabled = withAudio

    // `startRecording` managed the audio session internally; `startCapture`
    // does not. Without an active .record-capable AVAudioSession ReplayKit
    // delivers no .audioMic buffers at all, and the result is a silently
    // video-only file — the failure mode is invisible, so configure it here.
    if withAudio {
      activateAudioSession()
    }

    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("twk-session-\(Int(Date().timeIntervalSince1970)).mp4")

    do {
      try prepareWriter(at: url, withAudio: withAudio)
    } catch {
      deactivateAudioSession()
      reject("E_START_FAILED", "Could not prepare the video file: \(error.localizedDescription)", error)
      return
    }

    recorder.startCapture(
      handler: { [weak self] sampleBuffer, bufferType, sampleError in
        guard sampleError == nil else { return }
        self?.append(sampleBuffer, of: bufferType)
      },
      completionHandler: { [weak self] error in
        if let error = error {
          // Consent denied, or capture unavailable — tear the half-built writer
          // down so a later attempt starts from a clean slate.
          self?.deactivateAudioSession()
          self?.teardownWriter(deleteFile: true)
          reject("E_START_FAILED", error.localizedDescription, error)
        } else {
          resolve(nil)
        }
      }
    )
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
    recorder.stopCapture { [weak self] error in
      guard let self = self else {
        reject("E_STOP_FAILED", "Recorder went away before the file was finished.", nil)
        return
      }
      if let error = error {
        self.teardownWriter(deleteFile: true)
        reject("E_STOP_FAILED", error.localizedDescription, error)
        return
      }
      // Capture has stopped but queued buffers may still be in flight; hop onto
      // the writer queue so finishWriting runs strictly after the last append.
      self.writerQueue.async {
        guard let writer = self.assetWriter, self.sessionStarted else {
          let hadWriter = self.assetWriter != nil
          self.teardownWriterLocked(deleteFile: true)
          reject(
            "E_STOP_FAILED",
            hadWriter
              ? "The recording contained no frames."
              : "No recording was in progress.",
            nil
          )
          return
        }
        NSLog(
          "[ScreenRecorder] finishing: video=\(self.videoSamplesAppended) samples, audio=\(self.audioSamplesAppended) samples, audioRequested=\(self.audioRequested)"
        )
        if self.audioRequested && self.audioSamplesAppended == 0 {
          NSLog("[ScreenRecorder] WARNING: audio was consented but no mic buffers arrived — file will be video-only")
        }
        self.videoInput?.markAsFinished()
        self.audioInput?.markAsFinished()
        let url = self.outputURL
        writer.finishWriting {
          let status = writer.status
          let failure = writer.error
          self.writerQueue.async {
            self.deactivateAudioSession()
            self.teardownWriterLocked(deleteFile: status != .completed)
            if status == .completed, let url = url {
              resolve(url.absoluteString)
            } else {
              reject(
                "E_STOP_FAILED",
                failure?.localizedDescription ?? "The video file could not be finalized.",
                failure
              )
            }
          }
        }
      }
    }
  }

  @objc(discardRecording:rejecter:)
  func discardRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard recorder.isRecording else {
      teardownWriter(deleteFile: true)
      resolve(nil)
      return
    }
    recorder.stopCapture { [weak self] _ in
      // A discard is best-effort by definition: whatever the capture said, the
      // partial file goes away and the caller is told we are clean.
      self?.teardownWriter(deleteFile: true)
      resolve(nil)
    }
  }

  // MARK: - AVAssetWriter plumbing

  /// Output pixel size: the screen scaled so its long edge is at most
  /// `maxLongEdge`, rounded to even numbers (H.264 requires even dimensions).
  private func outputSize() -> CGSize {
    let bounds = UIScreen.main.bounds.size
    let scale = UIScreen.main.scale
    let native = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    let longEdge = max(native.width, native.height)
    let factor = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1
    func even(_ v: CGFloat) -> CGFloat { max(2, (v * factor / 2).rounded() * 2) }
    return CGSize(width: even(native.width), height: even(native.height))
  }

  private func prepareWriter(at url: URL, withAudio: Bool) throws {
    try writerQueue.sync {
      // Never inherit state from a previous attempt.
      teardownWriterLocked(deleteFile: true)

      let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
      let size = outputSize()

      let video = AVAssetWriterInput(
        mediaType: .video,
        outputSettings: [
          AVVideoCodecKey: AVVideoCodecType.h264,
          AVVideoWidthKey: Int(size.width),
          AVVideoHeightKey: Int(size.height),
          // ReplayKit's buffers are full-resolution; letting the encoder do the
          // downscale avoids a per-frame CoreImage pass on the capture thread.
          AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
          AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: videoBitrate,
            AVVideoMaxKeyFrameIntervalKey: Int(targetFPS) * 2,
            AVVideoExpectedSourceFrameRateKey: Int(targetFPS),
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            // No B-frames: cheaper to encode and the replay never seeks.
            AVVideoAllowFrameReorderingKey: false,
          ],
        ]
      )
      video.expectsMediaDataInRealTime = true
      guard writer.canAdd(video) else {
        throw NSError(
          domain: "ScreenRecorder", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Video input rejected by the writer."]
        )
      }
      writer.add(video)

      var audio: AVAssetWriterInput?
      if withAudio {
        let input = AVAssetWriterInput(
          mediaType: .audio,
          outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVNumberOfChannelsKey: 1,
            AVSampleRateKey: 44_100,
            AVEncoderBitRateKey: audioBitrate,
          ]
        )
        input.expectsMediaDataInRealTime = true
        if writer.canAdd(input) {
          writer.add(input)
          audio = input
        }
        // If the writer refuses audio we still record video — losing the video
        // over a mic problem would be a far worse trade.
      }

      assetWriter = writer
      videoInput = video
      audioInput = audio
      outputURL = url
      sessionStarted = false
      lastVideoPTS = .invalid
      videoSamplesAppended = 0
      audioSamplesAppended = 0
      audioRequested = withAudio
    }
  }

  /// Called on ReplayKit's capture queue for every buffer.
  private func append(_ sampleBuffer: CMSampleBuffer, of type: RPSampleBufferType) {
    guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
    // App audio is deliberately dropped: the participant consented to their own
    // voice, and prototype sound adds bitrate without adding evidence.
    guard type == .video || type == .audioMic else { return }

    writerQueue.async {
      guard let writer = self.assetWriter else { return }
      if writer.status == .failed || writer.status == .cancelled { return }

      let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

      // The session must start on a video frame so the first sample defines t=0.
      if !self.sessionStarted {
        guard type == .video else { return }
        if writer.status == .unknown {
          guard writer.startWriting() else { return }
        }
        writer.startSession(atSourceTime: pts)
        self.sessionStarted = true
      }

      switch type {
      case .video:
        // Frame throttle: skip anything arriving sooner than 1/targetFPS after
        // the last kept frame. AVAssetWriter is fine with uneven spacing —
        // presentation timestamps carry the real timing.
        if self.lastVideoPTS.isValid {
          let elapsed = CMTimeSubtract(pts, self.lastVideoPTS)
          if CMTimeCompare(elapsed, self.minFrameInterval) < 0 { return }
        }
        guard let input = self.videoInput, input.isReadyForMoreMediaData else { return }
        if input.append(sampleBuffer) {
          self.lastVideoPTS = pts
          self.videoSamplesAppended += 1
        }
      case .audioMic:
        guard let input = self.audioInput, input.isReadyForMoreMediaData else { return }
        if input.append(sampleBuffer) { self.audioSamplesAppended += 1 }
      default:
        break
      }
    }
  }

  // MARK: - Audio session

  /// `startCapture` leaves the audio session to the caller. Category must allow
  /// recording or no mic buffers are produced; `.mixWithOthers` keeps us from
  /// interrupting whatever the prototype itself might be playing.
  private func activateAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetooth])
      try session.setActive(true, options: [])
    } catch {
      // Non-fatal: the segment records video only rather than not at all.
      NSLog("[ScreenRecorder] audio session setup failed: \(error.localizedDescription)")
    }
  }

  private func deactivateAudioSession() {
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    } catch {
      /* nothing actionable — the session is torn down either way */
    }
  }

  private func teardownWriter(deleteFile: Bool) {
    writerQueue.async { self.teardownWriterLocked(deleteFile: deleteFile) }
  }

  /// Must be called on `writerQueue`.
  private func teardownWriterLocked(deleteFile: Bool) {
    if let writer = assetWriter, writer.status == .writing {
      writer.cancelWriting()
    }
    if deleteFile, let url = outputURL {
      try? FileManager.default.removeItem(at: url)
    }
    assetWriter = nil
    videoInput = nil
    audioInput = nil
    outputURL = nil
    sessionStarted = false
    lastVideoPTS = .invalid
    videoSamplesAppended = 0
    audioSamplesAppended = 0
    audioRequested = false
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

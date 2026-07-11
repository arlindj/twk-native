import { NativeModules } from 'react-native';

/**
 * JS bridge for the native screen recorder (plain React Native module,
 * registered as `ScreenRecorder` on both platforms).
 * iOS: ReplayKit (in-app capture, system permission dialog on start).
 * Android: MediaProjection + foreground service (system consent dialog
 * on every session, as required by the OS).
 *
 * In environments without the native module a mock implementation is
 * returned so the rest of the flow stays testable — recording is simply
 * reported as unavailable.
 */

export interface NativeScreenRecorder {
  isAvailable(): Promise<boolean>;
  /** Resolves when recording is confirmed started (after OS consent). */
  startRecording(): Promise<void>;
  /** Resolves with the local file URI of the finished mp4. */
  stopRecording(): Promise<string>;
  /** Discards an in-flight recording without producing a file. */
  discardRecording(): Promise<void>;
  /** Keeps the screen awake while the prototype player is on screen. */
  setKeepScreenOn(on: boolean): void;
  /** Native constant: device model identifier (e.g. "iPhone15,2", "Pixel 8"). */
  deviceModel?: string;
}

class MockRecorder implements NativeScreenRecorder {
  async isAvailable() {
    return false;
  }
  async startRecording() {
    throw new Error('Screen recording is not available in this environment.');
  }
  async stopRecording(): Promise<string> {
    throw new Error('Screen recording is not available in this environment.');
  }
  async discardRecording() {
    /* no-op */
  }
  setKeepScreenOn() {
    /* no-op */
  }
}

const native = NativeModules.ScreenRecorder as NativeScreenRecorder | undefined;
if (__DEV__) {
  // Diagnostic: distinguishes "native module missing" (mock fallback) from
  // "recording unavailable on this device" — the two look identical in the UI.
  console.log(
    `[ScreenRecorder] native module ${native ? `bridged (deviceModel=${native.deviceModel})` : 'MISSING — using mock'}`,
  );
}
const recorder: NativeScreenRecorder = native ?? new MockRecorder();

export default recorder;

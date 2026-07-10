import { useEffect } from 'react';
import ScreenRecorder from '../../modules/screen-recorder';

/**
 * Replaces expo-keep-awake. The prototype player must not let the
 * screen sleep mid-task; implemented natively in the ScreenRecorder
 * module (idle timer on iOS, FLAG_KEEP_SCREEN_ON on Android).
 */
export function useKeepAwake() {
  useEffect(() => {
    ScreenRecorder.setKeepScreenOn(true);
    return () => ScreenRecorder.setKeepScreenOn(false);
  }, []);
}

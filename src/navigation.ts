import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Route map. `TestRunner` is the deep-link target:
 *   https://test.tawakkalnaos.app/t/<token>?api=<override>  -> app opens here
 *   twk://t/<token>                                         -> same
 */
export type RootStackParamList = {
  Home: undefined;
  Scan: undefined;
  TestRunner: { token: string; api?: string };
};

export type Nav = NativeStackNavigationProp<RootStackParamList>;

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Leave the session flow and land back on Home with a clean stack. */
export function resetToHome() {
  if (navigationRef.isReady()) {
    navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
  }
}

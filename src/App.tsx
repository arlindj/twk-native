import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SplashScreen } from './components/SplashScreen';
import { navigationRef, RootStackParamList } from './navigation';
import { HomeScreen } from './screens/HomeScreen';
import { ResumeSessionScreen } from './screens/ResumeSessionScreen';
import { ScanScreen } from './screens/ScanScreen';
import { TestRunnerScreen } from './screens/TestRunnerScreen';
import { findResumableSession } from './state/sessionStore';
import { ThemeProvider, useTheme } from './theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Deep links open the session runner directly:
 *   https://test.tawakkalnaos.app/t/<token>?api=<override>
 *   twk://t/<token>?api=<override>
 * Query params (api) merge into the route params automatically.
 */
const linking = {
  // synth.nacew.com is the live web app whose "Test on a phone" QR encodes
  // https://synth.nacew.com/t/<code>; test.tawakkalnaos.app is the legacy
  // universal-link host. Both resolve to the same TestRunner route.
  prefixes: ['twk://', 'https://synth.nacew.com', 'https://test.tawakkalnaos.app'],
  config: {
    screens: {
      Home: '',
      TestRunner: 't/:token',
    },
  },
};

/** Reads the resolved theme (must be inside ThemeProvider) and applies it to
 *  the navigator + native status bar. */
function ThemedApp() {
  const [splashDone, setSplashDone] = useState(false);
  // Checked once, alongside the splash animation, so the initial route is
  // decided before the navigator ever mounts — no flash of Home's QR/link
  // buttons for a participant who actually has something to resume.
  const [resumable, setResumable] = useState<boolean | undefined>(undefined);
  const { colors, resolvedMode } = useTheme();

  useEffect(() => {
    void findResumableSession().then((s) => setResumable(!!s));
  }, []);

  const ready = splashDone && resumable !== undefined;

  return (
    <>
      <StatusBar
        barStyle={resolvedMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.paper}
      />
      {ready ? (
        <NavigationContainer ref={navigationRef} linking={linking}>
          <Stack.Navigator
            initialRouteName={resumable ? 'Resume' : 'Home'}
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.paper },
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Resume" component={ResumeSessionScreen} />
            <Stack.Screen name="Scan" component={ScanScreen} />
            <Stack.Screen name="TestRunner" component={TestRunnerScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      ) : null}
      {!splashDone ? <SplashScreen onFinish={() => setSplashDone(true)} /> : null}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

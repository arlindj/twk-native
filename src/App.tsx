import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { SplashScreen } from './components/SplashScreen';
import { navigationRef, RootStackParamList } from './navigation';
import { HomeScreen } from './screens/HomeScreen';
import { ScanScreen } from './screens/ScanScreen';
import { TestRunnerScreen } from './screens/TestRunnerScreen';
import { colors } from './theme';

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

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <NavigationContainer ref={navigationRef} linking={linking}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Scan" component={ScanScreen} />
          <Stack.Screen name="TestRunner" component={TestRunnerScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      {!splashDone ? <SplashScreen onFinish={() => setSplashDone(true)} /> : null}
    </>
  );
}

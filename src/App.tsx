import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { StatusBar } from 'react-native';
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
  prefixes: ['twk://', 'https://test.tawakkalnaos.app'],
  config: {
    screens: {
      Home: '',
      TestRunner: 't/:token',
    },
  },
};

export default function App() {
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
    </>
  );
}

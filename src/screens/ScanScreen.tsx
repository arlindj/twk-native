import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import { Button, Screen } from '../components/ui';
import { parseTestLink } from '../linkParser';
import { Nav } from '../navigation';
import { radius, spacing, type } from '../theme';

/** QR scanner — accepts the same link formats as manual entry. */
export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [invalid, setInvalid] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    handled.current = false;
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (handled.current) return;
      const data = codes[0]?.value;
      if (!data) return;
      const parsed = parseTestLink(data);
      if (!parsed) {
        setInvalid(true);
        return;
      }
      handled.current = true;
      navigation.replace('TestRunner', {
        token: parsed.token,
        ...(parsed.apiOverride ? { api: parsed.apiOverride } : {}),
      });
    },
  });

  if (!hasPermission) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={[type.h2, { marginBottom: spacing.sm }]}>Camera access</Text>
          <Text style={[type.body, { marginBottom: spacing.lg }]}>
            The camera is only used to scan your test QR code. Nothing is photographed or stored.
          </Text>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
          <Button label="Back" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  if (!device) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={[type.h2, { marginBottom: spacing.sm }]}>No camera</Text>
          <Text style={[type.body, { marginBottom: spacing.lg }]}>
            No camera is available on this device. Paste the test link manually instead.
          </Text>
          <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        codeScanner={codeScanner}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.bottom}>
        {invalid ? (
          <Text style={styles.invalid}>This QR code is not a test link.</Text>
        ) : (
          <Text style={styles.hint}>Point the camera at the test QR code</Text>
        )}
        <Button label="Cancel" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    top: '25%',
    alignSelf: 'center',
    width: 240,
    height: 240,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: '#0B7A4B',
  },
  bottom: {
    position: 'absolute',
    bottom: 48,
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.sm,
  },
  hint: { color: '#fff', textAlign: 'center', fontSize: 15 },
  invalid: { color: '#FFB4A9', textAlign: 'center', fontSize: 15, fontWeight: '600' },
});

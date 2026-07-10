import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Screen } from '../src/components/ui';
import { parseTestLink } from '../src/linkParser';
import { colors, radius, spacing, type } from '../src/theme';

/** QR scanner — accepts the same link formats as manual entry. */
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [invalid, setInvalid] = useState(false);
  const handled = useRef(false);

  if (!permission) return <Screen children={null} />;

  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={[type.h2, { marginBottom: spacing.sm }]}>Camera access</Text>
          <Text style={[type.body, { marginBottom: spacing.lg }]}>
            The camera is only used to scan your test QR code. Nothing is photographed or stored.
          </Text>
          <Button label="Allow camera" onPress={requestPermission} />
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const parsed = parseTestLink(data);
          if (!parsed) {
            setInvalid(true);
            return;
          }
          handled.current = true;
          router.replace({
            pathname: '/t/[token]',
            params: {
              token: parsed.token,
              ...(parsed.apiOverride ? { api: parsed.apiOverride } : {}),
            },
          });
        }}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.bottom}>
        {invalid ? (
          <Text style={styles.invalid}>This QR code is not a test link.</Text>
        ) : (
          <Text style={styles.hint}>Point the camera at the test QR code</Text>
        )}
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
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
    borderColor: colors.brand,
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

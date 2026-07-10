import * as Keychain from 'react-native-keychain';

/**
 * Replaces expo-secure-store with react-native-keychain.
 * Each key maps to its own keychain service so entries never clash.
 */

export async function getItem(key: string): Promise<string | null> {
  const credentials = await Keychain.getGenericPassword({ service: key });
  return credentials ? credentials.password : null;
}

export async function setItem(key: string, value: string): Promise<void> {
  await Keychain.setGenericPassword(key, value, { service: key });
}

export async function deleteItem(key: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: key });
}

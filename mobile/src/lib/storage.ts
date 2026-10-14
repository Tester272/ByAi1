// mobile/src/lib/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_KEY = 'mobileagent:serverUrl';
const DEFAULT_SERVER = 'http://localhost:8787';

export async function getServerUrl(): Promise<string> {
  return (await AsyncStorage.getItem(SERVER_KEY)) || DEFAULT_SERVER;
}

export async function setServerUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(SERVER_KEY, url.trim().replace(/\/$/, ''));
}

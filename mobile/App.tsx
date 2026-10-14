// mobile/App.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AgentClient } from './src/lib/api';
import { getServerUrl, setServerUrl } from './src/lib/storage';
import { theme } from './src/theme';
import ChatScreen from './src/screens/ChatScreen';
import TasksScreen from './src/screens/TasksScreen';
import SettingsScreen from './src/screens/SettingsScreen';

type Tab = 'chat' | 'tasks' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [serverUrl, setServer] = useState<string>('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getServerUrl().then((u) => {
      setServer(u);
      setReady(true);
    });
  }, []);

  const client = useMemo(() => (serverUrl ? new AgentClient(serverUrl) : null), [serverUrl]);

  const onServerChange = async (url: string) => {
    await setServerUrl(url);
    setServer(url);
  };

  if (!ready || !client) {
    return (
      <SafeAreaView style={styles.root}>
        <Text style={styles.loading}>Loading MobileAgent…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <View style={styles.header}>
        <View style={styles.brandDot} />
        <Text style={styles.brand}>MobileAgent</Text>
        <Text style={styles.server} numberOfLines={1}>
          {serverUrl.replace(/^https?:\/\//, '')}
        </Text>
      </View>

      <View style={styles.body}>
        {tab === 'chat' && <ChatScreen client={client} onNeedKey={() => setTab('settings')} />}
        {tab === 'tasks' && <TasksScreen client={client} />}
        {tab === 'settings' && (
          <SettingsScreen client={client} serverUrl={serverUrl} onServerChange={onServerChange} />
        )}
      </View>

      <View style={styles.tabbar}>
        {(['chat', 'tasks', 'settings'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={styles.tab} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t[0].toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  loading: { color: theme.text, padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 8,
  },
  brandDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.accent2 },
  brand: { color: theme.text, fontWeight: '700', fontSize: 16 },
  server: { color: theme.muted, fontSize: 11, marginLeft: 'auto', maxWidth: 140 },
  body: { flex: 1 },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabLabel: { color: theme.muted, fontWeight: '600' },
  tabLabelActive: { color: theme.accent },
});

// mobile/src/screens/SettingsScreen.tsx
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AgentClient, Settings } from '../lib/api';
import { theme } from '../theme';

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'openai-compatible'];

export default function SettingsScreen({
  client,
  serverUrl,
  onServerChange,
}: {
  client: AgentClient;
  serverUrl: string;
  onServerChange: (url: string) => void;
}) {
  const [url, setUrl] = useState(serverUrl);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [composio, setComposio] = useState('');
  const [tavily, setTavily] = useState('');
  const [memories, setMemories] = useState<{ id: string; content: string }[]>([]);
  const [status, setStatus] = useState('');

  const load = async () => {
    try {
      const s: Settings = await client.getSettings();
      setProvider(s.llm.provider || 'openai');
      setModel(s.llm.model || '');
      setBaseUrl(s.llm.baseUrl || '');
      setMemories(await client.getMemories());
      setStatus('connected');
    } catch (e: any) {
      setStatus('error: ' + String(e?.message || e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  const save = async () => {
    try {
      await onServerChange(url);
      const llm: any = { provider, model, baseUrl };
      if (apiKey) llm.apiKey = apiKey;
      const keys: any = {};
      if (composio) keys.composioApiKey = composio;
      if (tavily) keys.tavilyApiKey = tavily;
      await new AgentClient(url).saveSettings({ llm, keys });
      setApiKey('');
      setComposio('');
      setTavily('');
      setStatus('saved');
      load();
    } catch (e: any) {
      setStatus('error: ' + String(e?.message || e));
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.h3}>Server</Text>
        <Text style={styles.hint}>Where your agent server runs (e.g. http://192.168.1.10:8787)</Text>
        <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" />
      </View>
      <View style={styles.card}>
        <Text style={styles.h3}>API keys</Text>
        <Text style={styles.hint}>Bring your own keys. They are stored on your server only.</Text>
        <Text style={styles.label}>Provider</Text>
        <View style={styles.providers}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.pill, provider === p && styles.pillActive]}
              onPress={() => setProvider(p)}
            >
              <Text style={[styles.pillText, provider === p && styles.pillTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Model</Text>
        <TextInput style={styles.input} value={model} onChangeText={setModel} placeholder="gpt-4o-mini" placeholderTextColor={theme.muted} />
        <Text style={styles.label}>Base URL (openai-compatible only)</Text>
        <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} placeholder="https://api.openai.com/v1" placeholderTextColor={theme.muted} autoCapitalize="none" />
        <Text style={styles.label}>LLM API key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey} placeholder="sk-…" placeholderTextColor={theme.muted} secureTextEntry autoCapitalize="none" />
        <Text style={styles.label}>Composio API key (any app)</Text>
        <TextInput style={styles.input} value={composio} onChangeText={setComposio} placeholder="optional" placeholderTextColor={theme.muted} secureTextEntry autoCapitalize="none" />
        <Text style={styles.label}>Tavily API key (web search)</Text>
        <TextInput style={styles.input} value={tavily} onChangeText={setTavily} placeholder="optional" placeholderTextColor={theme.muted} secureTextEntry autoCapitalize="none" />
        <TouchableOpacity style={styles.button} onPress={save}>
          <Text style={styles.buttonText}>Save</Text>
        </TouchableOpacity>
        <Text style={styles.status}>{status}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.h3}>Memory</Text>
        {memories.length === 0 ? (
          <Text style={styles.hint}>Nothing remembered yet.</Text>
        ) : (
          memories.map((m) => (
            <Text key={m.id} style={styles.memory}>
              • {m.content}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 40 },
  card: {
    margin: 14,
    padding: 14,
    borderRadius: theme.radius,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 6,
  },
  h3: { color: theme.text, fontWeight: '700', fontSize: 16 },
  label: { color: theme.muted, fontSize: 13, marginTop: 6 },
  hint: { color: theme.muted, fontSize: 12 },
  input: {
    backgroundColor: theme.panel2,
    color: theme.text,
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: theme.border,
  },
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.panel2,
    borderWidth: 1,
    borderColor: theme.border,
  },
  pillActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  pillText: { color: theme.muted, fontSize: 13 },
  pillTextActive: { color: '#fff', fontWeight: '600' },
  button: {
    backgroundColor: theme.accent,
    padding: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  status: { color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
  memory: { color: theme.text, fontSize: 13, paddingVertical: 3 },
});

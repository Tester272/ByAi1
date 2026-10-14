// mobile/src/screens/ChatScreen.tsx
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AgentClient, ChatMessage } from '../lib/api';
import { theme } from '../theme';

type Bubble = { id: string; role: 'user' | 'assistant' | 'tool' | 'error'; text: string };

let counter = 0;
const nextId = () => `b${++counter}`;

export default function ChatScreen({
  client,
  onNeedKey,
}: {
  client: AgentClient;
  onNeedKey: () => void;
}) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<ChatMessage[]>([]);
  const listRef = useRef<FlatList<Bubble>>(null);

  const push = (b: Omit<Bubble, 'id'>) => setBubbles((prev) => [...prev, { id: nextId(), ...b }]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    push({ role: 'user', text });
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    setBusy(true);
    try {
      const result = await client.runAgent(historyRef.current);
      for (const ev of result.events || []) {
        if (ev.type === 'tool' && ev.name) {
          push({
            role: 'tool',
            text: `${ev.error ? '⚠' : '→'} ${ev.name}(${JSON.stringify(ev.args || {})})`,
          });
        }
      }
      const answer = result.content || '(no answer)';
      push({ role: 'assistant', text: answer });
      historyRef.current = [...historyRef.current, { role: 'assistant', content: answer }];
    } catch (err: any) {
      const msg = String(err?.message || err);
      push({ role: 'error', text: msg });
      if (/API key/i.test(msg)) onNeedKey();
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={bubbles}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your on-device AI agent</Text>
            <Text style={styles.emptyText}>
              Ask it to read any website, call any API, use connected apps, or start a long task.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, styles[item.role]]}>
            <Text style={[styles.bubbleText, item.role === 'tool' && styles.toolText]}>{item.text}</Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Ask your agent to do something…"
          placeholderTextColor={theme.muted}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!busy}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={styles.send} onPress={send} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 14, gap: 10, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTitle: { color: theme.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: theme.muted, textAlign: 'center' },
  bubble: { maxWidth: '88%', padding: 11, borderRadius: theme.radius },
  user: { alignSelf: 'flex-end', backgroundColor: theme.accent, borderBottomRightRadius: 4 },
  assistant: {
    alignSelf: 'flex-start',
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
    borderBottomLeftRadius: 4,
  },
  tool: {
    alignSelf: 'flex-start',
    backgroundColor: '#101725',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#2b3a52',
  },
  error: { alignSelf: 'stretch', backgroundColor: 'rgba(255,92,114,0.12)' },
  bubbleText: { color: theme.text },
  toolText: { color: theme.muted, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: theme.panel,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontSize: 18 },
});

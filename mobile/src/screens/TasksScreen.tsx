// mobile/src/screens/TasksScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AgentClient, Task } from '../lib/api';
import { statusColor, theme } from '../theme';

export default function TasksScreen({ client }: { client: AgentClient }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState('25');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTasks(await client.listTasks());
      setError(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  const create = async () => {
    if (!goal.trim()) return;
    try {
      await client.createTask(goal.trim(), Number(steps) || 25);
      setGoal('');
      refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.label}>New long task</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Research topic X and write a report"
          placeholderTextColor={theme.muted}
          value={goal}
          onChangeText={setGoal}
          multiline
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.steps]}
            value={steps}
            onChangeText={setSteps}
            keyboardType="number-pad"
          />
          <TouchableOpacity style={styles.button} onPress={create}>
            <Text style={styles.buttonText}>Create task</Text>
          </TouchableOpacity>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.hint}>
              No tasks yet. Long tasks run in the background on your server and survive restarts.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Text style={styles.goal}>{item.goal}</Text>
              <View style={styles.meta}>
                <Text style={[styles.badge, { color: statusColor[item.status] || theme.muted }]}>
                  {item.status.toUpperCase()}
                </Text>
                <Text style={styles.hint}>
                  step {item.steps}/{item.max_steps}
                </Text>
              </View>
              {item.result?.text ? <Text style={styles.result}>{item.result.text}</Text> : null}
              {item.error ? <Text style={styles.error}>{item.error}</Text> : null}
              <View style={styles.actions}>
                {['queued', 'running', 'paused'].includes(item.status) && (
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.dangerBtn]}
                    onPress={() => client.cancelTask(item.id).then(refresh)}
                  >
                    <Text style={styles.dangerText}>Cancel</Text>
                  </TouchableOpacity>
                )}
                {['paused', 'failed', 'cancelled'].includes(item.status) && (
                  <TouchableOpacity
                    style={styles.smallBtn}
                    onPress={() => client.resumeTask(item.id).then(refresh)}
                  >
                    <Text style={styles.buttonText}>Resume</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: {
    margin: 14,
    padding: 14,
    borderRadius: theme.radius,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 8,
  },
  label: { color: theme.muted, fontSize: 13 },
  input: {
    backgroundColor: theme.panel2,
    color: theme.text,
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: theme.border,
  },
  steps: { width: 80 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    backgroundColor: theme.accent,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  list: { paddingHorizontal: 14, paddingBottom: 30, gap: 10 },
  item: {
    backgroundColor: theme.panel,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 6,
  },
  goal: { color: theme.text, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { fontWeight: '700', fontSize: 11 },
  hint: { color: theme.muted, fontSize: 12 },
  result: {
    color: theme.text,
    fontSize: 13,
    backgroundColor: '#101725',
    padding: 8,
    borderRadius: 8,
    maxHeight: 180,
  },
  error: { color: theme.danger, fontSize: 13, paddingHorizontal: 14 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  smallBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: theme.panel2,
    borderWidth: 1,
    borderColor: '#2b3a52',
  },
  dangerBtn: { backgroundColor: 'rgba(255,92,114,0.15)', borderColor: theme.danger },
  dangerText: { color: theme.danger, fontWeight: '600' },
});

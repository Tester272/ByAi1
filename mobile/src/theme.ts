// mobile/src/theme.ts
export const theme = {
  bg: '#0b0f17',
  panel: '#131a26',
  panel2: '#1a2333',
  border: '#1e2635',
  text: '#e6edf7',
  muted: '#8b98ad',
  accent: '#4f8cff',
  accent2: '#23d18b',
  danger: '#ff5c72',
  warn: '#ffb020',
  radius: 16,
};

export const statusColor: Record<string, string> = {
  queued: theme.muted,
  running: theme.accent,
  done: theme.accent2,
  paused: theme.warn,
  failed: theme.danger,
  cancelled: theme.danger,
};

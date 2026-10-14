// server/src/util/logger.js
const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
const order = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[level] ?? 20;

const fmt = (lvl, args) => {
  const ts = new Date().toISOString();
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  return `[${ts}] ${lvl.toUpperCase()} ${line}`;
};

export const log = {
  debug: (...a) => min <= 10 && console.log(fmt('debug', a)),
  info: (...a) => min <= 20 && console.log(fmt('info', a)),
  warn: (...a) => min <= 30 && console.warn(fmt('warn', a)),
  error: (...a) => min <= 40 && console.error(fmt('error', a)),
};

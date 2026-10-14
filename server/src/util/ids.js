// server/src/util/ids.js
import { randomUUID } from 'node:crypto';

export const id = (prefix = '') =>
  (prefix ? `${prefix}_` : '') + randomUUID().replace(/-/g, '').slice(0, 20);

export const now = () => Date.now();

import { createHash } from 'node:crypto';

export class ValidationError extends Error {}
export const CHANGE_TYPES = ['Added', 'Removed', 'Replaced', 'Revision', 'Quantity', 'Unit', 'Reference', 'Moved', 'Description'];
const fail = message => { throw new ValidationError(message); };
const text = (v, label, max = 500) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`${label} must be a nonempty string (max ${max})`);
  return v;
};
const date = (v, label) => {
  text(v, label);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) fail(`${label} must be an ISO timestamp with timezone`);
};
export function validateHeader(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) fail('Snapshot must be an object');
  for (const key of ['id', 'name', 'partNumber', 'revision', 'source', 'configuration']) text(s[key], key);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(s.id)) fail('Snapshot id contains unsupported characters');
  if (!['eBOM', 'mBOM', 'aBOM'].includes(s.type)) fail('type must be eBOM, mBOM or aBOM');
  if (!['Released', 'Unreleased'].includes(s.releaseStatus)) fail('releaseStatus must be Released or Unreleased');
  if (s.serialNumber != null) text(s.serialNumber, 'serialNumber');
  if (s.type === 'aBOM' && !s.serialNumber) fail('aBOM must identify an exact serialNumber');
  date(s.capturedAt, 'capturedAt');
  if (typeof s.synthetic !== 'boolean') fail('synthetic must explicitly be true or false');
  if (s.nodeCount != null && (!Number.isInteger(s.nodeCount) || s.nodeCount < 0)) fail('nodeCount must be a nonnegative integer');
  if (!s.synthetic && (!Number.isInteger(s.nodeCount) || s.nodeCount < 1 || s.nodeCount > 20000)) fail('Live snapshots must declare source nodeCount (1–20,000)');
  return s;
}
export function validateSnapshot(input) {
  const s = validateHeader(structuredClone(input));
  if (!Array.isArray(s.nodes) || !s.nodes.length || s.nodes.length > 20000) fail('nodes must contain 1–20,000 occurrences');
  // Detect disagreement with the upstream count. A count recomputed from truncated rows cannot prove completeness.
  if (s.nodeCount != null && s.nodeCount !== s.nodes.length) fail(`Snapshot declares nodeCount ${s.nodeCount} but contains ${s.nodes.length} occurrences: incomplete or truncated extraction`);
  const ids = new Map(), keys = new Set();
  for (const n of s.nodes) {
    if (!n || typeof n !== 'object') fail('Each node must be an object');
    for (const key of ['id', 'partNumber', 'revision', 'name', 'unit']) text(n[key], `node.${key}`);
    if (ids.has(n.id)) fail(`Duplicate occurrence id: ${n.id}`);
    if (n.parentId !== null) text(n.parentId, 'parentId');
    if (n.occurrenceKey != null) {
      text(n.occurrenceKey, 'occurrenceKey');
      if (keys.has(n.occurrenceKey)) fail(`Duplicate canonical occurrenceKey: ${n.occurrenceKey}`);
      keys.add(n.occurrenceKey);
    }
    if (typeof n.quantity !== 'number' || !Number.isFinite(n.quantity) || n.quantity < 0) fail(`Invalid quantity on ${n.id}`);
    if (!Array.isArray(n.refDes) || n.refDes.some(r => typeof r !== 'string' || !r.trim() || r.length > 100)) fail(`refDes must be a string array on ${n.id}`);
    // Unsplit lists ("R1,R2") and padded values ("R1 ") silently become different designators. Normalize upstream.
    if (n.refDes.some(r => r !== r.trim() || /[,;|\s]/.test(r))) fail(`refDes on ${n.id} must contain one trimmed designator per entry (no spaces or list delimiters)`);
    if (new Set(n.refDes).size !== n.refDes.length) fail(`Duplicate refDes on ${n.id}`);
    if (!Array.isArray(n.records)) fail(`records must be an array on ${n.id}`);
    const recordIds = new Set();
    for (const r of n.records) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) fail(`Each record must be an object on ${n.id}`);
      for (const key of ['id', 'type', 'status', 'summary', 'source']) text(r[key], `record.${key}`, 3000);
      const key = JSON.stringify([r.source,r.id]);
      if (recordIds.has(key)) fail(`Duplicate source record ${r.id} on ${n.id}`);
      recordIds.add(key);
      if (!['explains', 'related'].includes(r.relationship)) fail('record.relationship must be explains or related');
      // Optional explicit scope: which change types the source says this record accounts for, and which serial it applies to.
      if (r.changes != null && (!Array.isArray(r.changes) || !r.changes.length || r.changes.some(c => !CHANGE_TYPES.includes(c)) || new Set(r.changes).size !== r.changes.length)) fail(`record.changes on ${n.id} must list distinct change types: ${CHANGE_TYPES.join(', ')}`);
      if (r.serialNumber != null) text(r.serialNumber, 'record.serialNumber');
      if (r.url != null) {
        let u; try { u = new URL(r.url); } catch { fail('Invalid record URL'); }
        if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('Record URLs must be HTTP(S) without credentials');
      }
    }
    ids.set(n.id, n);
  }
  if (s.nodes.filter(n => n.parentId === null).length !== 1) fail('Snapshot must have exactly one root occurrence');
  for (const n of s.nodes) {
    const seen = new Set(); let p = n;
    while (p) {
      if (seen.has(p.id)) fail(`Cycle at ${p.id}`);
      seen.add(p.id);
      if (seen.size > 128) fail('Assembly depth exceeds 128');
      if (p.parentId !== null && !ids.has(p.parentId)) fail(`Missing parent ${p.parentId}`);
      p = ids.get(p.parentId);
    }
  }
  return s;
}
export function header(s) { const { nodes, ...h } = s; return { ...h, nodeCount: nodes?.length ?? s.nodeCount }; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function fingerprint(s) {
  return createHash('sha256').update(JSON.stringify(canonical(s))).digest('hex');
}

/**
 * Room data-access + business logic. All mutations are validated here; the
 * server simply broadcasts the result of `getState`. Activity-feed events are
 * stored structurally (key + params) so the client renders them per locale.
 */
import { customAlphabet } from 'nanoid';
import db from './db.js';
import { divideQuran } from './quran.js';
import { PartState, RoomState, FeedEntry, ExportData, Assignee } from './types.js';

// Human-friendly codes (no ambiguous 0/O/1/I).
const genCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const genToken = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 24);

export const MAX_PARTICIPANTS = 604; // one per page, hard ceiling
const MAX_FEED = 60;

const now = () => Date.now();

interface RoomRow {
  code: string;
  admin_token: string;
  participant_count: number;
  dedication: string | null;
  status: 'lobby' | 'active' | 'completed';
  created_at: number;
  completed_at: number | null;
}

interface PartRow {
  code: string;
  idx: number;
  data_json: string;
  assignee_id: string | null;
  assignee_nm: string | null;
  assignee_did: string | null;
  status: 'open' | 'in_progress' | 'done';
  started_at: number | null;
  ended_at: number | null;
}

function logEvent(code: string, key: string, params: Record<string, string | number> = {}): void {
  db.prepare('INSERT INTO events (code, message, at) VALUES (?,?,?)').run(code, JSON.stringify({ key, params }), now());
}

/** Register/refresh a participant in the room's roster (idempotent on the key). */
function upsertParticipant(code: string, id: string, name: string, displayId: string): void {
  db.prepare(
    'INSERT INTO participants (code, participant_id, name, display_id, joined_at) VALUES (?,?,?,?,?) ' +
      'ON CONFLICT(code, participant_id) DO UPDATE SET name = excluded.name, display_id = excluded.display_id'
  ).run(code, id, name, displayId || null, now());
}

function readParticipants(code: string): Assignee[] {
  const rows = db
    .prepare('SELECT participant_id, name, display_id FROM participants WHERE code = ? ORDER BY joined_at ASC')
    .all(code) as { participant_id: string; name: string; display_id: string | null }[];
  return rows.map((r) => ({ id: r.participant_id, name: r.name, displayId: r.display_id || '' }));
}

export function getRoom(code: string): RoomRow | undefined {
  return db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as RoomRow | undefined;
}

function requireRoom(code: string): RoomRow {
  const room = getRoom(code);
  if (!room) throw new Error('NO_ROOM');
  return room;
}

function getPart(code: string, idx: number): PartRow | undefined {
  return db.prepare('SELECT * FROM parts WHERE code = ? AND idx = ?').get(code, idx) as PartRow | undefined;
}

/**
 * Create a room in the 'lobby' phase. The number is just an expected target for
 * progress display — the Quran is NOT divided yet. Division happens later in
 * `startKhatmah`, based on the count the admin confirms once people have joined.
 */
export function createRoom(opts: { participantCount: number; dedication?: string }): { code: string; adminToken: string } {
  const target = Math.min(MAX_PARTICIPANTS, Math.max(1, Math.floor(Number(opts.participantCount) || 0)));
  if (!target) throw new Error('BAD_COUNT');

  let code = genCode();
  while (getRoom(code)) code = genCode();
  const adminToken = genToken();

  db.prepare(
    'INSERT INTO rooms (code, admin_token, participant_count, dedication, status, created_at) VALUES (?,?,?,?,?,?)'
  ).run(code, adminToken, target, (opts.dedication || '').trim() || null, 'lobby', now());
  logEvent(code, 'room_created', { count: target });

  return { code, adminToken };
}

/** Register a participant in the lobby (idempotent on reconnect/rename). */
export function joinLobby(opts: { code: string; name: string; participantId: string; displayId?: string }): void {
  requireRoom(opts.code);
  const name = (opts.name || '').trim();
  const id = (opts.participantId || '').trim();
  const displayId = (opts.displayId || '').trim();
  if (!name) throw new Error('NO_NAME');
  if (!id) throw new Error('NO_ID');

  const existing = db.prepare('SELECT 1 FROM participants WHERE code = ? AND participant_id = ?').get(opts.code, id);
  upsertParticipant(opts.code, id, name, displayId);
  if (!existing) logEvent(opts.code, 'lobby_joined', { name });
}

/**
 * Admin-only: divide the Quran into `count` parts and move the room from 'lobby'
 * to 'active'. `count` is what the admin confirms (defaults on the client to the
 * number of joined participants). Parts are created open for claiming.
 */
export function startKhatmah(opts: { code: string; adminToken?: string; count: number }): void {
  const room = assertAdmin(opts.code, opts.adminToken);
  if (room.status !== 'lobby') throw new Error('ALREADY_STARTED');
  const count = Math.min(MAX_PARTICIPANTS, Math.max(1, Math.floor(Number(opts.count) || 0)));
  if (!count) throw new Error('BAD_COUNT');

  const parts = divideQuran(count);
  const insertPart = db.prepare('INSERT INTO parts (code, idx, data_json, status) VALUES (?,?,?,?)');
  db.transaction(() => {
    for (const p of parts) insertPart.run(opts.code, p.index, JSON.stringify(p), 'open');
    db.prepare('UPDATE rooms SET status = ?, participant_count = ? WHERE code = ?').run('active', count, opts.code);
  })();
  logEvent(opts.code, 'khatmah_started', { count });
}

function refreshStatus(code: string): void {
  const room = requireRoom(code);
  const rows = db.prepare('SELECT status FROM parts WHERE code = ?').all(code) as { status: string }[];
  const allDone = rows.length > 0 && rows.every((r) => r.status === 'done');
  if (allDone && room.status !== 'completed') {
    db.prepare('UPDATE rooms SET status = ?, completed_at = ? WHERE code = ?').run('completed', now(), code);
    logEvent(code, 'completed');
  } else if (!allDone && room.status === 'completed') {
    db.prepare('UPDATE rooms SET status = ?, completed_at = NULL WHERE code = ?').run('active', code);
  }
}

export function joinRoom(opts: {
  code: string;
  name: string;
  participantId: string;
  displayId?: string;
}): { partIndex: number; rejoined: boolean } {
  requireRoom(opts.code);
  const name = (opts.name || '').trim();
  const id = (opts.participantId || '').trim();
  const displayId = (opts.displayId || '').trim();
  if (!name) throw new Error('NO_NAME');
  if (!id) throw new Error('NO_ID');
  upsertParticipant(opts.code, id, name, displayId); // keep the roster complete for late/active joiners

  const existing = db.prepare('SELECT idx FROM parts WHERE code = ? AND assignee_id = ?').get(opts.code, id) as
    | { idx: number }
    | undefined;
  if (existing) {
    db.prepare('UPDATE parts SET assignee_nm = ?, assignee_did = ? WHERE code = ? AND assignee_id = ?').run(name, displayId || null, opts.code, id);
    return { partIndex: existing.idx, rejoined: true };
  }

  const open = db
    .prepare('SELECT idx FROM parts WHERE code = ? AND assignee_id IS NULL ORDER BY idx ASC LIMIT 1')
    .get(opts.code) as { idx: number } | undefined;
  if (!open) throw new Error('FULL');

  db.prepare('UPDATE parts SET assignee_id = ?, assignee_nm = ?, assignee_did = ? WHERE code = ? AND idx = ?').run(id, name, displayId || null, opts.code, open.idx);
  logEvent(opts.code, 'joined', { name, id: displayId, index: open.idx });
  return { partIndex: open.idx, rejoined: false };
}

// Owner-only: start/end/pass act on a participant's own part. Admins manage
// parts through releasePart/resetRoom instead, not by reading others' parts.
function authorizePart(code: string, index: number, participantId?: string): PartRow {
  requireRoom(code);
  const part = getPart(code, index);
  if (!part) throw new Error('NO_PART');
  if (!part.assignee_id || part.assignee_id !== (participantId || '').trim()) throw new Error('NOT_YOURS');
  return part;
}

export function startPart(opts: { code: string; index: number; participantId?: string }): void {
  const part = authorizePart(opts.code, opts.index, opts.participantId);
  if (part.status === 'done') throw new Error('ALREADY_DONE');
  db.prepare('UPDATE parts SET status = ?, started_at = ?, ended_at = NULL WHERE code = ? AND idx = ?').run(
    'in_progress',
    now(),
    opts.code,
    opts.index
  );
  logEvent(opts.code, 'started', { name: part.assignee_nm || '', id: part.assignee_did || '', index: opts.index });
  refreshStatus(opts.code);
}

export function endPart(opts: { code: string; index: number; participantId?: string }): void {
  const part = authorizePart(opts.code, opts.index, opts.participantId);
  if (part.status !== 'in_progress') throw new Error('NOT_STARTED');
  db.prepare('UPDATE parts SET status = ?, ended_at = ? WHERE code = ? AND idx = ?').run('done', now(), opts.code, opts.index);
  logEvent(opts.code, 'ended', { name: part.assignee_nm || '', id: part.assignee_did || '', index: opts.index });
  refreshStatus(opts.code);
}

function assertAdmin(code: string, adminToken?: string): RoomRow {
  const room = requireRoom(code);
  if (!adminToken || adminToken !== room.admin_token) throw new Error('NOT_ADMIN');
  return room;
}

/** Clear a part's assignment and reset it to open (shared by release & pass). */
function openPart(code: string, index: number): void {
  db.prepare(
    'UPDATE parts SET assignee_id = NULL, assignee_nm = NULL, assignee_did = NULL, status = ?, started_at = NULL, ended_at = NULL WHERE code = ? AND idx = ?'
  ).run('open', code, index);
}

export function releasePart(opts: { code: string; index: number; adminToken?: string }): void {
  assertAdmin(opts.code, opts.adminToken);
  const part = getPart(opts.code, opts.index);
  if (!part) throw new Error('NO_PART');
  // A completed reading must not be undone via release (use resetRoom instead).
  if (part.status === 'done') throw new Error('ALREADY_DONE');
  openPart(opts.code, opts.index);
  logEvent(opts.code, 'released', { index: opts.index });
  refreshStatus(opts.code);
}

/**
 * Take an additional open part. Allowed only when the participant has no other
 * unfinished part (completed parts don't count) — finish or pass your current
 * part before claiming another.
 */
export function claimPart(opts: { code: string; index: number; name: string; participantId: string; displayId?: string }): void {
  requireRoom(opts.code);
  const name = (opts.name || '').trim();
  const id = (opts.participantId || '').trim();
  const displayId = (opts.displayId || '').trim();
  if (!name) throw new Error('NO_NAME');
  if (!id) throw new Error('NO_ID');

  const part = getPart(opts.code, opts.index);
  if (!part) throw new Error('NO_PART');
  if (part.assignee_id !== null) throw new Error('TAKEN');

  const active = db
    .prepare("SELECT COUNT(*) AS n FROM parts WHERE code = ? AND assignee_id = ? AND status != 'done'")
    .get(opts.code, id) as { n: number };
  if (active.n > 0) throw new Error('HAS_ACTIVE');

  db.prepare('UPDATE parts SET assignee_id = ?, assignee_nm = ?, assignee_did = ? WHERE code = ? AND idx = ?').run(id, name, displayId || null, opts.code, opts.index);
  logEvent(opts.code, 'claimed', { name, id: displayId, index: opts.index });
}

/** Owner (or admin) releases an unfinished part so it re-opens for anyone. */
export function passPart(opts: { code: string; index: number; participantId?: string }): void {
  const part = authorizePart(opts.code, opts.index, opts.participantId);
  if (part.status === 'done') throw new Error('ALREADY_DONE');
  logEvent(opts.code, 'passed', { name: part.assignee_nm || '', id: part.assignee_did || '', index: opts.index });
  openPart(opts.code, opts.index);
  refreshStatus(opts.code);
}

export function resetRoom(opts: { code: string; adminToken?: string }): void {
  assertAdmin(opts.code, opts.adminToken);
  db.prepare(
    'UPDATE parts SET assignee_id = NULL, assignee_nm = NULL, status = ?, started_at = NULL, ended_at = NULL WHERE code = ?'
  ).run('open', opts.code);
  db.prepare('UPDATE rooms SET status = ?, completed_at = NULL WHERE code = ?').run('active', opts.code);
  logEvent(opts.code, 'reset');
}

function readParts(code: string): PartState[] {
  const partRows = db.prepare('SELECT * FROM parts WHERE code = ? ORDER BY idx ASC').all(code) as PartRow[];
  return partRows.map((r) => ({
    ...JSON.parse(r.data_json),
    index: r.idx,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_nm || '', displayId: r.assignee_did || '' } : null,
  }));
}

export function getState(code: string): RoomState {
  const room = requireRoom(code);
  const parts = readParts(code);
  const feedRows = db
    .prepare('SELECT message, at FROM events WHERE code = ? ORDER BY id DESC LIMIT ?')
    .all(code, MAX_FEED) as { message: string; at: number }[];
  const feed: FeedEntry[] = feedRows.map((e) => ({ ...JSON.parse(e.message), at: e.at }));

  return {
    code: room.code,
    status: room.status,
    participantCount: room.participant_count,
    dedication: room.dedication,
    createdAt: room.created_at,
    completedAt: room.completed_at,
    assignedCount: parts.filter((p) => p.assignee).length,
    doneCount: parts.filter((p) => p.status === 'done').length,
    totalParts: parts.length,
    parts,
    participants: readParticipants(code),
    feed,
  };
}

/** Full, uncapped snapshot of a room for archival/proof export. */
export function getExport(code: string): ExportData {
  const room = requireRoom(code);
  const parts = readParts(code);
  const eventRows = db
    .prepare('SELECT message, at FROM events WHERE code = ? ORDER BY id ASC')
    .all(code) as { message: string; at: number }[];
  const events: FeedEntry[] = eventRows.map((e) => ({ ...JSON.parse(e.message), at: e.at }));

  return {
    code: room.code,
    status: room.status,
    participantCount: room.participant_count,
    dedication: room.dedication,
    createdAt: room.created_at,
    completedAt: room.completed_at,
    parts,
    events,
  };
}

/**
 * Admin-only: export the completed khatmah as a permanent record, then delete
 * it (room, parts, events) from the database. Only allowed once every part is
 * done — the caller relies on the returned snapshot being the surviving proof.
 */
export function closeKhatmah(opts: { code: string; adminToken?: string }): ExportData {
  const room = assertAdmin(opts.code, opts.adminToken);
  if (room.status !== 'completed') throw new Error('NOT_COMPLETED');
  const data = getExport(opts.code);
  db.transaction(() => {
    db.prepare('DELETE FROM parts WHERE code = ?').run(opts.code);
    db.prepare('DELETE FROM events WHERE code = ?').run(opts.code);
    db.prepare('DELETE FROM participants WHERE code = ?').run(opts.code);
    db.prepare('DELETE FROM rooms WHERE code = ?').run(opts.code);
  })();
  return data;
}

// Shared domain types for the khatmah app.

export type Script = 'uthmani' | 'indopak';

export interface AyahText {
  uthmani: string;
  indopak: string;
}

export interface AyahRef {
  surahNo: number;
  surahName: string; // Arabic
  surahTranslit: string; // Latin transliteration
  ayah: number;
  page: number; // Madani 604-page mushaf
  text: AyahText; // start/end ayah text in both scripts
}

export interface SurahRef {
  number: number;
  name: string; // Arabic
  translit: string;
}

export type PartStatus = 'open' | 'in_progress' | 'done';

export interface PartDescriptor {
  index: number;
  juzFrom: number;
  juzTo: number;
  startAyahId: number;
  endAyahId: number;
  start: AyahRef;
  end: AyahRef;
  pageFrom: number;
  pageTo: number;
  surahsCovered: SurahRef[];
}

export interface Assignee {
  id: string;
  name: string;
}

export interface PartState extends PartDescriptor {
  status: PartStatus;
  startedAt: number | null;
  endedAt: number | null;
  assignee: Assignee | null;
}

// Structured so the client can render the feed in any locale.
export interface FeedEntry {
  key: string;
  params: Record<string, string | number>;
  at: number;
}

export type RoomStatus = 'active' | 'completed';

export interface RoomState {
  code: string;
  status: RoomStatus;
  participantCount: number;
  dedication: string | null;
  createdAt: number;
  completedAt: number | null;
  assignedCount: number;
  doneCount: number;
  totalParts: number;
  parts: PartState[];
  feed: FeedEntry[];
}

// A complete, permanent record of a khatmah — produced when an admin exports
// the khatmah "as proof" just before it is deleted from the database. Unlike
// RoomState.feed (capped), `events` holds the full activity log.
export interface ExportData {
  code: string;
  status: RoomStatus;
  participantCount: number;
  dedication: string | null;
  createdAt: number;
  completedAt: number | null;
  parts: PartState[];
  events: FeedEntry[];
}

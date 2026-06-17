/**
 * Quran division logic for the khatmah.
 *
 * The juz'/surah/ayah split is identical across all mushaf layouts worldwide;
 * only page numbering/print script differ. We use `quran-meta` for the
 * authoritative juz' boundaries and Madani (604-page) page numbers, and attach
 * each boundary ayah's text in both scripts (Uthmani & Indo-Pak).
 *
 * A "part" is a contiguous slice assigned to one participant. For N <= 30 we
 * split along whole-juz' boundaries (the authentic khatmah unit); for N > 30 we
 * split evenly by ayah count so it never breaks.
 */
import * as qm from 'quran-meta/hafs';
import { surahRef, ayahText } from './quranData.js';
import { AyahRef, PartDescriptor } from './types.js';

const NUM_AYAHS = qm.meta.numAyahs; // 6236
const NUM_JUZS = qm.meta.numJuzs; // 30

/** Split `total` units across `parts` groups as evenly as possible. */
export function evenSplit(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

function ayahRef(ayahId: number): AyahRef {
  const [surahNo, ayah] = qm.findSurahAyahByAyahId(ayahId);
  const s = surahRef(surahNo);
  return {
    surahNo,
    surahName: s.name,
    surahTranslit: s.translit,
    ayah,
    page: qm.findPagebyAyahId(ayahId),
    text: ayahText(surahNo, ayah),
  };
}

function describeRange(
  index: number,
  startAyahId: number,
  endAyahId: number,
  juzFrom: number,
  juzTo: number
): PartDescriptor {
  const start = ayahRef(startAyahId);
  const end = ayahRef(endAyahId);
  const surahsCovered = [];
  for (let s = start.surahNo; s <= end.surahNo; s++) surahsCovered.push(surahRef(s));

  return {
    index,
    juzFrom,
    juzTo,
    startAyahId,
    endAyahId,
    start,
    end,
    pageFrom: start.page,
    pageTo: end.page,
    surahsCovered,
  };
}

/** Divide the whole Quran into `count` contiguous parts. */
export function divideQuran(count: number): PartDescriptor[] {
  const n = Math.max(1, Math.floor(count));
  const parts: PartDescriptor[] = [];

  if (n <= NUM_JUZS) {
    const sizes = evenSplit(NUM_JUZS, n);
    let juz = 1;
    for (let i = 0; i < n; i++) {
      const juzFrom = juz;
      const juzTo = juz + sizes[i] - 1;
      const startAyahId = qm.JuzList[juzFrom];
      const endAyahId = qm.JuzList[juzTo + 1] - 1;
      parts.push(describeRange(i + 1, startAyahId, endAyahId, juzFrom, juzTo));
      juz = juzTo + 1;
    }
  } else {
    const sizes = evenSplit(NUM_AYAHS, n);
    let ayahId = 1;
    for (let i = 0; i < n; i++) {
      const startAyahId = ayahId;
      const endAyahId = ayahId + sizes[i] - 1;
      parts.push(
        describeRange(i + 1, startAyahId, endAyahId, qm.findJuzByAyahId(startAyahId), qm.findJuzByAyahId(endAyahId))
      );
      ayahId = endAyahId + 1;
    }
  }
  return parts;
}

export { NUM_AYAHS, NUM_JUZS };

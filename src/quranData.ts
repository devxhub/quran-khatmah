// Loads the bundled, offline Quran datasets (built by scripts/fetch-data.js).
import fs from 'fs';
import path from 'path';
import { Script, AyahText, SurahRef } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');

function loadJson<T>(file: string): T {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing data file ${file}. Run "npm run fetch-data" first.`);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
}

type AyahMap = Record<string, string>; // "surah:ayah" -> text
interface SurahMeta {
  id: number;
  ar: string;
  tr: string;
  totalVerses: number;
}

const uthmani = loadJson<AyahMap>('text-uthmani.json');
const indopak = loadJson<AyahMap>('text-indopak.json');
const surahs = loadJson<SurahMeta[]>('surahs.json');

const surahById = new Map<number, SurahMeta>(surahs.map((s) => [s.id, s]));

export function surahName(surahNo: number): string {
  return surahById.get(surahNo)?.ar ?? `سورة ${surahNo}`;
}

export function surahTranslit(surahNo: number): string {
  return surahById.get(surahNo)?.tr ?? `Surah ${surahNo}`;
}

export function surahRef(surahNo: number): SurahRef {
  return { number: surahNo, name: surahName(surahNo), translit: surahTranslit(surahNo) };
}

export function ayahText(surahNo: number, ayah: number): AyahText {
  const key = `${surahNo}:${ayah}`;
  return { uthmani: uthmani[key] ?? '', indopak: indopak[key] ?? '' };
}

export function getText(script: Script, surahNo: number, ayah: number): string {
  return ayahText(surahNo, ayah)[script];
}

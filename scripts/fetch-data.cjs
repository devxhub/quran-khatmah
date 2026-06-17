'use strict';
/*
 * One-time data builder. Downloads the Quran text editions + surah metadata
 * from reachable GitHub raw sources and writes compact lookup files into
 * /data so the running app has zero network dependency.
 *
 * Run: node scripts/fetch-data.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const SRC = {
  uthmani: 'https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions/ara-quranuthmanihaf.json',
  indopak: 'https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions/ara-quranindopak.json',
  surahs: 'https://raw.githubusercontent.com/risan/quran-json/main/dist/chapters/index.json',
};

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

// Turn {quran:[{chapter,verse,text}]} into { "s:a": "text" }.
function toAyahMap(edition) {
  const map = {};
  for (const v of edition.quran) map[`${v.chapter}:${v.verse}`] = v.text;
  return map;
}

(async () => {
  console.log('Fetching Uthmani/Madani edition...');
  const uthmani = toAyahMap(await get(SRC.uthmani));
  console.log('Fetching Indo-Pak edition...');
  const indopak = toAyahMap(await get(SRC.indopak));
  console.log('Fetching surah metadata...');
  const chapters = await get(SRC.surahs);
  const surahs = chapters.map((c) => ({ id: c.id, ar: c.name, tr: c.transliteration, totalVerses: c.total_verses }));

  fs.writeFileSync(path.join(DATA_DIR, 'text-uthmani.json'), JSON.stringify(uthmani));
  fs.writeFileSync(path.join(DATA_DIR, 'text-indopak.json'), JSON.stringify(indopak));
  fs.writeFileSync(path.join(DATA_DIR, 'surahs.json'), JSON.stringify(surahs, null, 2));

  console.log(`Done. uthmani=${Object.keys(uthmani).length} indopak=${Object.keys(indopak).length} surahs=${surahs.length}`);
})().catch((e) => {
  console.error('fetch-data failed:', e.message);
  process.exit(1);
});

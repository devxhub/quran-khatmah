# Quran Khatmah 📖

A real-time, collaborative web app for completing a **khatmah** (a full reading of
the Quran) as a group. An admin creates a room and sets the number of
participants; the app divides the Quran into that many contiguous parts. Each
person joins with their name + ID, claims a part, and presses **Start** / **Finish**
— everyone sees live progress, who is reading what, and a celebration when the
whole khatmah is complete.

## Features

- **Real-time, multi-device** — each person on their own phone via a shared room code; progress syncs instantly (Socket.IO).
- **Authentic division** — splits the **30 juz'** into N even contiguous parts (falls back to an even ayah-count split if participants > 30).
- **Two Quran scripts** — toggle each part's start/end ayah between **Madani / Uthmani** and **Indo-Pak** orthography (for readers from Bangladesh, Pakistan, India, etc.).
- **Per part:** juz' range, surah names (Arabic + transliteration), start & end ayah (with text), and Madani **page numbers**.
- **Per-part lifecycle** — Start → live elapsed timer → Finish, broadcast to all.
- **Live board, progress bar, activity feed**, and a "Khatmah completed 🎉" banner.
- **Multilingual UI** — English & Bangla today (Urdu/Arabic + RTL drop in via locale files).
- **Persistence** — SQLite; refresh/reconnect restores your part and the room.
- **Simple admin** — the room creator gets an admin link and can reset or release parts.

## Tech

TypeScript · Node + Express · Socket.IO · SQLite (better-sqlite3) · vanilla JS front-end.
Quran metadata comes from [`quran-meta`](https://www.npmjs.com/package/quran-meta);
ayah text & surah names are pre-fetched into `/data` (offline at runtime).

## Run without Docker

```bash
npm install
npm run fetch-data   # one-time: builds /data (needs network)
npm run build        # compile TypeScript -> dist/
npm start            # http://localhost:3000
```

> `/data/*.json` is committed, so `fetch-data` is only needed to refresh the datasets.

## Run with Docker

```bash
docker compose up --build      # http://localhost:3000
```

The SQLite database is stored on a named volume (`khatmah-db`) so it survives restarts.

## Configuration

| Env var   | Default              | Description                |
| --------- | -------------------- | -------------------------- |
| `PORT`    | `3000`               | HTTP port                  |
| `DB_PATH` | `./khatmah.db`       | SQLite file location       |

## How it's used

1. **Admin** opens the app → *Start a new khatmah* → sets participant count (+ optional dedication) → shares the room code / invite link.
2. **Participants** open the link → enter name + ID → get the next available part.
3. Each reader presses **Start**, reads, then **Finish**.
4. When every part is done, everyone sees **"The khatmah is complete 🎉"**.

## Project layout

```
src/            TypeScript backend
  quran.ts        juz'/ayah division logic
  quranData.ts    loads bundled datasets
  rooms.ts        room/part business logic + SQLite
  db.ts           SQLite setup
  server.ts       Express + Socket.IO wiring
  types.ts        shared domain types
data/           bundled Quran datasets (built by scripts/fetch-data.cjs)
scripts/        one-time data builder
```

import path from 'path';
import http from 'http';
import express from 'express';
import { Server, Socket } from 'socket.io';
import * as rooms from './rooms.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(process.cwd(), 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT) || 3000;

function broadcast(code: string): void {
  try {
    io.to(code).emit('state', rooms.getState(code));
  } catch {
    /* room gone */
  }
}

type Ack = (res: Record<string, unknown>) => void;

io.on('connection', (socket: Socket) => {
  // Wrap a handler: thrown Error messages are returned as i18n keys via ack.
  const handle =
    (fn: (payload: any) => Record<string, unknown> | void) =>
    (payload: any, ack?: Ack): void => {
      try {
        const result = fn(payload || {}) || {};
        ack?.({ ok: true, ...result });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'ERROR' });
      }
    };

  socket.on(
    'createRoom',
    handle((p) => rooms.createRoom(p))
  );

  socket.on(
    'joinRoom',
    handle((p) => {
      const res = rooms.joinRoom(p);
      socket.join(p.code);
      socket.data.code = p.code;
      broadcast(p.code);
      return { partIndex: res.partIndex, rejoined: res.rejoined, state: rooms.getState(p.code) };
    })
  );

  // Watch a room without claiming a part (e.g. a shared display screen).
  socket.on(
    'watchRoom',
    handle((p) => {
      const state = rooms.getState(p.code); // throws NO_ROOM if missing
      socket.join(p.code);
      socket.data.code = p.code;
      return { state };
    })
  );

  socket.on(
    'startPart',
    handle((p) => {
      rooms.startPart(p);
      broadcast(p.code);
    })
  );

  socket.on(
    'endPart',
    handle((p) => {
      rooms.endPart(p);
      broadcast(p.code);
    })
  );

  socket.on(
    'releasePart',
    handle((p) => {
      rooms.releasePart(p);
      broadcast(p.code);
    })
  );

  // Take an additional open part (after finishing/passing your current one).
  socket.on(
    'claimPart',
    handle((p) => {
      rooms.claimPart(p);
      broadcast(p.code);
    })
  );

  // Stop & pass an unfinished part back to the pool for someone else.
  socket.on(
    'passPart',
    handle((p) => {
      rooms.passPart(p);
      broadcast(p.code);
    })
  );

  socket.on(
    'resetRoom',
    handle((p) => {
      rooms.resetRoom(p);
      broadcast(p.code);
    })
  );

  socket.on(
    'getState',
    handle((p) => ({ state: rooms.getState(p.code) }))
  );

  // Admin exports the completed khatmah as proof, then it is deleted. Notify
  // everyone still in the room so they return home.
  socket.on(
    'closeKhatmah',
    handle((p) => {
      const data = rooms.closeKhatmah(p);
      io.to(p.code).emit('closed', { code: p.code });
      return { export: data };
    })
  );
});

server.listen(PORT, () => {
  console.log(`Quran Khatmah running on http://localhost:${PORT}`);
});

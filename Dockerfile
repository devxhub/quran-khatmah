# ---- build + run in one slim image ----
FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 compiles a native addon; needs a toolchain at install time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY data ./data

RUN npm run build && npm prune --omit=dev

# SQLite file lives on a writable volume so data survives restarts.
RUN mkdir -p /app/db
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/db/khatmah.db

EXPOSE 3000
CMD ["node", "dist/server.js"]

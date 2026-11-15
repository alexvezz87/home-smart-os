FROM node:20-bookworm-slim

ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    iproute2 \
    iputils-ping \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_${TARGETARCH}" -o /usr/local/bin/go2rtc \
  && chmod +x /usr/local/bin/go2rtc

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

RUN mkdir -p /app/data /app/bin /app/public/snapshots /app/logs

ENV NODE_ENV=production
ENV PORT=3000
ENV GO2RTC_BIN=/usr/local/bin/go2rtc

EXPOSE 3000 1984 8554 8555/tcp 8555/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/status/health || exit 1

CMD ["node", "server.js"]

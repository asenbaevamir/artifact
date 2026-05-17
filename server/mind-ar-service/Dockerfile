# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-bullseye-slim AS builder

# Build deps for: sharp (libvips), canvas (cairo/pango)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    cmake \
    libvips-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY package.json package-lock.json ./

# Install ALL deps (including devDeps for build)
RUN npm ci --build-from-source

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:20-bullseye-slim AS production

LABEL org.opencontainers.image.title="MindAR Microservice" \
      org.opencontainers.image.description="AR target (.mind) compilation service" \
      org.opencontainers.image.version="1.0.1"

# Runtime shared libraries for sharp and canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    fftw3 \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libpixman-1-0 \
    dumb-init \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app

COPY package.json package-lock.json ./

# Install production deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ cmake \
        libvips-dev libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev pkg-config && \
    npm ci --omit=dev --build-from-source && \
    apt-get purge -y --auto-remove python3 make g++ cmake pkg-config && \
    rm -rf /var/lib/apt/lists/* && \
    npm cache clean --force

COPY --from=builder /build/dist ./dist

RUN mkdir -p uploads results logs && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

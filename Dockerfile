# =============================================================================
# Multi-Stage Production Dockerfile for CI-Fixer
# =============================================================================
# Stage 1: Builder - Generate Prisma client and build frontend
# =============================================================================
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies (Alpine packages)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev deps for building)
RUN npm install --ignore-scripts || \
    npm install --force --ignore-scripts

# Copy source code (needed for frontend build)
# Note: With optimized .dockerignore, this is now only ~8MB instead of 8.9GB
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build frontend (Vite)
RUN npm run build

# =============================================================================
# Stage 2: Runner - Production image with minimal footprint
# =============================================================================
FROM node:20-alpine AS runner

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/
COPY tsconfig.json ./

# Create Docker-specific tsconfig for proper ESM resolution
RUN echo '{"extends":"./tsconfig.json","compilerOptions":{"moduleResolution":"node"}}' > tsconfig.docker.json

# Install production dependencies + tsx for TypeScript execution
RUN npm install --production --force --ignore-scripts || \
    npm install --production --force && \
    npm cache clean --force && \
    npm install -g tsx && \
    npm install js-yaml --force

# Regenerate Prisma Client in runner stage
RUN npx prisma generate

# Copy all source files from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/*.ts ./
COPY --from=builder --chown=nodejs:nodejs /app/services ./services
COPY --from=builder --chown=nodejs:nodejs /app/agent ./agent
COPY --from=builder --chown=nodejs:nodejs /app/conductor ./conductor
COPY --from=builder --chown=nodejs:nodejs /app/utils ./utils
COPY --from=builder --chown=nodejs:nodejs /app/db ./db
COPY --from=builder --chown=nodejs:nodejs /app/telemetry ./telemetry
COPY --from=builder --chown=nodejs:nodejs /app/config ./config

# Switch to non-root user
USER nodejs

# Expose the API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server using tsx with Docker-specific tsconfig
ENV TSX_TSCONFIG_PATH=/app/tsconfig.docker.json
CMD ["tsx", "server.ts"]

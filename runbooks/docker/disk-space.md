---
category: "docker_error"
priority: "critical"
success_count: 0
last_updated: "2025-12-13"
fingerprint: "docker_disk_space"
tags: ["docker", "disk", "storage", "github-actions"]
---

# Fix: Docker Disk Space Error

## Diagnosis

This error occurs when the Docker build process runs out of disk space, commonly in GitHub Actions runners.

**Error patterns:**
```
no space left on device
Error: ENOSPC: no space left on device
docker: write /var/lib/docker/...: no space left on device
```

**Common causes:**
- Accumulated Docker images and layers
- Large build artifacts
- Insufficient runner disk space (GitHub Actions: ~14GB available)

## Solution

### 1. Add cleanup step to GitHub Actions workflow

**Before build steps:**
```yaml
- name: Free Disk Space
  run: |
    docker system prune -af --volumes
    sudo rm -rf /usr/share/dotnet
    sudo rm -rf /opt/ghc
    sudo rm -rf "/usr/local/share/boost"
    df -h
```

### 2. Use multi-stage builds

Reduce final image size:

```dockerfile
# Build stage
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --production
CMD ["node", "dist/index.js"]
```

### 3. Add .dockerignore

Prevent unnecessary files from being copied:

```
node_modules
.git
.env
*.log
coverage
dist
```

## Code Template

**GitHub Actions workflow addition:**
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Add this step BEFORE docker build
      - name: Free Disk Space
        run: |
          docker system prune -af --volumes
          sudo rm -rf /usr/share/dotnet
          sudo rm -rf /opt/ghc
          df -h
      
      - name: Build Docker Image
        run: docker build -t myapp .
```

## Success Rate

Applied 0 times. Initial template.

## Prevention

- Use `--no-cache` flag sparingly
- Regularly clean up old images
- Monitor disk usage in CI logs
- Use smaller base images (alpine, slim variants)

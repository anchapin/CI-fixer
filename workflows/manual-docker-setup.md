---
title: "Manual Docker Setup"
category: "infrastructure"
requires_user: true
estimated_time: "5-10 minutes"
---

# Manual Docker Setup

This workflow guides you through setting up Docker for local CI-fixer execution when the agent cannot automatically configure the environment.

## When to Use

- Error: `Docker daemon not running`
- Error: `Cannot connect to Docker socket`
- Error: `docker: command not found`
- Agent suggests: "Manual Docker setup required"

## Prerequisites

- Windows 10/11, macOS, or Linux
- Administrator/sudo access
- Internet connection

## Steps

### 1. Install Docker Desktop

**Windows (PowerShell as Admin):**
```bash
winget install Docker.DockerDesktop
```

**macOS:**
```bash
brew install --cask docker
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Start Docker Desktop

**Windows/macOS:**
- Launch Docker Desktop from Start Menu/Applications
- Wait for "Docker Desktop is running" status

**Linux:**
```bash
sudo systemctl start docker
sudo systemctl enable docker
```

### 3. Verify Installation

```bash
docker --version
docker ps
```

**Expected output:**
```
Docker version 24.x.x, build xxxxx
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```

### 4. Configure CI-fixer

Update `.env.local` in your CI-fixer directory:

```bash
EXECUTION_STRATEGY=local_docker
DOCKER_IMAGE=node:20-bullseye
```

### 5. Test Docker Integration

```bash
cd path/to/CI-fixer
npm run test:integration -- docker_sandbox.test.ts
```

**Expected output:**
```
✓ should create Docker sandbox
✓ should run commands in Docker
```

## Troubleshooting

### Error: Docker daemon not running

**Windows/macOS:**
- Ensure Docker Desktop is running
- Check system tray for Docker icon
- Restart Docker Desktop

**Linux:**
```bash
sudo systemctl status docker
sudo systemctl restart docker
```

### Error: Permission denied (Linux)

```bash
sudo usermod -aG docker $USER
newgrp docker
# Or logout and login again
```

### Error: WSL 2 installation incomplete (Windows)

```bash
wsl --install
wsl --set-default-version 2
```

Restart computer after WSL installation.

### Error: No space left on device

```bash
docker system prune -af --volumes
```

## Verification

After setup, run:

```bash
docker run hello-world
```

If successful, Docker is properly configured and CI-fixer can use it.

## Next Steps

1. Restart CI-fixer: `npm run dev`
2. Trigger an agent run
3. Verify agent uses Docker sandbox in logs

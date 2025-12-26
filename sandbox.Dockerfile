FROM nikolaik/python-nodejs:python3.12-nodejs22-bullseye

# Set environment variables
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"
ENV GO_VERSION="1.22.5"
ENV PATH="/usr/local/go/bin:$PATH"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    unzip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Install Go
RUN curl -fsSL https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz | tar -C /usr/local -xzf -

# Install additional package managers
RUN npm install -g pnpm && \
    pip install poetry

# Install test runners
RUN pip install pytest tox && \
    npm install -g vitest jest mocha

# Set working directory
WORKDIR /workspace

# Default command
CMD ["tail", "-f", "/dev/null"]


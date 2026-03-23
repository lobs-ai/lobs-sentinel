FROM node:22-slim

# Install gh CLI
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Default config location
ENV CONFIG_PATH=/app/config.yaml

ENTRYPOINT ["node", "dist/main.js"]
CMD ["--mode", "reviewer"]

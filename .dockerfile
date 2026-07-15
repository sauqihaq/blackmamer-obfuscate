FROM node:18-slim

# Install Lua, Luarocks, dan dependencies
RUN apt-get update && apt-get install -y \
    lua5.1 \
    luarocks \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install LuaFileSystem (dibutuhkan Prometheus)
RUN luarocks install luafilesystem

# Clone Prometheus
RUN git clone https://github.com/prometheus-lua/Prometheus.git /opt/render/project/src/Prometheus

WORKDIR /opt/render/project/src

# Copy package.json dan install Node dependencies
COPY package*.json ./
RUN npm install

# Copy server.js
COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]

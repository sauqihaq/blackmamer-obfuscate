FROM node:18-slim

# Install Lua dan dependencies
RUN apt-get update && apt-get install -y \
    lua5.1 \
    luarocks \
    git \
    && rm -rf /var/lib/apt/lists/*

# Clone Prometheus
RUN git clone https://github.com/prometheus-lua/Prometheus.git /app/Prometheus

# Install LuaRocks dependencies untuk Prometheus
RUN cd /app/Prometheus && \
    luarocks install luafilesystem && \
    luarocks install argparse

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
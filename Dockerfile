# Base image ringan dengan Lua
FROM alpine:latest

# Install Lua dan tools yang dibutuhkan
RUN apk add --no-cache lua5.3 git

# Bikin symlink 'lua' -> 'lua5.3' biar bisa dipanggil cukup dengan "lua"
RUN ln -sf /usr/bin/lua5.3 /usr/bin/lua

# Clone Prometheus (versi Lua obfuscator)
RUN git clone https://github.com/wcrddn/Prometheus.git /app/prometheus

WORKDIR /app

# Copy source Node.js
COPY server.js package.json ./

# Install Node.js dan dependencies
RUN apk add --no-cache nodejs npm
RUN npm install --omit=dev

# Expose port
EXPOSE 10000

# Jalankan server
CMD ["node", "server.js"]

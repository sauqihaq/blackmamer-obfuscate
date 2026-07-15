# Base image ringan dengan Lua
FROM alpine:latest

# Install Lua dan tools yang dibutuhkan
RUN apk add --no-cache lua5.3 lua-file-mapper git

# Clone Prometheus (versi Lua)
RUN git clone https://github.com/wcrddn/Prometheus.git /app/prometheus

# Copy server.js dan public folder
WORKDIR /app
COPY server.js package.json ./
COPY public ./public

# Install Node.js dan dependencies
RUN apk add --no-cache nodejs npm
RUN npm install

# Expose port
EXPOSE 10000

# Jalankan server
CMD ["node", "server.js"]

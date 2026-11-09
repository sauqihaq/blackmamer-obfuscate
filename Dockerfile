# C++ native bytecode sealer is a build-time backend dependency.
# The generated Roblox/Luau code does not load or execute native binaries.
FROM alpine:3.21 AS native-build
RUN apk add --no-cache g++
WORKDIR /build
COPY native/sealer.cpp ./
RUN g++ -O2 -std=c++17 -Wall -Wextra -Werror sealer.cpp -o bm-sealer

FROM alpine:3.21
RUN apk add --no-cache lua5.3 git nodejs npm libstdc++
RUN ln -sf /usr/bin/lua5.3 /usr/bin/lua
WORKDIR /app
# Legacy Prometheus presets still require upstream Lua CLI.
RUN git clone --depth 1 https://github.com/wcrddn/Prometheus.git /app/prometheus

COPY server.js blackmamer-vm.js blackmamer-vm2.js blackmamer-vm3.js \
  lua-output-compact.js native-sealer.js package.json roblox-strong.lua ./
COPY --from=native-build /build/bm-sealer /app/native/bm-sealer
RUN chmod +x /app/native/bm-sealer && npm install --omit=dev

ENV BLACKMAMER_REQUIRE_NATIVE=1
EXPOSE 10000
CMD ["node", "server.js"]

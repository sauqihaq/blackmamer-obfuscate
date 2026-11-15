# BLACKMAMER Maximum V4 outer VM + pinned upstream Prometheus inner VM.
# Upstream source is fetched ONLY at build time and remains in the image.
# Attribution: Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus
FROM alpine:3.21 AS native-build
RUN apk add --no-cache g++
WORKDIR /build
COPY native/sealer.cpp ./
RUN g++ -O2 -std=c++17 -Wall -Wextra -Werror sealer.cpp -o bm-sealer

FROM alpine:3.21 AS prometheus-build
RUN apk add --no-cache git ca-certificates
WORKDIR /build
RUN mkdir prometheus && cd prometheus && git init -q && \
    git remote add origin https://github.com/prometheus-lua/Prometheus.git && \
    git fetch -q --depth 1 origin a98c50165f2a53f6d765a82eee60dfea53803445 && \
    git checkout -q --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "a98c50165f2a53f6d765a82eee60dfea53803445" && \
    rm -rf .git

FROM alpine:3.21
RUN apk add --no-cache nodejs npm libstdc++ lua5.1 luajit
WORKDIR /app
COPY server.js blackmamer-vm3.js vm7-independent.js vm4-deadcode-optimizer.js vm4-chained-cells.js runtime-security-policy.js prometheus-stage.js full-prometheus-pipeline.js luau-compat-lowering.js prometheus-maximal.lua prometheus-compat-patch.js ast-string-layer.js lua-output-compact.js runtime-polymorph.js v4-presets.js license-format.js native-sealer.js \
  protected-functions.js commercial-access.js runtime-key-vault.js package.json ./
COPY --from=native-build /build/bm-sealer /app/native/bm-sealer
COPY --from=prometheus-build /build/prometheus /app/vendor/prometheus
RUN node prometheus-compat-patch.js
RUN chmod +x /app/native/bm-sealer && npm install --omit=dev --no-audit --no-fund
RUN node --check luau-compat-lowering.js && node --check server.js && node -e "require('./blackmamer-vm3');require('./vm4-deadcode-optimizer');require('./vm4-chained-cells');require('./runtime-security-policy');require('./full-prometheus-pipeline');if(!require('./prometheus-stage').available())process.exit(1)"
ENV BLACKMAMER_REQUIRE_NATIVE=1
# LuaJIT accelerates the compiler process; output dialect remains selected by --LuaU/--Lua51.
ENV BLACKMAMER_PROMETHEUS_LUA=luajit
ENV BLACKMAMER_PROMETHEUS_TIMEOUT_MS=75000
EXPOSE 10000
CMD ["node", "server.js"]

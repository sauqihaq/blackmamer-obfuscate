# Independent BLACKMAMER V4-only backend. Prometheus is not installed or bundled.
FROM alpine:3.21 AS native-build
RUN apk add --no-cache g++
WORKDIR /build
COPY native/sealer.cpp ./
RUN g++ -O2 -std=c++17 -Wall -Wextra -Werror sealer.cpp -o bm-sealer

FROM alpine:3.21
RUN apk add --no-cache nodejs npm libstdc++
WORKDIR /app
COPY server.js blackmamer-vm3.js lua-output-compact.js native-sealer.js \
  protected-functions.js commercial-access.js runtime-key-vault.js package.json ./
COPY --from=native-build /build/bm-sealer /app/native/bm-sealer
RUN chmod +x /app/native/bm-sealer && npm install --omit=dev --no-audit --no-fund
ENV BLACKMAMER_REQUIRE_NATIVE=1
EXPOSE 10000
CMD ["node", "server.js"]

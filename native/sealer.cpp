// BLACKMAMER native build-time bytecode sealer (C++17).
// Runs ONLY on the backend. Roblox executes generated Luau, never C++.
// Binary protocol v1: BMVP | version:u8 | count:u32le | sbox[256] |
//   repeated (seed:u16le, length:u32le, bytes[length]).
// Response: BMVO | version:u8 | count:u32le | repeated (length:u32le, sealed[length]).
// This is obfuscating byte substitution, NOT secret-key cryptography.
#include <array>
#include <cstdint>
#include <iostream>
#include <vector>

namespace {
constexpr std::uint32_t kMaxItems = 8192;
constexpr std::uint32_t kMaxEntry = 16 * 1024 * 1024;
constexpr std::uint64_t kMaxAll = 64 * 1024 * 1024;

bool readByte(std::uint8_t &v) {
  char c;
  if (!std::cin.get(c)) return false;
  v = static_cast<std::uint8_t>(c);
  return true;
}
bool readLE(std::uint32_t &v, int count) {
  v = 0;
  for (int i = 0; i < count; ++i) {
    std::uint8_t b;
    if (!readByte(b)) return false;
    v |= static_cast<std::uint32_t>(b) << (8 * i);
  }
  return true;
}
void writeLE(std::uint32_t v, int count) {
  for (int i = 0; i < count; ++i) std::cout.put(static_cast<char>((v >> (8 * i)) & 255));
}
void seal(std::vector<std::uint8_t> &data, std::uint32_t seed,
          const std::array<std::uint8_t, 256> &sbox) {
  std::uint32_t state = seed;
  std::uint8_t previous = 0;
  for (std::size_t i = 0; i < data.size(); ++i) {
    const auto j = i + 1;
    state = (state * 73 + 41 + (j % 251)) % 65521;
    const auto mask = static_cast<std::uint8_t>((state & 255) ^ ((state >> 8) & 255));
    const auto encoded = static_cast<std::uint8_t>(sbox[data[i]] ^ mask ^ previous);
    data[i] = previous = encoded;
  }
}
} // namespace

int main() {
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);
  char magic[4] = {};
  if (!std::cin.read(magic, 4) || magic[0] != 'B' || magic[1] != 'M' ||
      magic[2] != 'V' || magic[3] != 'P') return 2;
  std::uint8_t version;
  std::uint32_t count;
  if (!readByte(version) || version != 1 || !readLE(count, 4) || count > kMaxItems) return 2;
  std::array<std::uint8_t, 256> sbox{};
  for (auto &b : sbox) if (!readByte(b)) return 2;
  std::array<bool, 256> seen{};
  for (const auto b : sbox) {
    if (seen[b]) return 2;
    seen[b] = true;
  }
  std::vector<std::vector<std::uint8_t>> results;
  results.reserve(count);
  std::uint64_t total = 0;
  for (std::uint32_t i = 0; i < count; ++i) {
    std::uint32_t seed, length;
    if (!readLE(seed, 2) || !readLE(length, 4) || length > kMaxEntry ||
        (total += length) > kMaxAll) return 2;
    std::vector<std::uint8_t> data(length);
    if (length && !std::cin.read(reinterpret_cast<char *>(data.data()), length)) return 2;
    seal(data, seed, sbox);
    results.push_back(std::move(data));
  }
  char extra;
  if (std::cin.get(extra)) return 2;
  std::cout.write("BMVO", 4);
  std::cout.put(static_cast<char>(1));
  writeLE(count, 4);
  for (const auto &data : results) {
    writeLE(static_cast<std::uint32_t>(data.size()), 4);
    if (!data.empty()) std::cout.write(reinterpret_cast<const char *>(data.data()), data.size());
  }
  return std::cout.good() ? 0 : 2;
}

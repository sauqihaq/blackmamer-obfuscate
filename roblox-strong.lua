-- BLACKMAMER STUDIO RobloxStrong pipeline.
-- Based on Prometheus by Elias Oelschner,
-- https://github.com/prometheus-lua/Prometheus
--
-- Single full-program Vmify for Luau plus constant-array and numeric obfuscation.
-- Upstream AntiTamper and EncryptStrings are disabled here: their randomized
-- behavior has produced incorrect output in Luau CLI compatibility tests.
-- The compiler and Vmify are still from Prometheus (not proprietary).
return {
  LuaVersion = "LuaU",
  VarNamePrefix = "",
  NameGenerator = "MangledShuffled",
  PrettyPrint = false,
  Seed = 0,
  Steps = {
    { Name = "Vmify", Settings = {} },
    { Name = "ConstantArray", Settings = {
      Threshold = 1,
      StringsOnly = true,
      Shuffle = true,
      Rotate = true,
      LocalWrapperThreshold = 0
    }},
    { Name = "NumbersToExpressions", Settings = {
      NumberRepresentationMutation = true
    }},
    { Name = "WrapInFunction", Settings = {} }
  }
}

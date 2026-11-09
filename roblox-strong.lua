-- BLACKMAMER STUDIO RobloxStrong pipeline.
-- Based on Prometheus by Elias Oelschner,
-- https://github.com/prometheus-lua/Prometheus
--
-- A single full-program Vmify pass avoids Strong's second nested VM,
-- while retaining anti-tamper, string encryption, and constant mutation.
-- The compiler and Vmify are still from Prometheus (not proprietary).
return {
  LuaVersion = "LuaU",
  VarNamePrefix = "",
  NameGenerator = "MangledShuffled",
  PrettyPrint = false,
  Seed = 0,
  Steps = {
    { Name = "EncryptStrings", Settings = {} },
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

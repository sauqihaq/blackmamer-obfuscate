-- BLACKMAMER FULL PROMETHEUS INNER LAYER
-- Every distinct obfuscation step available in pinned upstream Strong/Medium
-- is enabled. Cff ExcludeVm limits redundant flattening *inside* Vmify
-- while applying control-flow flattening to non-VM code.
return {
  LuaVersion = "Lua51",
  VarNamePrefix = "",
  NameGenerator = "MangledShuffled",
  PrettyPrint = false,
  Seed = 0,
  Steps = {
    { Name = "Vmify", Settings = {} },
    { Name = "EncryptStrings", Settings = { HoistVmStrings = true } },
    { Name = "AntiTamper", Settings = { UseDebug = false } },
    { Name = "ConstantArray", Settings = {
      Threshold = 1,
      StringsOnly = true,
      Shuffle = true,
      Rotate = true,
      LocalWrapperThreshold = 0
    } },
    { Name = "WrapInFunction", Settings = {} },
    { Name = "Cff", Settings = { ExcludeVm = true } },
    { Name = "NumbersToExpressions", Settings = {
      NumberRepresentationMutation = false
    } }
  }
}

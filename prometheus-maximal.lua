-- BLACKMAMER x PROMETHEUS EXTENDED FULL FEATURE STACK
-- All 11 standard registered steps in pinned upstream are enabled.
-- Cff skips flattening the VM interpreter itself (ExcludeVm), to avoid
-- redundant nested dispatch expansion while still flattening surrounding code.
return {
  LuaVersion = "Lua51",
  VarNamePrefix = "",
  NameGenerator = "MangledShuffled",
  PrettyPrint = false,
  Seed = 0,
  Steps = {
    { Name = "SplitStrings", Settings = {
      Threshold = 0.35, MinLength = 3, MaxLength = 8,
      ConcatenationType = "custom", CustomFunctionType = "local",
      CustomLocalFunctionsCount = 2
    } },
    { Name = "Vmify", Settings = {} },
    { Name = "EncryptStrings", Settings = { HoistVmStrings = true } },
    { Name = "AntiTamper", Settings = { UseDebug = false } },
    { Name = "ConstantArray", Settings = {
      Threshold = 1, StringsOnly = true,
      Shuffle = true, Rotate = true, LocalWrapperThreshold = 0
    } },
    { Name = "ProxifyLocals", Settings = { LiteralType = "string" } },
    { Name = "WrapInFunction", Settings = {} },
    { Name = "Cff", Settings = { ExcludeVm = true } },
    { Name = "NumbersToExpressions", Settings = {
      NumberRepresentationMutation = false
    } },
    { Name = "WatermarkCheck", Settings = {
      Content = "BLACKMAMER STUDIO - FULL PROTECTION"
    } },
    { Name = "AddVararg", Settings = {} }
  }
}

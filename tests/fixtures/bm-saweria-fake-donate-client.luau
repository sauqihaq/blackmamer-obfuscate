local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local Root = ReplicatedStorage:WaitForChild("BM Saweria")
local Config = require(Root:WaitForChild("Config"))
local MainModule = Root:WaitForChild("MainModule")
local Remotes = require(MainModule:WaitForChild("Remotes"))

local function isAdmin()
	for _, userId in ipairs(Config.Admins.UserIds or {}) do
		if player.UserId == tonumber(userId) then return true end
	end
	for _, username in ipairs(Config.Admins.Usernames or {}) do
		if player.Name:lower() == tostring(username):lower() then return true end
	end
	return false
end

if not Config.FakeDonate.Enabled or not isAdmin() then
	return
end

local playerGui = player:WaitForChild("PlayerGui")
local guiFolder = playerGui:WaitForChild("BM Saweria Gui", math.huge)
local fakeGui = guiFolder:WaitForChild("BMFakeDonate")
local panel = fakeGui:WaitForChild("BMFD_Panel")
panel.Visible = false

-- Auto-scale responsif (sama pola kayak BMSaweriaGui): UIScale ngikutin ViewportSize
local function updateScale()
	local camera = workspace.CurrentCamera
	if not camera then return end
	local viewport = camera.ViewportSize
	local panelScale = panel:FindFirstChild("BMFDResponsiveScale")
	if not panelScale then
		panelScale = Instance.new("UIScale")
		panelScale.Name = "BMFDResponsiveScale"
		panelScale.Parent = panel
	end
	if UserInputService.TouchEnabled then
		panelScale.Scale = math.clamp(math.min(viewport.X / 1050, viewport.Y / 720), 0.58, 0.82)
	else
		panelScale.Scale = math.clamp(math.min(viewport.X / 1550, viewport.Y / 920), 0.78, 1)
	end
end

updateScale()
if workspace.CurrentCamera then
	workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(updateScale)
end

local adminInfo = panel:FindFirstChild("BMFD_AdminInfo")
local adminAvatar = adminInfo and adminInfo:FindFirstChild("BMFD_AdminAvatar")
local adminName = adminInfo and adminInfo:FindFirstChild("BMFD_AdminName")
local adminUser = adminInfo and adminInfo:FindFirstChild("BMFD_AdminUser")
local modeSelf = panel:FindFirstChild("BMFD_ModeRow") and panel.BMFD_ModeRow:FindFirstChild("BMFD_ModeSelf")
local modeOther = panel:FindFirstChild("BMFD_ModeRow") and panel.BMFD_ModeRow:FindFirstChild("BMFD_ModeOther")
local targetInput = panel:FindFirstChild("BMFD_TargetInput")
local validateButton = panel:FindFirstChild("BMFD_ValidateBtn")
local targetPreview = panel:FindFirstChild("BMFD_TargetPreview")
local targetAvatar = targetPreview and targetPreview:FindFirstChild("BMFD_TargetAvatar")
local targetName = targetPreview and targetPreview:FindFirstChild("BMFD_TargetName")
local amountInput = panel:FindFirstChild("BMFD_AmountInput")
local messageInput = panel:FindFirstChild("BMFD_MessageInput")
local status = panel:FindFirstChild("BMFD_Status")
local footer = panel:FindFirstChild("BMFD_FooterButton")
local sendButton = footer and footer:FindFirstChild("BMFD_SendBtn")
local effectButton = footer and footer:FindFirstChild("BMFD_EffectToggle")

local targetUsername = player.Name
local selfMode = true
local useEffect = Config.FakeDonate.EffectDefault ~= false

local function setStatus(text, ok)
	if status then
		status.Text = text
		status.TextTransparency = 0
		status.TextColor3 = ok and Color3.fromRGB(130, 255, 170) or Color3.fromRGB(255, 140, 140)
	end
end

local function setTarget(username)
	targetUsername = username
	if targetName then targetName.Text = "@" .. username end
	if targetPreview then targetPreview.Visible = true end

	local okId, userId = pcall(Players.GetUserIdFromNameAsync, Players, username)
	if okId and userId and targetAvatar then
		local okThumb, image = pcall(
			Players.GetUserThumbnailAsync,
			Players,
			userId,
			Enum.ThumbnailType.HeadShot,
			Enum.ThumbnailSize.Size420x420
		)
		if okThumb then targetAvatar.Image = image end
	end
end

if adminName then adminName.Text = player.DisplayName end
if adminUser then adminUser.Text = "@" .. player.Name end
if adminAvatar then
	local ok, image = pcall(
		Players.GetUserThumbnailAsync,
		Players,
		player.UserId,
		Enum.ThumbnailType.HeadShot,
		Enum.ThumbnailSize.Size420x420
	)
	if ok then adminAvatar.Image = image end
end
if amountInput then amountInput.Text = tostring(Config.FakeDonate.DefaultAmount) end
if messageInput then messageInput.Text = Config.FakeDonate.DefaultText end
setTarget(player.Name)

-- Topbar Admin milik BM Saweria.
local Icon = require(Root:WaitForChild("Icon"))
local icon = Icon.new()
	:setName("BMTestDonate")
	:setLabel("Test Donate")
	:setOrder(5)
	:bindEvent("selected", function() panel.Visible = true end)
	:bindEvent("deselected", function() panel.Visible = false end)
if Config.FakeDonate.ButtonImage then
	icon:setImage(Config.FakeDonate.ButtonImage)
end
Icon.new()
	:setName("BMAdmin")
	:setLabel("Admin")
	:setDropdown({icon})

-- Kalau panel ditutup dari dalam panel, tombol di dropdown ikut non-aktif
panel:GetPropertyChangedSignal("Visible"):Connect(function()
	if not panel.Visible and icon.isSelected then
		icon:deselect()
	end
end)

local function selectSelf()
	selfMode = true
	if targetInput then
		targetInput.Text = player.Name
		targetInput.Visible = false
	end
	if validateButton then validateButton.Visible = false end
	setTarget(player.Name)
end

local function selectOther()
	selfMode = false
	if targetInput then
		targetInput.Visible = true
		targetInput.Text = ""
	end
	if validateButton then validateButton.Visible = true end
	if targetPreview then targetPreview.Visible = false end
end

if modeSelf then modeSelf.Activated:Connect(selectSelf) end
if modeOther then modeOther.Activated:Connect(selectOther) end
if validateButton then
	validateButton.Activated:Connect(function()
		local username = targetInput and targetInput.Text or ""
		if username == "" then
			setStatus("Masukkan username Roblox", false)
			return
		end
		local ok = pcall(Players.GetUserIdFromNameAsync, Players, username)
		if not ok then
			setStatus("Username tidak ditemukan", false)
			return
		end
		setTarget(username)
		setStatus("Target valid", true)
	end)
end

if effectButton then
	local function renderEffect()
		effectButton.Text = useEffect and "EFFECT: ON" or "EFFECT: OFF"
	end
	renderEffect()
	effectButton.Activated:Connect(function()
		useEffect = not useEffect
		renderEffect()
	end)
end

if sendButton then
	sendButton.Activated:Connect(function()
		if not selfMode and (not targetUsername or targetUsername == "") then
			setStatus("Validasi target terlebih dahulu", false)
			return
		end
		local amount = math.floor(tonumber(amountInput and amountInput.Text) or 0)
		if amount <= 0 then
			setStatus("Nominal tidak valid", false)
			return
		end

		Remotes.Event("FakeDonateRequest"):FireServer({
			username = targetUsername,
			amount = amount,
			message = messageInput and messageInput.Text or Config.FakeDonate.DefaultText,
			useEffect = useEffect,
		})
		setStatus("Mengirim...", true)
	end)
end

Remotes.OnClientEvent("FakeDonateFeedback"):Connect(function(ok, message)
	setStatus(tostring(message), ok == true)
end)

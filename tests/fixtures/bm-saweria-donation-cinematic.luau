local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local SoundService = game:GetService("SoundService")

local LocalPlayer = Players.LocalPlayer
local Camera = workspace.CurrentCamera

local Root = ReplicatedStorage:WaitForChild("BM Saweria")
local Config = require(Root:WaitForChild("Config"))
local MainModule = Root:WaitForChild("MainModule")
local Remotes = require(MainModule:WaitForChild("Remotes"))

local DonationCinematic = Remotes.Event("DonationCinematic")

local isPlaying = false

local function createLetterboxBars()
	local gui = Instance.new("ScreenGui")
	gui.Name = "DonationLetterbox"
	gui.IgnoreGuiInset = true
	gui.DisplayOrder = 100
	gui.ResetOnSpawn = false

	local topBar = Instance.new("Frame")
	topBar.Name = "TopBar"
	topBar.BackgroundColor3 = Color3.new(0, 0, 0)
	topBar.BorderSizePixel = 0
	topBar.Size = UDim2.new(1, 0, 0, 0)
	topBar.Position = UDim2.new(0, 0, 0, 0)
	topBar.Parent = gui

	local bottomBar = Instance.new("Frame")
	bottomBar.Name = "BottomBar"
	bottomBar.BackgroundColor3 = Color3.new(0, 0, 0)
	bottomBar.BorderSizePixel = 0
	bottomBar.Size = UDim2.new(0, 0, 0, 0)
	bottomBar.Position = UDim2.new(0, 0, 1, 0)
	bottomBar.AnchorPoint = Vector2.new(0, 1)
	bottomBar.Parent = gui

	local shadowLabel = Instance.new("TextLabel")
	shadowLabel.Name = "DonationTextShadow"
	shadowLabel.BackgroundTransparency = 1
	shadowLabel.Size = UDim2.new(1, 0, 0, 70)
	shadowLabel.Position = UDim2.new(0, 4, 1, -95)
	shadowLabel.AnchorPoint = Vector2.new(0, 1)
	shadowLabel.FontFace = Font.new("rbxassetid://122516982241677", Enum.FontWeight.Bold, Enum.FontStyle.Normal)
	shadowLabel.TextScaled = true
	shadowLabel.TextColor3 = Color3.new(0, 0, 0)
	shadowLabel.TextTransparency = 1
	shadowLabel.TextStrokeTransparency = 1
	shadowLabel.Text = ""
	shadowLabel.ZIndex = 1
	shadowLabel.Parent = gui

	local textLabel = Instance.new("TextLabel")
	textLabel.Name = "DonationText"
	textLabel.BackgroundTransparency = 1
	textLabel.Size = UDim2.new(1, 0, 0, 70)
	textLabel.Position = UDim2.new(0, 0, 1, -100)
	textLabel.AnchorPoint = Vector2.new(0, 1)
	textLabel.FontFace = Font.new("rbxassetid://122516982241677", Enum.FontWeight.Bold, Enum.FontStyle.Normal)
	textLabel.TextScaled = true
	textLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
	textLabel.TextStrokeColor3 = Color3.fromRGB(40, 25, 0)
	textLabel.TextStrokeTransparency = 0.2
	textLabel.TextTransparency = 1
	textLabel.Text = ""
	textLabel.ZIndex = 2
	textLabel.Parent = gui

	return gui, topBar, bottomBar, textLabel, shadowLabel
end

local function typeOutText(textLabel, shadowLabel, fullText, charDelay)
	textLabel.TextTransparency = 0
	shadowLabel.TextTransparency = 0.55
	textLabel.Text = ""
	shadowLabel.Text = ""
	for i = 1, #fullText do
		local partial = string.sub(fullText, 1, i)
		textLabel.Text = partial
		shadowLabel.Text = partial
		task.wait(charDelay)
	end
end

local function getFocusPosition(donorPlayer)
	if donorPlayer and donorPlayer.Parent then
		local character = donorPlayer.Character
		local hrp = character and character:FindFirstChild("HumanoidRootPart")
		if hrp then
			return hrp, hrp.Position
		end
	end
	return nil, Config.Positions.Cinematic.Fallback
end

local function playCinematic(donorPlayer, message)
	if isPlaying then return end
	isPlaying = true

	local cfg = Config.Cinematic
	local hrp, focusPos = getFocusPosition(donorPlayer)

	local gui, topBar, bottomBar, textLabel, shadowLabel = createLetterboxBars()
	gui.Parent = LocalPlayer:WaitForChild("PlayerGui")

	local barSize = UDim2.new(1, 0, 0, 90)
	TweenService:Create(topBar, TweenInfo.new(0.5, Enum.EasingStyle.Quad), {Size = barSize}):Play()
	TweenService:Create(bottomBar, TweenInfo.new(0.5, Enum.EasingStyle.Quad), {Size = barSize}):Play()

	local sound
	if cfg.SoundId and cfg.SoundId ~= "rbxassetid://0" then
		sound = Instance.new("Sound")
		sound.SoundId = cfg.SoundId
		sound.Volume = 1
		sound.Parent = SoundService
		sound:Play()
	end

	local animTrack
	if hrp and cfg.AnimationId and cfg.AnimationId ~= "rbxassetid://0" then
		local character = hrp.Parent
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		local animator = humanoid and humanoid:FindFirstChildOfClass("Animator")
		if animator then
			local anim = Instance.new("Animation")
			anim.AnimationId = cfg.AnimationId
			animTrack = animator:LoadAnimation(anim)
			animTrack.Looped = true
			animTrack:Play(cfg.AnimationFadeTime or 0.6)
		end
	end

	Camera.CameraType = Enum.CameraType.Scriptable

	local startTime = os.clock()
	local connection
	connection = RunService.RenderStepped:Connect(function()
		local elapsed = os.clock() - startTime
		if elapsed >= cfg.Duration then
			connection:Disconnect()
			return
		end

		local currentFocus = focusPos
		if hrp and hrp.Parent then
			currentFocus = hrp.Position
		end

		local angle = elapsed * cfg.OrbitSpeed * math.pi * 2
		local offset = Vector3.new(math.cos(angle), 0, math.sin(angle)) * cfg.OrbitRadius
		local camPos = currentFocus + offset + Vector3.new(0, cfg.OrbitHeight, 0)

		Camera.CFrame = CFrame.new(camPos, currentFocus + Vector3.new(0, 1.5, 0))
	end)

	task.wait(0.6)
	task.spawn(typeOutText, textLabel, shadowLabel, message, cfg.TypingSpeed or 0.04)

	task.wait(cfg.Duration - 0.6)

	TweenService:Create(textLabel, TweenInfo.new(0.4), {TextTransparency = 1}):Play()
	TweenService:Create(shadowLabel, TweenInfo.new(0.4), {TextTransparency = 1}):Play()
	TweenService:Create(topBar, TweenInfo.new(0.5, Enum.EasingStyle.Quad), {Size = UDim2.new(1, 0, 0, 0)}):Play()
	local bottomTween = TweenService:Create(bottomBar, TweenInfo.new(0.5, Enum.EasingStyle.Quad), {Size = UDim2.new(1, 0, 0, 0)})
	bottomTween:Play()

	if animTrack then
		animTrack:Stop(cfg.AnimationFadeTime or 0.6)
	end

	Camera.CameraType = Enum.CameraType.Custom

	bottomTween.Completed:Wait()
	gui:Destroy()
	if sound then sound:Destroy() end

	isPlaying = false
end

DonationCinematic.OnClientEvent:Connect(function(donorPlayer, message)
	playCinematic(donorPlayer, message)
end)

-- Small deterministic Roblox mock, only for validating the cinematic script's
-- externally observable behavior. It is NOT Roblox Studio.
local CinematicEvent = {OnClientEvent = {}}
local cinematicHandler
function CinematicEvent.OnClientEvent:Connect(callback)
    cinematicHandler = callback
    return {Disconnect = function() end}
end
local created = {}
Instance = {}
function Instance.new(class)
    local new = {ClassName=class,Destroyed=false}
    function new:Destroy() self.Destroyed=true end
    function new:Play() self.Playing=true end
    table.insert(created,new)
    return new
end
local Root = {}
local MainModule = {}
local Config = {
    Positions={Cinematic={Fallback={X=0,Y=0,Z=0}}},
    Cinematic={Duration=1.5,OrbitSpeed=1,OrbitRadius=8,OrbitHeight=2,
               SoundId="rbxassetid://123", AnimationId="rbxassetid://0",
               TypingSpeed=0, AnimationFadeTime=0.6}
}
function Root:WaitForChild(name)
    if name=="Config" then return "Config" end
    if name=="MainModule" then return MainModule end
    error("unknown root child: "..name)
end
function MainModule:WaitForChild(name)
    if name=="Remotes" then return "Remotes" end
    error("unknown module child: "..name)
end
local Remotes={Event=function(name)
    assert(name=="DonationCinematic")
    return CinematicEvent
end}
require=function(name)
    if name=="Config" then return Config end
    if name=="Remotes" then return Remotes end
    error("unknown require: "..tostring(name))
end
local player={UserId=22,Name="Donor"}
function player:WaitForChild(name)
    assert(name=="PlayerGui")
    return {Name="PlayerGui"}
end
local services={
    Players={LocalPlayer=player},
    ReplicatedStorage={WaitForChild=function(self,name)
        assert(name=="BM Saweria")
        return Root
    end},
    RunService={RenderStepped={Connect=function(self, callback)
        -- The callback is installed; no rendered frame occurs during this
        -- synchronous mock.
        return {Disconnect=function(self) end}
    end}},
    TweenService={Create=function(self, target, info, goals)
        return {
            Completed={Wait=function(self) end},
            Play=function(self)
                for name,value in pairs(goals) do target[name]=value end
            end
        }
    end},
    SoundService={},
}
game={GetService=function(self,name)
    return assert(services[name],"unknown service "..name)
end}
workspace={CurrentCamera={CameraType="Initial"}}
Enum={FontWeight={Bold="Bold"},FontStyle={Normal="Normal"},
    EasingStyle={Quad="Quad"},CameraType={Scriptable="Scriptable",Custom="Custom"}}
local function val(...) return {...} end
UDim2={new=val}
Vector2={new=val}
Vector3={new=val}
Color3={new=val,fromRGB=val}
Font={new=val}
TweenInfo={new=val}
task={wait=function(t)return t end,spawn=function(fn,...)
    return fn(...)
end}
local function reportCinematic()
    assert(cinematicHandler,"Missing DonationCinematic handler")
    cinematicHandler(nil,"Hi")
    local createdCount=#created
    local screen, sound, label
    for _,item in ipairs(created) do
        if item.ClassName=="ScreenGui" then screen=item end
        if item.ClassName=="Sound" then sound=item end
        if item.Name=="DonationText" then label=item end
    end
    print("CINEMATIC_RESULT",workspace.CurrentCamera.CameraType,
        createdCount, screen and screen.Destroyed,
        sound and sound.Destroyed,
        label and label.Text,
        label and label.TextTransparency)
end

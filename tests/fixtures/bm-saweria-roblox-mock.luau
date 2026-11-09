-- Deterministic fake Roblox objects for BM Saweria client
local function signal()
 local events={}
 return {
   Connect=function(self,cb)table.insert(events,cb);return {} end,
   fire=function(self,...)for _,cb in ipairs(events)do cb(...) end end
 }
end
local function obj(children)
 local self={_children=children or {}}
 function self:WaitForChild(name,timeout) return self._children[name] end
 function self:FindFirstChild(name) return self._children[name] end
 function self:GetPropertyChangedSignal(field) return signal() end
 return self
end
local buttons={}
for _,name in ipairs({"BMFD_ModeSelf","BMFD_ModeOther","BMFD_ValidateBtn","BMFD_EffectToggle","BMFD_SendBtn"})do
 buttons[name]=obj();buttons[name].Activated=signal()
end
local row=obj({BMFD_ModeSelf=buttons.BMFD_ModeSelf,BMFD_ModeOther=buttons.BMFD_ModeOther})
local avatar=obj()
local name=obj()
local user=obj()
local info=obj({BMFD_AdminAvatar=avatar,BMFD_AdminName=name,BMFD_AdminUser=user})
local targetAvatar=obj()
local targetName=obj()
local targetPreview=obj({BMFD_TargetAvatar=targetAvatar,BMFD_TargetName=targetName})
local status=obj()
local input=obj()
local amount=obj();amount.Text="10"
local message=obj();message.Text="test"
local footer=obj({BMFD_SendBtn=buttons.BMFD_SendBtn,BMFD_EffectToggle=buttons.BMFD_EffectToggle})
local panel=obj({
 BMFD_AdminInfo=info,BMFD_ModeRow=row,BMFD_TargetInput=input,
 BMFD_ValidateBtn=buttons.BMFD_ValidateBtn,BMFD_TargetPreview=targetPreview,
 BMFD_AmountInput=amount,BMFD_MessageInput=message,BMFD_Status=status,BMFD_FooterButton=footer
})
panel.BMFD_ModeRow=row
local fakeGui=obj({BMFD_Panel=panel})
local guiFolder=obj({BMFakeDonate=fakeGui})
local playerGui=obj({["BM Saweria Gui"]=guiFolder})
local player=obj({PlayerGui=playerGui});player.UserId=100;player.Name="Tester";player.DisplayName="Admin"
local Players={
 LocalPlayer=player,
 GetUserIdFromNameAsync=function(self,username)return 100 end,
 GetUserThumbnailAsync=function(self,userId,kind,size)return "asset:"..tostring(userId) end
}
local root=obj()
local mainModule=obj()
local config={
 Admins={UserIds={2,100},Usernames={"someone"}},
 FakeDonate={Enabled=true,EffectDefault=true,DefaultAmount=27,DefaultText="welcome",ButtonImage="123"}
}
local lastSend=nil
local remotes={
 Event=function(name)return {FireServer=function(self,args)
   lastSend=args
 end}end,
 OnClientEvent=function(name)return signal()end
}
root._children={Config="Config",MainModule=mainModule,Icon="Icon"}
mainModule._children={Remotes="Remotes"}
local Icon={}
function Icon.new()
 local instance={isSelected=false}
 for _,method in ipairs({"setName","setLabel","setOrder","bindEvent","setImage","setDropdown"})do
  instance[method]=function(self,...)return self end
 end
 instance.deselect=function(self) self.isSelected=false end
 return instance
end
require=function(module)
 if module=="Config" then return config end
 if module=="Remotes" then return remotes end
 if module=="Icon" then return Icon end
 error("invalid module")
end
game={GetService=function(self,name)
 if name=="Players" then return Players end
 if name=="ReplicatedStorage" then return obj({["BM Saweria"]=root}) end
 if name=="UserInputService" then return {TouchEnabled=false} end
 error("unknown service "..name)
end}
workspace={CurrentCamera={
 ViewportSize={X=1920,Y=1080},
 GetPropertyChangedSignal=function(self,key)return signal() end
}}
Instance={new=function(name)return obj()end}
Color3={fromRGB=function(r,g,b)return tostring(r)..","..tostring(g)..","..tostring(b)end}
Enum={ThumbnailType={HeadShot=1},ThumbnailSize={Size420x420=2}}

-- The generated test appends a runClient call and exercises the GUI.

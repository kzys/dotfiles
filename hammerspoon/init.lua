local log = hs.logger.new('init.lua','debug')

function createCtrlHotKey(from, mods, to)
   local f = function ()
      hs.eventtap.keyStroke(mods, to, 50000)
   end
   return hs.hotkey.new({'ctrl'}, from, f, nil, f)
end

emacsLike = {
   createCtrlHotKey('p', {}, 'UP'),
   createCtrlHotKey('n', {}, 'DOWN'),
   createCtrlHotKey('b', {}, 'LEFT'),
   createCtrlHotKey('f', {}, 'RIGHT'),

   createCtrlHotKey('e', {'cmd'}, 'RIGHT'),
   createCtrlHotKey('a', {'cmd'}, 'LEFT'),
}

local APPS_TO_FIX = {
   ['Microsoft Outlook'] = true,
   ['Firefox'] = true,
}

function applicationWatcherCallback(appName, eventType, appObject)
   if (APPS_TO_FIX[appName]) then
      if (eventType == hs.application.watcher.activated) then
         for _, v in pairs(emacsLike) do
            v:enable()
         end
      elseif (eventType == hs.application.watcher.deactivated) then
         for _, v in pairs(emacsLike) do
            v:disable()
         end
      end
   end
end

watcher = hs.application.watcher.new(applicationWatcherCallback)
watcher:start()

-- https://github.com/Hammerspoon/hammerspoon/issues/1519
eventtapOtherMouseDown = hs.eventtap.new({ hs.eventtap.event.types.otherMouseDown, hs.eventtap.event.types.otherMouseUp }, function(event)
    local button = event:getProperty(hs.eventtap.event.properties.mouseEventButtonNumber)
    if (event:getType() == hs.eventtap.event.types.otherMouseDown) then
    	hs.alert.show("otherMouseDown " .. button)
        return true
    else
    	hs.alert.show("otherMouseUp " .. button)
        return true
    end
    return false -- shouldn't ever reach here, but just in case
end):start()

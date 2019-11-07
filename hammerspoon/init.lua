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

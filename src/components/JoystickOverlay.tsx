export const createJoystick = () => {
  // Create joystick container
  const joystickContainer = document.createElement('div');
  joystickContainer.style.position = 'fixed';
  joystickContainer.style.bottom = '20px';
  joystickContainer.style.left = '20px';
  joystickContainer.style.width = '100px';
  joystickContainer.style.height = '100px';
  joystickContainer.style.borderRadius = '50%';
  joystickContainer.style.backgroundColor = 'rgba(50, 50, 50, 0.5)';
  joystickContainer.style.display = 'flex';
  joystickContainer.style.alignItems = 'center';
  joystickContainer.style.justifyContent = 'center';
  joystickContainer.style.zIndex = '1000';
  joystickContainer.style.touchAction = 'none'; // Prevent browser touch actions
  
  // Create joystick knob
  const joystickKnob = document.createElement('div');
  joystickKnob.style.width = '50px';
  joystickKnob.style.height = '50px';
  joystickKnob.style.borderRadius = '50%';
  joystickKnob.style.backgroundColor = 'rgba(200, 200, 200, 0.8)';
  joystickKnob.style.position = 'relative';
  joystickKnob.style.touchAction = 'none'; // Prevent browser touch actions
  
  joystickContainer.appendChild(joystickKnob);
  document.body.appendChild(joystickContainer);
  
  // Touch and mouse event handlers
  let active = false;
  let touchId: number | null = null;
  
  const getJoystickPosition = (clientX: number, clientY: number) => {
    const rect = joystickContainer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    
    const maxRadius = rect.width / 2 - joystickKnob.offsetWidth / 2;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }
    
    return { dx, dy, maxRadius };
  };
  
  const updateKnobPosition = (clientX: number, clientY: number) => {
    if (!active) return;
    
    const { dx, dy, maxRadius } = getJoystickPosition(clientX, clientY);
    
    // Move knob visually
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    
    // Update global joystick state if function exists
    if (window.updateJoystick) {
      window.updateJoystick(dx / maxRadius, dy / maxRadius);
    }
  };
  
  const resetKnob = () => {
    joystickKnob.style.transform = 'translate(0px, 0px)';
    if (window.updateJoystick) {
      window.updateJoystick(0, 0);
    }
    active = false;
    touchId = null;
  };
  
  // Named handlers for window events (required for proper cleanup)
  const handleWindowMouseMove = (e: MouseEvent) => {
    updateKnobPosition(e.clientX, e.clientY);
  };

  const handleWindowMouseUp = () => {
    resetKnob();
  };

  const handleWindowTouchMove = (e: TouchEvent) => {
    if (!active) return;
    e.preventDefault();
    const touch = Array.from(e.touches).find(t => t.identifier === touchId);
    if (touch) {
      updateKnobPosition(touch.clientX, touch.clientY);
    }
  };

  const handleWindowTouchEnd = (e: TouchEvent) => {
    if (Array.from(e.changedTouches).some(t => t.identifier === touchId)) {
      resetKnob();
    }
  };

  // Mouse events
  joystickContainer.addEventListener('mousedown', (e) => {
    active = true;
    updateKnobPosition(e.clientX, e.clientY);
  });

  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup', handleWindowMouseUp);

  // Touch events
  joystickContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) {
      e.preventDefault();
      const touch = e.touches[0];
      touchId = touch.identifier;
      active = true;
      updateKnobPosition(touch.clientX, touch.clientY);
    }
  }, { passive: false });

  window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
  window.addEventListener('touchend', handleWindowTouchEnd);

  return () => {
    document.body.removeChild(joystickContainer);
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    window.removeEventListener('touchmove', handleWindowTouchMove);
    window.removeEventListener('touchend', handleWindowTouchEnd);
  };
};
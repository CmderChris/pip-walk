const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Size the controls relative to the shorter screen dimension so they feel
// consistent across phones, tablets, and landscape/portrait orientations.
// Clamped to avoid being comically large on big tablets or tiny on small phones.
const controlSize = Math.min(130, Math.max(80, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.2)));

export const createJoystick = () => {
  if (!hasTouch) return () => {};

  // Create joystick container
  const joystickContainer = document.createElement('div');
  joystickContainer.style.position = 'fixed';
  joystickContainer.style.bottom = '20px';
  joystickContainer.style.left = '20px';
  joystickContainer.style.width = `${controlSize}px`;
  joystickContainer.style.height = `${controlSize}px`;
  joystickContainer.style.borderRadius = '50%';
  joystickContainer.style.backgroundColor = 'rgba(50, 50, 50, 0.5)';
  joystickContainer.style.display = 'flex';
  joystickContainer.style.alignItems = 'center';
  joystickContainer.style.justifyContent = 'center';
  joystickContainer.style.zIndex = '1000';
  joystickContainer.style.touchAction = 'none';

  // Create joystick knob
  const knobSize = Math.round(controlSize * 0.5);
  const joystickKnob = document.createElement('div');
  joystickKnob.style.width = `${knobSize}px`;
  joystickKnob.style.height = `${knobSize}px`;
  joystickKnob.style.borderRadius = '50%';
  joystickKnob.style.backgroundColor = 'rgba(200, 200, 200, 0.8)';
  joystickKnob.style.position = 'relative';
  joystickKnob.style.touchAction = 'none';
  
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
  
  const DEAD_ZONE = 0.2; // fraction of maxRadius before input registers

  const updateKnobPosition = (clientX: number, clientY: number) => {
    if (!active) return;

    const { dx, dy, maxRadius } = getJoystickPosition(clientX, clientY);

    // Move knob visually
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

    // Apply dead zone — remap the live range [DEAD_ZONE, 1] to [0, 1]
    if (window.updateJoystick) {
      const nx = dx / maxRadius;
      const ny = dy / maxRadius;
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist < DEAD_ZONE) {
        window.updateJoystick(0, 0);
      } else {
        const scale = (dist - DEAD_ZONE) / (1 - DEAD_ZONE) / dist;
        window.updateJoystick(nx * scale, ny * scale);
      }
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

export const createJumpButton = () => {
  if (!hasTouch) return () => {};

  const jumpSize = Math.round(controlSize * 0.85);
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.bottom = '20px';
  container.style.right = '20px';
  container.style.width = `${jumpSize}px`;
  container.style.height = `${jumpSize}px`;
  container.style.borderRadius = '50%';
  container.style.backgroundColor = 'rgba(50, 50, 50, 0.5)';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.zIndex = '1000';
  container.style.touchAction = 'none';
  container.style.userSelect = 'none';
  container.style.cursor = 'pointer';

  const knobSize = Math.round(jumpSize * 0.72);
  const fontSize = Math.round(knobSize * 0.4);
  const knob = document.createElement('div');
  knob.style.width = `${knobSize}px`;
  knob.style.height = `${knobSize}px`;
  knob.style.borderRadius = '50%';
  knob.style.backgroundColor = 'rgba(200, 200, 200, 0.8)';
  knob.style.display = 'flex';
  knob.style.alignItems = 'center';
  knob.style.justifyContent = 'center';
  knob.style.fontSize = `${fontSize}px`;
  knob.style.lineHeight = '1';
  knob.style.transition = 'background-color 0.05s';
  knob.textContent = '↑';

  container.appendChild(knob);
  document.body.appendChild(container);

  const press = () => {
    knob.style.backgroundColor = 'rgba(140, 140, 140, 0.9)';
    if (window.triggerJump) window.triggerJump();
  };

  const release = () => {
    knob.style.backgroundColor = 'rgba(200, 200, 200, 0.8)';
  };

  const handleMouseUp = release;
  const handleTouchEnd = release;

  container.addEventListener('mousedown', press);
  window.addEventListener('mouseup', handleMouseUp);

  container.addEventListener('touchstart', (e) => {
    e.preventDefault();
    press();
  }, { passive: false });
  window.addEventListener('touchend', handleTouchEnd);

  return () => {
    document.body.removeChild(container);
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('touchend', handleTouchEnd);
  };
};
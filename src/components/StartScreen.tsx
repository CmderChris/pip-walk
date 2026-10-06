import { useEffect, useRef } from 'react';

interface StartScreenProps {
  ready: boolean;
  onStart: () => void;
}

// Sits over the live scene. The button is disabled while the model and textures load,
// so a click (or Enter) always starts a scene that is ready to move around in.
const StartScreen = ({ ready, onStart }: StartScreenProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Enter starts too. Skipped when the button itself has focus (its native click already
  // handles that, and this would start twice) or when typing in a field on the host page.
  useEffect(() => {
    if (!ready) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el === buttonRef.current) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName))) return;
      onStart();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ready, onStart]);

  return (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 1000,
    }}
  >
    <button
      ref={buttonRef}
      type="button"
      disabled={!ready}
      onClick={onStart}
      style={{
        pointerEvents: 'auto',
        padding: '14px 44px',
        fontFamily: 'system-ui, Avenir, Helvetica, Arial, sans-serif',
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: 1,
        color: '#fff',
        background: 'rgba(50, 50, 50, 0.6)',
        border: '2px solid rgba(255, 255, 255, 0.8)',
        borderRadius: 999,
        cursor: ready ? 'pointer' : 'default',
        opacity: ready ? 1 : 0.6,
        transition: 'opacity 0.3s',
        backdropFilter: 'blur(4px)',
      }}
    >
      {ready ? 'Start' : 'Loading…'}
    </button>
  </div>
  );
};

export default StartScreen;

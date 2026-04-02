import { useState, useRef, useEffect } from 'react'

const joystickStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 40,
  left: 40,
  width: 100,
  height: 100,
  background: 'rgba(0,0,0,0.3)',
  borderRadius: '50%',
  touchAction: 'none',
  zIndex: 100,
}

const thumbStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  background: '#fff',
  borderRadius: '50%',
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  transition: 'transform 0.1s ease',
}

const Controls = ({ setMovementVector }: ControlProps) => {
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const joystickRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window)
  }, [])

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!joystickRef.current || !thumbRef.current) return
    const touch = e.touches[0]
    const rect = joystickRef.current.getBoundingClientRect()

    const dx = touch.clientX - (rect.left + rect.width / 2)
    const dy = touch.clientY - (rect.top + rect.height / 2)
    const radius = rect.width / 2
    const distance = Math.min(Math.sqrt(dx * dx + dy * dy), radius)
    const angle = Math.atan2(dy, dx)
    const moveX = Math.cos(angle) * distance
    const moveY = Math.sin(angle) * distance

    thumbRef.current.style.transform = `translate(${moveX}px, ${moveY}px)`

    // Normalize to [-1, 1]
    const x = moveX / radius
    const z = moveY / radius // we'll invert this in model logic if needed

    setMovementVector({ x, z })
  }

  const handleTouchEnd = () => {
    if (thumbRef.current) {
      thumbRef.current.style.transform = 'translate(0px, 0px)'
    }
    setMovementVector({ x: 0, z: 0 })
  }

  if (!isTouchDevice) return null

  return (
    <div
      ref={joystickRef}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={joystickStyle}
    >
      <div ref={thumbRef} style={thumbStyle} />
    </div>
  )
}

export default Controls

type ControlProps = {
  setMovementVector: React.Dispatch<React.SetStateAction<{ x: number; z: number }>>
}
// Connects the on-screen controls (ButtonOverlay) to the model (ModelController).
// ModelController registers its handlers while mounted; the controls call them.
export const controlBus: {
  joystick: ((x: number, y: number) => void) | null;
  jump: (() => void) | null;
} = {
  joystick: null,
  jump: null,
};

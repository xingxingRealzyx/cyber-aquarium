// The logical desktop rectangle sets the tank's initial framing. The actual
// camera frustum always spans the entire transparent canvas.
export function createDesktopView(camera, controls, canvas) {
  let width = 1, height = 1;
  let layout = null;
  let shiftX = 0, shiftY = 0;
  const events = new AbortController();
  const listener = { signal: events.signal };

  function frame() {
    if (!layout) return { x: 0, y: 0, width, height };
    const canvasRect = canvas.getBoundingClientRect();
    return { ...layout, x: layout.x - canvasRect.left, y: layout.y - canvasRect.top };
  }

  function project() {
    const box = frame();
    const centerX = box.x + box.width * (.5 + shiftX);
    const centerY = box.y + box.height * (.5 + shiftY);
    camera.setViewOffset(box.width, box.height,
      box.width / 2 - centerX, box.height / 2 - centerY, width, height);
    // A drag at high magnification should rotate by a correspondingly small angle.
    controls.rotateSpeed = height / box.height / Math.max(1, camera.zoom);
  }

  function zoomAt(clientX, clientY, factor) {
    const box = frame();
    const canvasRect = canvas.getBoundingClientRect();
    const handX = (clientX - canvasRect.left - box.x) / box.width - .5;
    const handY = (clientY - canvasRect.top - box.y) / box.height - .5;
    // Beyond the precision of 32-bit GPU projection matrices, adjacent
    // surface points cannot be resolved. The camera stays outside the glass.
    const next = Math.min(65536, Math.max(.16, camera.zoom * factor));
    const ratio = next / camera.zoom;
    if (!Number.isFinite(ratio) || ratio === 1) return;
    const limit = Math.abs(next - 1) * .58;
    const bound = value => Math.min(limit, Math.max(-limit, value));
    shiftX = bound(handX + (shiftX - handX) * ratio);
    shiftY = bound(handY + (shiftY - handY) * ratio);
    camera.zoom = next;
    project();
  }

  canvas.addEventListener('wheel', event => {
    if (!event.deltaY) return;
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    const sensitivity = event.ctrlKey ? .012 : .0021;
    const step = Math.max(-2.5, Math.min(2.5, -event.deltaY * units * sensitivity));
    zoomAt(event.clientX, event.clientY, Math.exp(step));
  }, { ...listener, passive: false });

  let pinchDistance = 0;
  const separation = ([a,b]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const beginTouch = event => {
    pinchDistance = event.touches.length === 2 ? separation(event.touches) : 0;
  };
  canvas.addEventListener('touchstart', beginTouch, listener);
  canvas.addEventListener('touchend', beginTouch, listener);
  canvas.addEventListener('touchcancel', beginTouch, listener);
  canvas.addEventListener('touchmove', event => {
    if (event.touches.length !== 2) return;
    const [a,b] = event.touches;
    const distance = separation(event.touches);
    if (pinchDistance && distance) {
      event.preventDefault();
      zoomAt((a.clientX+b.clientX)/2, (a.clientY+b.clientY)/2, distance / pinchDistance);
    }
    pinchDistance = distance;
  }, { ...listener, passive: false });

  let middleDrag = null;
  canvas.addEventListener('pointerdown', event => {
    if (event.button === 1) middleDrag = { x: event.clientX, y: event.clientY, lastY: event.clientY };
  }, listener);
  canvas.addEventListener('pointermove', event => {
    if (!middleDrag) return;
    if (!(event.buttons & 4)) { middleDrag = null; return; }
    zoomAt(middleDrag.x, middleDrag.y, Math.exp((middleDrag.lastY - event.clientY) * .009));
    middleDrag.lastY = event.clientY;
  }, listener);
  canvas.addEventListener('lostpointercapture', () => { middleDrag = null; }, listener);
  canvas.addEventListener('pointerup', () => { middleDrag = null; }, listener);

  return {
    setLayout(box) {
      if (box && (![box.x,box.y,box.width,box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0)) return;
      layout = box;
      project();
    },
    resize(w,h) { width = w; height = h; project(); },
    reset() { shiftX = 0; shiftY = 0; camera.zoom = 1; project(); },
    dispose() { events.abort(); },
  };
}

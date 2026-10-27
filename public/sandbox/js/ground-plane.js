/** 以屏幕锚点为原点，将界面投影到与战场地面平行的平面。 */
export function groundPlaneTransform(view, canvas, x, y) {
  const cam = view.debug.cam, rect = canvas.getBoundingClientRect();
  const roll = (cam.roll || 0) * Math.PI / 180, tilt = cam.tilt * Math.PI / 180;
  const c = Math.cos(roll), s = Math.sin(roll), g = Math.sin(tilt) / cam.focal();
  const dx = x - rect.left - cam.cx, dy = y - rect.top - cam.cy;
  const a = -s * Math.cos(tilt) + dx * g, b = c * Math.cos(tilt) + dy * g;
  return `matrix3d(${c},${s},0,0,${a},${b},0,${-g},0,0,1,0,0,0,0,1)`;
}

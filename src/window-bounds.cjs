// Keep a restored window reachable if a monitor was disconnected or resized.
function fitBounds(bounds, area) {
  const width = Math.min(Math.max(340, bounds.width), area.width);
  const height = Math.min(Math.max(460, bounds.height), area.height);
  return { x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)), width, height };
}
module.exports = { fitBounds };

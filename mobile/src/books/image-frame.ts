/** Focus is a point in the original, not a percentage of the overflow. */
export function focusedImageFrame(width: number, height: number, frameWidth: number, frameHeight: number, focus: { x: number; y: number }) {
  if (![width, height, frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.max(frameWidth / width, frameHeight / height);
  const renderedWidth = width * scale, renderedHeight = height * scale;
  return {
    width: renderedWidth,
    height: renderedHeight,
    left: -Math.max(0, Math.min(renderedWidth - frameWidth, renderedWidth * focus.x - frameWidth / 2)),
    top: -Math.max(0, Math.min(renderedHeight - frameHeight, renderedHeight * focus.y - frameHeight / 2)),
  };
}

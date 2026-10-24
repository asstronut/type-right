const CLIPPING = new Set(['hidden', 'clip', 'scroll', 'auto']);

/**
 * The part of `element` the user can see: its box cut by every clipping
 * ancestor and the viewport, or `undefined` when nothing of it shows.
 */
export function visibleBox(element: HTMLElement): DOMRect | undefined {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  if (right <= left || bottom <= top) return undefined;
  for (let inner: HTMLElement = element, ancestor = element.parentElement; ancestor; inner = ancestor, ancestor = ancestor.parentElement) {
    if (ancestor === document.body || ancestor === document.documentElement) break;
    if (getComputedStyle(inner).position === 'fixed') break;
    const { overflowX, overflowY } = getComputedStyle(ancestor);
    if (!CLIPPING.has(overflowX) && !CLIPPING.has(overflowY)) continue;
    const clip = ancestor.getBoundingClientRect();
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : undefined;
}

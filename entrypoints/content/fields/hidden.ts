/** Narrower than this and a box is a hairline, not somewhere anyone types. */
const MIN_BOX_PX = 2;

/** Whether `element` is out of the user's sight: invisible, hidden from assistive technology, inert or without a box. */
export function isHidden(element: HTMLElement): boolean {
  if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return true;
  if (element.closest('[aria-hidden="true"], [inert]')) return true;
  const { width, height } = element.getBoundingClientRect();
  return width < MIN_BOX_PX || height < MIN_BOX_PX;
}

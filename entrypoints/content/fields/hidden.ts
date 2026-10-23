const SMALLEST_TYPABLE_BOX_PX = 2;

export function isHidden(element: HTMLElement): boolean {
  if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return true;
  if (element.closest('[aria-hidden="true"], [inert]')) return true;
  const { width, height } = element.getBoundingClientRect();
  return width < SMALLEST_TYPABLE_BOX_PX || height < SMALLEST_TYPABLE_BOX_PX;
}

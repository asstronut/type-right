/**
 * Shows `popover` (a `popover="manual"` element) in the top layer beside
 * `near`: inside its modal dialog when it has one, as the page outside an open
 * modal dialog takes no pointer events, else on the root.
 */
export function raise(popover: HTMLElement, near: Element): void {
  const container = near.closest('dialog:modal') ?? document.documentElement;
  // Moving a popover closes it, so it is shown again below.
  if (popover.parentElement !== container) container.appendChild(popover);
  popover.style.display = 'block';
  if (!popover.matches(':popover-open')) popover.showPopover();
}

export function lower(popover: HTMLElement): void {
  if (popover.matches(':popover-open')) popover.hidePopover();
  popover.style.display = 'none';
}

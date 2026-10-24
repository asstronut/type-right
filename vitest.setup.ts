// happy-dom has no top layer and no hit testing: an open popover is marked with an attribute, and no point hits anything.
if (typeof document !== 'undefined') {
  HTMLElement.prototype.showPopover ??= function (this: HTMLElement) {
    this.setAttribute('data-test-popover-open', '');
  };
  HTMLElement.prototype.hidePopover ??= function (this: HTMLElement) {
    this.removeAttribute('data-test-popover-open');
  };
  document.elementsFromPoint ??= () => [];
}

const INTERACTIVE_TARGET_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menuitem"]',
].join(',');

export function isTaskCardBodyTarget(target: EventTarget | null, card: HTMLElement): boolean {
  if (!(target instanceof Element) || (target !== card && !card.contains(target))) return false;
  const interactiveTarget = target.closest(INTERACTIVE_TARGET_SELECTOR);
  return interactiveTarget === null || interactiveTarget === card;
}

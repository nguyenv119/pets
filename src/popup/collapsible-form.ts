/**
 * Collapsible add-pet form.
 *
 * Controls the expanded/collapsed state of `#add-pet-form` by toggling the
 * `.collapsed` CSS class and keeping `aria-expanded` on the FAB in sync.
 * Focus management ensures keyboard usability in both directions.
 *
 * State is held in a module-level boolean so callers never have to read
 * `aria-expanded` back from the DOM — that attribute is a pure output.
 */

let expandedState = false;

/**
 * Expand or collapse the add-pet form.
 *
 * DOM elements are looked up at call time (not module load) so this function
 * works correctly even when called after the DOM has been rebuilt.
 *
 * @param expanded - true = show the form; false = hide it.
 */
export function setAddFormExpanded(expanded: boolean): void {
  const form = document.getElementById('add-pet-form')!;
  const fab = document.getElementById('btn-add-toggle') as HTMLButtonElement;
  const nameInput = document.getElementById('pet-name') as HTMLInputElement;

  expandedState = expanded;

  if (expanded) {
    form.classList.remove('collapsed');
    fab.setAttribute('aria-expanded', 'true');
    nameInput.focus();
  } else {
    form.classList.add('collapsed');
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }
}

/** Returns the current expanded state without reading the DOM. */
export function isAddFormExpanded(): boolean {
  return expandedState;
}

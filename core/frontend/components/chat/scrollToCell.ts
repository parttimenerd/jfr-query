// DOM-side utility: scroll the notebook to a cell by id and briefly flash it.
// NotebookCell renders `<div data-cell-id={cell.id}>` so we can find the node
// by attribute without threading refs through the tree.

const FLASH_CLASS = 'cell-flash';
const FLASH_MS = 1200;

export function scrollToCell(cellId: string): boolean {
    if (typeof document === 'undefined' || !cellId) return false;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(cellId) : cellId.replace(/"/g, '\\"');
    const el = document.querySelector(`[data-cell-id="${escaped}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Re-trigger the animation if it's already on the element.
    el.classList.remove(FLASH_CLASS);
    // Force a reflow so the class re-add restarts the keyframes.
    void (el as HTMLElement).offsetWidth;
    el.classList.add(FLASH_CLASS);
    window.setTimeout(() => el.classList.remove(FLASH_CLASS), FLASH_MS);
    return true;
}

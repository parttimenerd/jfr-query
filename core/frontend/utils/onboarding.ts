/**
 * Returns true when the onboarding banner should be shown:
 * - the notebook is empty (cellCount === 0)
 * - the user has not previously dismissed the banner
 */
export function shouldShowOnboarding(cellCount: number): boolean {
    return cellCount === 0 && !localStorage.getItem('jfrq:onboarding-dismissed');
}

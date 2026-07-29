/**
 * Returns true when the onboarding banner should be shown:
 * - the notebook is empty (cellCount === 0)
 * - the user has not previously dismissed the banner
 */
export function shouldShowOnboarding(cellCount: number): boolean {
    if (cellCount !== 0) return false;
    try {
        return !localStorage.getItem('jfrq:onboarding-dismissed');
    } catch {
        return false;
    }
}

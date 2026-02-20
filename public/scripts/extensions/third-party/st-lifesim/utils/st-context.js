/**
 * ST-LifeSim context accessor
 * SillyTavern 버전 간 호환을 위해 전역 API를 우선 사용한다.
 */

/**
 * @returns {any|null}
 */
export function getContext() {
    if (typeof globalThis?.SillyTavern?.getContext === 'function') {
        return globalThis.SillyTavern.getContext();
    }

    if (typeof globalThis?.getContext === 'function') {
        return globalThis.getContext();
    }

    console.warn('[ST-LifeSim] Context API is not available. Ensure SillyTavern is fully initialized.');
    return null;
}

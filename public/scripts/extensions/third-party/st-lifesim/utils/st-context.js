/**
 * ST-LifeSim context accessor
 * SillyTavern 버전 간 호환을 위해 전역 API를 우선 사용한다.
 * GitHub 링크 설치 및 직접 설치 모두에서 안정적으로 동작한다.
 */

/**
 * @returns {any|null}
 */
export function getContext() {
    try {
        if (typeof globalThis?.SillyTavern?.getContext === 'function') {
            return globalThis.SillyTavern.getContext();
        }

        if (typeof globalThis?.getContext === 'function') {
            return globalThis.getContext();
        }
    } catch (e) {
        console.warn('[ST-LifeSim] Context API 접근 오류:', e);
        return null;
    }

    console.warn('[ST-LifeSim] Context API is not available. Ensure SillyTavern is fully initialized.');
    return null;
}

/**
 * 안전하게 SillyTavern eventSource와 eventTypes를 가져온다.
 * getContext()가 null을 반환하거나 속성이 없을 때에도 오류 없이 동작한다.
 * @returns {{ evSrc: any, eventTypes: any }}
 */
export function getSafeEventHandles() {
    try {
        const ctx = getContext();
        if (!ctx) return { evSrc: null, eventTypes: null };
        const evSrc = ctx.eventSource ?? null;
        const eventTypes = ctx.eventTypes ?? ctx.event_types ?? null;
        return { evSrc, eventTypes };
    } catch (e) {
        console.warn('[ST-LifeSim] 이벤트 핸들 접근 오류:', e);
        return { evSrc: null, eventTypes: null };
    }
}

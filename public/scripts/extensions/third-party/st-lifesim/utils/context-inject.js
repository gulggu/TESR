/**
 * context-inject.js
 * 모든 활성 모듈 정보를 하나의 블록으로 합쳐서 프롬프트에 주입하는 공통 함수
 * World Info(Lorebook) 항목을 생성하지 않고 직접 삽입한다
 */

import { getContext } from './st-context.js';

// 확장 프롬프트 주입 태그
const INJECT_TAG = 'st-lifesim-context';

// 활성화된 모듈의 컨텍스트 빌더 등록소
/** @type {Map<string, Function>} */
const contextBuilders = new Map();

/**
 * 모듈의 컨텍스트 빌더를 등록한다
 * @param {string} moduleKey - 모듈 키
 * @param {Function} builder - () => string | null 형태의 컨텍스트 생성 함수
 */
export function registerContextBuilder(moduleKey, builder) {
    contextBuilders.set(moduleKey, builder);
}

/**
 * 등록된 모든 모듈의 컨텍스트를 합쳐서 프롬프트에 주입한다
 * 모듈이 OFF이거나 데이터가 없으면 해당 섹션을 생략한다
 */
export async function injectContext() {
    const ctx = getContext();
    if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
    const sections = [];

    // 각 모듈의 컨텍스트 블록을 수집한다
    for (const builder of contextBuilders.values()) {
        try {
            const section = await builder();
            if (section && section.trim()) {
                sections.push(section.trim());
            }
        } catch (e) {
            console.error('[ST-LifeSim] 컨텍스트 빌드 오류:', e);
        }
    }

    // 하나도 없으면 주입 내용을 비운다
    if (sections.length === 0) {
        ctx.setExtensionPrompt(INJECT_TAG, '', 1, 0);
        return;
    }

    // 하나의 블록으로 합친다
    const prompt = `[ST-LifeSim Context]\n${sections.join('\n\n')}\n[/ST-LifeSim Context]`;
    // IN_PROMPT(1) 타입으로 depth 0에 주입
    ctx.setExtensionPrompt(INJECT_TAG, prompt, 1, 0);
}

/**
 * 컨텍스트 주입을 제거한다 (확장 비활성화 시)
 */
export function clearContext() {
    const ctx = getContext();
    if (ctx && typeof ctx.setExtensionPrompt === 'function') {
        ctx.setExtensionPrompt(INJECT_TAG, '', 1, 0);
    }
    contextBuilders.clear();
}

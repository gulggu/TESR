/**
 * storage.js
 * 채팅별 또는 캐릭터별로 데이터를 저장하고 불러오는 유틸리티
 */

import { getContext } from './st-context.js';

// 로컬스토리지 키 접두사
const PREFIX = 'st-lifesim:';

/**
 * SillyTavern extension_settings 객체를 가져온다 (컨텍스트 API 사용)
 * @returns {Object|null}
 */
export function getExtensionSettings() {
    const ctx = getContext();
    return ctx?.extensionSettings ?? null;
}

/**
 * 전역 설정에서 기본 바인딩 타입을 가져온다
 * @returns {'chat'|'character'}
 */
export function getDefaultBinding() {
    const ext = getExtensionSettings();
    return ext?.['st-lifesim']?.defaultBinding || 'chat';
}

/**
 * 현재 바인딩 키를 반환한다 (채팅 ID 또는 캐릭터 ID)
 * @param {'chat'|'character'} binding - 바인딩 타입
 * @returns {string} 저장소 키
 */
function getBindingKey(binding) {
    const ctx = getContext();
    if (!ctx) return 'default';
    if (binding === 'character') {
        // 캐릭터별 저장: 캐릭터 ID를 키로 사용
        const charId = ctx.characterId ?? 'default';
        return `char:${charId}`;
    }
    // 채팅별 저장 (기본): 현재 채팅 ID를 키로 사용
    const chatId = ctx.chatId ?? (ctx.getCurrentChatId ? ctx.getCurrentChatId() : 'default');
    return `chat:${chatId}`;
}

/**
 * 모듈 데이터를 저장한다
 * @param {string} module - 모듈 이름 (예: 'contacts', 'wallet')
 * @param {*} data - 저장할 데이터
 * @param {'chat'|'character'} binding - 바인딩 타입
 */
export function saveData(module, data, binding = 'chat') {
    const key = `${PREFIX}${module}:${getBindingKey(binding)}`;
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error('[ST-LifeSim] 저장 오류:', e);
    }
}

/**
 * 모듈 데이터를 불러온다
 * @param {string} module - 모듈 이름
 * @param {*} defaultValue - 기본값 (데이터가 없을 때 반환)
 * @param {'chat'|'character'} binding - 바인딩 타입
 * @returns {*} 저장된 데이터 또는 기본값
 */
export function loadData(module, defaultValue = null, binding = 'chat') {
    const key = `${PREFIX}${module}:${getBindingKey(binding)}`;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        return JSON.parse(raw);
    } catch (e) {
        console.error('[ST-LifeSim] 불러오기 오류:', e);
        return defaultValue;
    }
}

/**
 * 모듈 데이터를 삭제한다
 * @param {string} module - 모듈 이름
 * @param {'chat'|'character'} binding - 바인딩 타입
 */
export function deleteData(module, binding = 'chat') {
    const key = `${PREFIX}${module}:${getBindingKey(binding)}`;
    localStorage.removeItem(key);
}

/**
 * 모든 ST-LifeSim 데이터를 백업 (JSON 문자열 반환)
 * @returns {string} JSON 백업 문자열
 */
export function exportAllData() {
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) {
            result[k] = localStorage.getItem(k);
        }
    }
    return JSON.stringify(result, null, 2);
}

/**
 * 백업 JSON으로부터 모든 데이터를 복원한다
 * @param {string} json - 백업 JSON 문자열
 */
export function importAllData(json) {
    try {
        const data = JSON.parse(json);
        for (const [k, v] of Object.entries(data)) {
            if (k.startsWith(PREFIX)) {
                localStorage.setItem(k, v);
            }
        }
    } catch (e) {
        console.error('[ST-LifeSim] 복원 오류:', e);
        throw e;
    }
}

/**
 * ST-LifeSim 저장소 데이터를 모두 삭제한다
 */
export function clearAllData() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
}

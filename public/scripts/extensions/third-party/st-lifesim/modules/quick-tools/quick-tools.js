/**
 * quick-tools.js
 * 퀵 도구 모음 모듈
 * - 퀵 센드: 입력창 텍스트를 /send로 전송 (AI 응답 없음) - sendform 전송 아이콘 옆에 배치
 * - 시간 구분선: 시간 경과 구분선 삽입
 * - 읽씹 연출: 읽음 표시 후 AI가 묘사
 * - 연락 안 됨 연출: 연락 불가 상황 삽입
 * - 사건 생성기: 카테고리별 사건 생성
 * - 음성메모 연출: 음성메시지 삽입
 */

import { getContext } from '../../../../../st-context.js';
import { slashSend, slashGen, slashSendAs } from '../../utils/slash.js';
import { showToast } from '../../utils/ui.js';
import { loadData, saveData } from '../../utils/storage.js';

// 사건 기록 아카이브 저장 키
const ARCHIVE_KEY = 'event-archive';

/**
 * 퀵 센드 버튼을 sendform의 전송 버튼(#send_but) 바로 앞에 삽입한다
 * 아이콘만 표시하고 클릭 시 /send로 전송한다
 */
export function injectQuickSendButton() {
    // 이미 있으면 건너뛴다
    if (document.getElementById('slm-quick-send-btn')) return;

    // SillyTavern의 전송 버튼(#send_but)을 찾는다
    const sendBtn = document.getElementById('send_but');
    if (!sendBtn) {
        // 아직 렌더링되지 않았으면 나중에 재시도
        setTimeout(injectQuickSendButton, 1000);
        return;
    }

    const btn = document.createElement('div');
    btn.id = 'slm-quick-send-btn';
    btn.className = 'slm-quick-send-btn interactable';
    btn.title = '퀵 센드 (AI 응답 없이 전송)';
    btn.innerHTML = '📨';
    btn.setAttribute('aria-label', '퀵 센드');
    btn.setAttribute('tabindex', '0');

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleQuickSend();
    });

    // send_but 바로 앞에 삽입 (같은 #rightSendForm 부모 내)
    sendBtn.parentNode.insertBefore(btn, sendBtn);
}

/**
 * 퀵 센드 동작: 입력창 텍스트를 /send로 전송
 */
async function handleQuickSend() {
    // 입력창 텍스트 가져오기
    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) {
        showToast('보낼 내용을 입력해주세요.', 'warn');
        return;
    }

    try {
        await slashSend(text);
        // 입력창 비우기
        textarea.value = '';
        textarea.dispatchEvent(new Event('input'));
        showToast('전송 완료 (AI 응답 없음)', 'success', 1500);
    } catch (e) {
        showToast('전송 실패: ' + e.message, 'error');
    }
}

/**
 * 시간 구분선을 삽입하는 드롭다운 UI를 렌더링한다
 * @returns {HTMLElement}
 */
export function renderTimeDividerUI() {
    const container = document.createElement('div');
    container.className = 'slm-tool-section';

    const title = document.createElement('h4');
    title.textContent = '⏱️ 시간 구분선';
    container.appendChild(title);

    // 미리 설정된 시간 버튼들
    const presets = [
        { label: '30분 후', value: '30분 후' },
        { label: '1시간 후', value: '1시간 후' },
        { label: '3시간 후', value: '3시간 후' },
        { label: '다음날', value: '다음날' },
        { label: '1주일 후', value: '1주일 후' },
    ];

    const btnRow = document.createElement('div');
    btnRow.className = 'slm-btn-row';

    presets.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
        btn.textContent = preset.label;
        btn.onclick = async () => {
            await insertTimeDivider(preset.value);
            showToast(`구분선 삽입: ${preset.value}`, 'success', 1500);
        };
        btnRow.appendChild(btn);
    });

    container.appendChild(btnRow);

    // 직접 입력
    const customRow = document.createElement('div');
    customRow.className = 'slm-input-row';

    const customInput = document.createElement('input');
    customInput.className = 'slm-input';
    customInput.type = 'text';
    customInput.placeholder = '직접 입력 (예: 2일 후)';

    const customBtn = document.createElement('button');
    customBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    customBtn.textContent = '삽입';
    customBtn.onclick = async () => {
        const val = customInput.value.trim();
        if (!val) return;
        await insertTimeDivider(val);
        customInput.value = '';
        showToast(`구분선 삽입: ${val}`, 'success', 1500);
    };

    customRow.appendChild(customInput);
    customRow.appendChild(customBtn);
    container.appendChild(customRow);

    return container;
}

/**
 * 시간 구분선을 채팅에 삽입한다
 * @param {string} timeLabel - 시간 텍스트
 */
async function insertTimeDivider(timeLabel) {
    await slashSend(`─────────── ${timeLabel} ───────────`);
}

/**
 * 읽씹 연출 UI를 렌더링한다
 * @returns {HTMLElement}
 */
export function renderReadReceiptUI() {
    const container = document.createElement('div');
    container.className = 'slm-tool-section';

    const title = document.createElement('h4');
    title.textContent = '👻 읽씹 연출';
    container.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'slm-desc';
    desc.textContent = '읽음 표시를 삽입하고 캐릭터가 답장하지 않는 상황을 연출합니다.';
    container.appendChild(desc);

    const btn = document.createElement('button');
    btn.className = 'slm-btn slm-btn-primary';
    btn.textContent = '읽씹 실행';
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            await handleReadReceipt();
        } finally {
            btn.disabled = false;
        }
    };
    container.appendChild(btn);

    return container;
}

/**
 * 읽씹 연출 실행
 */
async function handleReadReceipt() {
    const ctx = getContext();
    const charName = ctx.name2 || '{{char}}';

    try {
        // 1. 읽음 표시 삽입
        await slashSend('읽음 ✓✓');
        // 2. AI가 읽씹 상황 묘사
        await slashGen(
            `${charName}는 메시지를 읽었지만 아직 답장하지 않은 상황을 짧게 묘사하라.`,
            charName
        );
        showToast('읽씹 연출 완료', 'success', 1500);
    } catch (e) {
        showToast('읽씹 연출 실패: ' + e.message, 'error');
    }
}

/**
 * 연락 안 됨 연출 UI를 렌더링한다
 * @returns {HTMLElement}
 */
export function renderNoContactUI() {
    const container = document.createElement('div');
    container.className = 'slm-tool-section';

    const title = document.createElement('h4');
    title.textContent = '📵 연락 안 됨';
    container.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'slm-desc';
    desc.textContent = '캐릭터에게 연락이 닿지 않는 상황을 연출합니다.';
    container.appendChild(desc);

    const btn = document.createElement('button');
    btn.className = 'slm-btn slm-btn-primary';
    btn.textContent = '연락 안 됨 실행';
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            await handleNoContact();
        } finally {
            btn.disabled = false;
        }
    };
    container.appendChild(btn);

    return container;
}

/**
 * 연락 안 됨 연출 실행
 */
async function handleNoContact() {
    const ctx = getContext();
    const charName = ctx.name2 || '{{char}}';

    try {
        // 1. 연결 불가 메시지 삽입
        await slashSend('📵 연결되지 않습니다');
        // 2. AI가 연락 안 되는 상황 묘사
        await slashGen(
            `${charName}에게 연락이 닿지 않는다. 전화를 받지 않거나 메시지 미확인 상태인 상황을 짧게 묘사하라.`,
            charName
        );
        showToast('연락 안 됨 연출 완료', 'success', 1500);
    } catch (e) {
        showToast('연락 안 됨 연출 실패: ' + e.message, 'error');
    }
}

/**
 * 사건 생성기 UI를 렌더링한다
 * @returns {HTMLElement}
 */
export function renderEventGeneratorUI() {
    const container = document.createElement('div');
    container.className = 'slm-tool-section';

    const title = document.createElement('h4');
    title.textContent = '⚡ 사건 생성기';
    container.appendChild(title);

    // 카테고리 버튼
    const categories = [
        { label: '📰 일상', key: '일상' },
        { label: '💼 직장/학교', key: '직장/학교' },
        { label: '❤️ 관계', key: '관계' },
        { label: '🌧️ 사고', key: '사고' },
        { label: '🎉 좋은 일', key: '좋은 일' },
        { label: '⚡ 긴급', key: '긴급' },
        { label: '🎲 랜덤', key: '랜덤' },
    ];

    const btnRow = document.createElement('div');
    btnRow.className = 'slm-btn-row slm-btn-row-wrap';

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
        btn.textContent = cat.label;
        btn.onclick = async () => {
            btn.disabled = true;
            try {
                await generateEvent(cat.key);
            } finally {
                btn.disabled = false;
            }
        };
        btnRow.appendChild(btn);
    });

    container.appendChild(btnRow);

    // 사건 기록 보기 버튼
    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
    archiveBtn.textContent = '📜 사건 기록';
    archiveBtn.style.marginTop = '8px';
    archiveBtn.onclick = () => showEventArchive(container);
    container.appendChild(archiveBtn);

    return container;
}

/**
 * 사건을 생성하고 아카이브에 저장한다
 * @param {string} category - 사건 카테고리
 */
async function generateEvent(category) {
    const ctx = getContext();
    const charName = ctx.name2 || '{{char}}';

    try {
        const prompt = `${category} 분류의 사건이 발생했다. 현재 상황에 어울리는 사건을 간결하게 묘사하라.`;
        await slashGen(prompt, charName);

        // 사건 기록 아카이브에 저장
        const archive = loadData(ARCHIVE_KEY, [], 'chat');
        archive.push({
            id: crypto.randomUUID(),
            date: new Date().toISOString(),
            category,
            includeInContext: false,
        });
        saveData(ARCHIVE_KEY, archive, 'chat');

        showToast(`사건 생성: ${category}`, 'success', 1500);
    } catch (e) {
        showToast('사건 생성 실패: ' + e.message, 'error');
    }
}

/**
 * 사건 기록 아카이브를 표시한다
 * @param {HTMLElement} container - 렌더링할 컨테이너
 */
function showEventArchive(container) {
    const archive = loadData(ARCHIVE_KEY, [], 'chat');

    // 이미 있으면 제거
    const existing = container.querySelector('.slm-archive');
    if (existing) { existing.remove(); return; }

    const archiveDiv = document.createElement('div');
    archiveDiv.className = 'slm-archive';

    if (archive.length === 0) {
        archiveDiv.textContent = '기록된 사건이 없습니다.';
    } else {
        archive.slice().reverse().forEach(item => {
            const row = document.createElement('div');
            row.className = 'slm-archive-row';
            const d = new Date(item.date);
            row.textContent = `${d.toLocaleDateString('ko-KR')} [${item.category}]`;
            archiveDiv.appendChild(row);
        });
    }

    container.appendChild(archiveDiv);
}

/**
 * 음성메모 연출 UI를 렌더링한다
 * @returns {HTMLElement}
 */
export function renderVoiceMemoUI() {
    const container = document.createElement('div');
    container.className = 'slm-tool-section';

    const title = document.createElement('h4');
    title.textContent = '🎤 음성메모 연출';
    container.appendChild(title);

    // 길이 입력
    const durationRow = document.createElement('div');
    durationRow.className = 'slm-input-row';

    const durationLabel = document.createElement('label');
    durationLabel.className = 'slm-label';
    durationLabel.textContent = '길이(초):';

    const durationInput = document.createElement('input');
    durationInput.className = 'slm-input slm-input-sm';
    durationInput.type = 'number';
    durationInput.min = '1';
    durationInput.max = '3600';
    durationInput.value = '23';

    durationRow.appendChild(durationLabel);
    durationRow.appendChild(durationInput);
    container.appendChild(durationRow);

    // 내용 힌트 입력
    const hintRow = document.createElement('div');
    hintRow.className = 'slm-input-row';

    const hintLabel = document.createElement('label');
    hintLabel.className = 'slm-label';
    hintLabel.textContent = '내용 힌트(선택):';

    const hintInput = document.createElement('input');
    hintInput.className = 'slm-input';
    hintInput.type = 'text';
    hintInput.placeholder = '예: 오늘 늦겠다고';

    hintRow.appendChild(hintLabel);
    hintRow.appendChild(hintInput);
    container.appendChild(hintRow);

    // 실행 버튼
    const btn = document.createElement('button');
    btn.className = 'slm-btn slm-btn-primary';
    btn.textContent = '음성메모 삽입';
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            const secs = parseInt(durationInput.value) || 23;
            const hint = hintInput.value.trim();
            await handleVoiceMemo(secs, hint);
            hintInput.value = '';
        } finally {
            btn.disabled = false;
        }
    };
    container.appendChild(btn);

    return container;
}

/**
 * 음성메모 연출 실행
 * @param {number} seconds - 음성메시지 길이(초)
 * @param {string} hint - 내용 힌트 (선택)
 */
async function handleVoiceMemo(seconds, hint) {
    const ctx = getContext();
    const charName = ctx.name2 || '{{char}}';

    // 초를 mm:ss 형태로 변환
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const timeStr = `${m}:${String(s).padStart(2, '0')}`;

    try {
        // 1. 음성메시지 말풍선 삽입
        await slashSend(`🎤 음성메시지 (${timeStr})`);

        // 2. 힌트가 있으면 AI 반응 생성
        if (hint) {
            await slashGen(
                `${charName}에게 음성메시지가 도착했다. 내용: ${hint}. 이에 반응하라.`,
                charName
            );
        }

        showToast('음성메모 삽입 완료', 'success', 1500);
    } catch (e) {
        showToast('음성메모 삽입 실패: ' + e.message, 'error');
    }
}

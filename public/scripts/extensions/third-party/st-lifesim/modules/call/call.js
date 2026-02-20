/**
 * call.js
 * 통화 & 통화기록 모듈
 * - AI 응답에서 통화 감지 키워드 탐지
 * - 유저가 직접 통화 시작 가능
 * - 통화 중 상단 배너 표시
 * - 통화 시작/종료 마커 삽입
 * - 종료 시 AI가 통화 내용 자동 요약
 * - 통화 기록 아카이브 관리
 * - 부재중 전화 연출
 */

import { getContext } from '../../utils/st-context.js';
import { slashSend } from '../../utils/slash.js';
import { loadData, saveData, getDefaultBinding } from '../../utils/storage.js';
import { showToast, escapeHtml, generateId } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';

const MODULE_KEY = 'call-logs';

// 통화 감지 키워드 설정 저장 키
const KEYWORDS_KEY = 'call-keywords';

// 통화 감지 키워드 (설정에서 변경 가능)
const DEFAULT_KEYWORDS = ['전화할게', '전화 걸게', '전화해도 돼', '전화 줄게', 'call', 'phone'];

// 통화 진행 중 상태
let callActive = false;

/**
 * 현재 통화 중인지 여부를 반환한다
 * @returns {boolean}
 */
export function isCallActive() {
    return callActive;
}
let callStartTime = null;
let callContact = '';
let callStartMessageIdx = -1; // 통화 시작 당시 채팅 메시지 인덱스

/**
 * 통화 로그 데이터 불러오기
 * @returns {Object[]}
 */
function loadCallLogs() {
    return loadData(MODULE_KEY, [], getDefaultBinding());
}

/**
 * 통화 로그 저장
 * @param {Object[]} logs
 */
function saveCallLogs(logs) {
    saveData(MODULE_KEY, logs, getDefaultBinding());
}

/**
 * 통화 모듈을 초기화한다 — AI 응답 감지 이벤트 리스너 등록
 */
export function initCall() {
    const ctx = getContext();
    if (!ctx || !ctx.eventSource) return;

    const eventTypes = ctx.event_types || ctx.eventTypes;
    if (!eventTypes?.CHARACTER_MESSAGE_RENDERED) return;

    // AI 응답 완료 시 통화 키워드 감지
    ctx.eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, (data) => {
        detectCallKeywords(data);
    });
}

/**
 * AI 응답 텍스트에서 통화 키워드를 감지한다
 * @param {*} data - 메시지 데이터
 */
function detectCallKeywords(data) {
    if (callActive) return; // 이미 통화 중이면 무시

    // 마지막 AI 메시지 텍스트 가져오기
    const ctx = getContext();
    const lastMsg = ctx.chat?.[ctx.chat.length - 1];
    if (!lastMsg || lastMsg.is_user) return;

    const text = (lastMsg.mes || '').toLowerCase();
    const keywords = loadData(KEYWORDS_KEY, DEFAULT_KEYWORDS, getDefaultBinding());
    const found = keywords.some(kw => text.includes(kw.toLowerCase()));

    if (!found) return;

    // 토스트로 확인 요청
    const toast = document.createElement('div');
    toast.className = 'slm-toast slm-toast-info slm-call-toast';
    toast.innerHTML = `
        <span>📞 통화를 시작하시겠습니까?</span>
        <button class="slm-btn slm-btn-primary slm-btn-sm" id="slm-call-confirm">확인</button>
        <button class="slm-btn slm-btn-secondary slm-btn-sm" id="slm-call-ignore">무시</button>
    `;

    let container = document.getElementById('slm-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'slm-toast-container';
        document.body.appendChild(container);
    }
    container.appendChild(toast);

    toast.querySelector('#slm-call-confirm').onclick = async () => {
        toast.remove();
        const freshCtx = getContext();
        const charName = freshCtx.name2 || '{{char}}';
        await startCall(charName);
    };
    toast.querySelector('#slm-call-ignore').onclick = () => toast.remove();

    // 10초 후 자동 제거
    setTimeout(() => toast.remove(), 10000);
}

/**
 * 통화 중 상단 배너를 표시한다
 * @param {string} charName
 */
function showCallBanner(charName) {
    let banner = document.getElementById('slm-call-banner');
    if (banner) banner.remove();

    banner = document.createElement('div');
    banner.id = 'slm-call-banner';

    const textEl = document.createElement('span');
    textEl.id = 'slm-call-banner-text';
    textEl.textContent = `📞 통화 중... ${charName}`;

    const endBtn = document.createElement('button');
    endBtn.id = 'slm-call-banner-end';
    endBtn.textContent = '📵 통화 종료';
    endBtn.onclick = () => endCall();

    banner.appendChild(textEl);
    banner.appendChild(endBtn);
    document.body.appendChild(banner);

    // 배너 시간 업데이트 (통화 경과 시간)
    const timer = setInterval(() => {
        if (!callActive) { clearInterval(timer); return; }
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        textEl.textContent = `📞 통화 중... ${charName}  (${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')})`;
    }, 1000);
}

/**
 * 통화 중 배너를 제거한다
 */
function removeCallBanner() {
    const banner = document.getElementById('slm-call-banner');
    if (banner) banner.remove();
}

/**
 * 통화를 시작한다
 * @param {string} charName - 통화 상대 이름
 */
async function startCall(charName) {
    if (callActive) return;

    callActive = true;
    callStartTime = Date.now();
    callContact = charName;

    // 통화 시작 직전 채팅 메시지 인덱스 기록
    const ctx = getContext();
    callStartMessageIdx = (ctx.chat?.length ?? 1) - 1;

    try {
        await slashSend(`📞 통화 시작 — ${charName}`);
    } catch (e) {
        console.error('[ST-LifeSim] 통화 시작 오류:', e);
    }

    // 상단 배너 표시
    showCallBanner(charName);

    showToast(`통화 시작: ${charName}`, 'info');
}

/**
 * 통화를 종료하고 AI 요약을 생성한다
 */
async function endCall() {
    if (!callActive) return;

    const duration = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    const timeStr = `${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`;

    callActive = false;
    const endedContact = callContact;
    const startIdx = callStartMessageIdx;
    callStartTime = null;
    callContact = '';
    callStartMessageIdx = -1;

    // 상단 배너 제거
    removeCallBanner();

    // 통화 종료 메시지 삽입
    try {
        await slashSend(`📵 통화 종료 (통화시간: ${timeStr})`);
    } catch (e) {
        console.error('[ST-LifeSim] 통화 종료 오류:', e);
    }

    // AI가 통화 내용 요약 생성 (채팅창에 보이지 않는 조용한 생성)
    let summary = '';
    try {
        const ctx = getContext();
        const chatLen = ctx?.chat?.length ?? 0;
        const startFrom = Math.max(0, startIdx);
        const callMsgs = ctx?.chat?.slice(startFrom, chatLen) ?? [];
        if (callMsgs.length > 0 && typeof ctx?.generateQuietPrompt === 'function') {
            const msgText = callMsgs.map(m => `${m.is_user ? '{{user}}' : m.name}: ${m.mes}`).join('\n');
            const summaryPrompt = `The following is the conversation transcript from a call with ${endedContact}. Write a concise 2-3 sentence summary of what was discussed during the call:\n${msgText}`;
            summary = await ctx.generateQuietPrompt({ quietPrompt: summaryPrompt, quietName: endedContact }) || '';
        }
    } catch (e) {
        console.error('[ST-LifeSim] 통화 요약 생성 오류:', e);
        showToast('통화 요약 생성 실패 (기록은 저장됩니다)', 'warn', 2500);
    }

    // 통화 기록 저장
    const logs = loadCallLogs();
    logs.push({
        id: generateId(),
        contactName: endedContact,
        date: new Date().toISOString(),
        durationSeconds: duration,
        summary,
        startMessageIdx: startIdx,
        includeInContext: false,
        binding: getDefaultBinding(),
    });
    saveCallLogs(logs);

    showToast(`통화 종료 (${timeStr})`, 'success');
}

/**
 * 통화 기록 팝업을 연다
 */
export function openCallLogsPopup(onBack) {
    const content = buildCallLogsContent();
    createPopup({
        id: 'call-logs',
        title: '📞 통화기록',
        content,
        className: 'slm-call-panel',
        onBack,
    });
}

/**
 * 통화 기록 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildCallLogsContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-call-wrapper';

    // 직접 전화 걸기 섹션
    const dialSection = document.createElement('div');
    dialSection.className = 'slm-dial-wrapper slm-form';

    const dialTitle = document.createElement('h4');
    dialTitle.style.cssText = 'margin:0 0 8px;font-size:14px;font-weight:600;color:var(--slm-text)';
    dialTitle.textContent = '📲 전화 걸기';
    dialSection.appendChild(dialTitle);

    const dialRow = document.createElement('div');
    dialRow.className = 'slm-input-row';

    const dialInput = document.createElement('input');
    dialInput.className = 'slm-input';
    dialInput.type = 'text';
    dialInput.placeholder = '상대방 이름 입력';

    // {{char}} 이름을 기본값으로 설정
    const ctx0 = getContext();
    if (ctx0?.name2) dialInput.value = ctx0.name2;

    const dialBtn = document.createElement('button');
    dialBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    dialBtn.innerHTML = '📞 발신';
    dialBtn.onclick = async () => {
        const name = dialInput.value.trim();
        if (!name) { showToast('이름을 입력해주세요.', 'warn'); return; }
        if (callActive) { showToast('이미 통화 중입니다.', 'warn'); return; }
        // 팝업 닫고 통화 시작
        const overlay = document.getElementById('slm-overlay-call-logs');
        if (overlay) overlay.remove();
        await startCall(name);
    };

    dialRow.appendChild(dialInput);
    dialRow.appendChild(dialBtn);
    dialSection.appendChild(dialRow);
    wrapper.appendChild(dialSection);

    const hr0 = document.createElement('hr');
    hr0.className = 'slm-hr';
    wrapper.appendChild(hr0);

    const logs = loadCallLogs();

    if (logs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'slm-empty';
        empty.textContent = '통화 기록이 없습니다.';
        wrapper.appendChild(empty);
        return wrapper;
    }

    // 연락처 탭 (전체 + 각 인물)
    const contacts = ['전체', ...new Set(logs.map(l => l.contactName))];
    const tabBar = document.createElement('div');
    tabBar.className = 'slm-tab-bar';

    let currentContact = '전체';

    const logList = document.createElement('div');
    logList.className = 'slm-call-list';

    function renderLogs() {
        logList.innerHTML = '';
        const filtered = currentContact === '전체'
            ? logs
            : logs.filter(l => l.contactName === currentContact);

        filtered.slice().reverse().forEach(log => {
            const row = document.createElement('div');
            row.className = 'slm-call-row';

            const d = new Date(log.date);
            const dateStr = d.toLocaleDateString('ko-KR');
            const mMin = Math.floor(log.durationSeconds / 60);
            const sSec = log.durationSeconds % 60;
            const durStr = `${mMin}분 ${String(sSec).padStart(2, '0')}초`;

            const infoDiv = document.createElement('div');
            infoDiv.className = 'slm-call-info';
            infoDiv.innerHTML = `
                <span class="slm-call-icon">📞</span>
                <span class="slm-call-name">${escapeHtml(log.contactName)}</span>
                <span class="slm-call-date">${escapeHtml(dateStr)}</span>
                <span class="slm-call-dur">${escapeHtml(durStr)}</span>
            `;
            row.appendChild(infoDiv);

            // 요약 표시
            if (log.summary) {
                const sumDiv = document.createElement('div');
                sumDiv.className = 'slm-call-summary';
                sumDiv.textContent = `📝 ${log.summary}`;
                row.appendChild(sumDiv);
            }

            // 통화 시작 위치로 점프 버튼
            if (typeof log.startMessageIdx === 'number' && log.startMessageIdx >= 0) {
                const jumpBtn = document.createElement('button');
                jumpBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm slm-jump-btn';
                jumpBtn.textContent = '📌 대화 이동';
                jumpBtn.onclick = async () => {
                    try {
                        const ctx = getContext();
                        await ctx.executeSlashCommandsWithOptions(`/chat-jump ${log.startMessageIdx}`, { showOutput: false });
                    } catch (e) {
                        showToast('이동 실패', 'error', 2000);
                    }
                };
                row.appendChild(jumpBtn);
            }

            logList.appendChild(row);
        });
    }

    contacts.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'slm-tab-btn' + (name === currentContact ? ' active' : '');
        btn.textContent = name;
        btn.onclick = () => {
            currentContact = name;
            tabBar.querySelectorAll('.slm-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderLogs();
        };
        tabBar.appendChild(btn);
    });

    wrapper.appendChild(tabBar);
    wrapper.appendChild(logList);

    // 부재중 전화 연출 버튼
    const missedRow = document.createElement('div');
    missedRow.className = 'slm-missed-row';

    const missedInput = document.createElement('input');
    missedInput.className = 'slm-input';
    missedInput.type = 'text';
    missedInput.placeholder = '상대방 이름';

    const missedBtn = document.createElement('button');
    missedBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    missedBtn.textContent = '📵 부재중 연출';
    missedBtn.onclick = async () => {
        const name = missedInput.value.trim();
        if (!name) { showToast('이름을 입력해주세요.', 'warn'); return; }
        await slashSend(`📵 부재중 전화 — ${name} (3회)`);
        showToast('부재중 전화 삽입', 'success', 1500);
    };

    missedRow.appendChild(missedInput);
    missedRow.appendChild(missedBtn);
    wrapper.appendChild(missedRow);

    renderLogs();
    return wrapper;
}

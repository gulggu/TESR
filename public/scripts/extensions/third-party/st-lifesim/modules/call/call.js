/**
 * call.js
 * 통화 & 통화기록 모듈
 * - AI 응답에서 통화 감지 키워드 탐지
 * - 통화 시작/종료 마커 삽입
 * - 통화 기록 아카이브 관리
 * - 부재중 전화 연출
 */

import { getContext } from '../../../../../st-context.js';
import { slashSend } from '../../utils/slash.js';
import { loadData, saveData } from '../../utils/storage.js';
import { showToast } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';

const MODULE_KEY = 'call-logs';

// 통화 감지 키워드 설정 저장 키
const KEYWORDS_KEY = 'call-keywords';

// 통화 감지 키워드 (설정에서 변경 가능)
const DEFAULT_KEYWORDS = ['전화할게', '전화 걸게', '전화해도 돼', '전화 줄게', 'call', 'phone'];

// 통화 진행 중 상태
let callActive = false;
let callStartTime = null;
let callContact = '';
let callEndBtn = null;

/**
 * 통화 로그 데이터 불러오기
 * @returns {Object[]}
 */
function loadCallLogs() {
    return loadData(MODULE_KEY, [], 'chat');
}

/**
 * 통화 로그 저장
 * @param {Object[]} logs
 */
function saveCallLogs(logs) {
    saveData(MODULE_KEY, logs, 'chat');
}

/**
 * 통화 모듈을 초기화한다 — AI 응답 감지 이벤트 리스너 등록
 */
export function initCall() {
    const ctx = getContext();
    if (!ctx || !ctx.eventSource) return;

    // AI 응답 완료 시 통화 키워드 감지
    ctx.eventSource.on(ctx.event_types.CHARACTER_MESSAGE_RENDERED, (data) => {
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
    const keywords = loadData(KEYWORDS_KEY, DEFAULT_KEYWORDS, 'chat');
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
        // 클릭 시점에 신선한 컨텍스트를 가져온다
        const freshCtx = getContext();
        const charName = freshCtx.name2 || '{{char}}';
        await startCall(charName);
    };
    toast.querySelector('#slm-call-ignore').onclick = () => toast.remove();

    // 10초 후 자동 제거
    setTimeout(() => toast.remove(), 10000);
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

    try {
        await slashSend(`📞 통화 시작 — ${charName}`);
    } catch (e) {
        console.error('[ST-LifeSim] 통화 시작 오류:', e);
    }

    // 툴바에 통화 종료 버튼 추가
    if (!callEndBtn) {
        callEndBtn = document.createElement('button');
        callEndBtn.id = 'slm-call-end-btn';
        callEndBtn.className = 'slm-call-end-btn';
        callEndBtn.textContent = '📵 통화 종료';
        callEndBtn.onclick = () => endCall();

        // floating dock에 추가
        const dock = document.getElementById('slm-dock');
        if (dock) dock.appendChild(callEndBtn);
    }

    showToast(`통화 시작: ${charName}`, 'info');
}

/**
 * 통화를 종료한다
 */
async function endCall() {
    if (!callActive) return;

    const duration = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    const timeStr = `${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`;

    callActive = false;
    callStartTime = null;

    // 통화 종료 메시지 삽입
    try {
        await slashSend(`📵 통화 종료 (통화시간: ${timeStr})`);
    } catch (e) {
        console.error('[ST-LifeSim] 통화 종료 오류:', e);
    }

    // 종료 버튼 제거
    if (callEndBtn) { callEndBtn.remove(); callEndBtn = null; }

    // 통화 기록 저장 확인
    const logs = loadCallLogs();
    logs.push({
        id: crypto.randomUUID(),
        contactName: callContact,
        date: new Date().toISOString(),
        durationSeconds: duration,
        includeInContext: false,
        binding: 'chat',
    });
    saveCallLogs(logs);

    showToast(`통화 종료 (${timeStr})`, 'success');
    callContact = '';
}

/**
 * 통화 기록 팝업을 연다
 */
export function openCallLogsPopup() {
    const content = buildCallLogsContent();
    createPopup({
        id: 'call-logs',
        title: '📞 통화기록',
        content,
        className: 'slm-call-panel',
    });
}

/**
 * 통화 기록 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildCallLogsContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-call-wrapper';

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
            const m = Math.floor(log.durationSeconds / 60);
            const s = log.durationSeconds % 60;
            const durStr = `${m}분 ${String(s).padStart(2, '0')}초`;

            row.innerHTML = `
                <div class="slm-call-info">
                    <span class="slm-call-icon">📞</span>
                    <span class="slm-call-name">${log.contactName}</span>
                    <span class="slm-call-date">${dateStr}</span>
                    <span class="slm-call-dur">${durStr}</span>
                </div>
            `;

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

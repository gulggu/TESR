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
import { slashSend, slashSendAs } from '../../utils/slash.js';
import { loadData, saveData, getDefaultBinding } from '../../utils/storage.js';
import { showToast, escapeHtml, generateId } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';

const MODULE_KEY = 'call-logs';

// 통화 감지 키워드 설정 저장 키
const KEYWORDS_KEY = 'call-keywords';

// 통화 중 컨텍스트 주입 태그
const CALL_INJECT_TAG = 'st-lifesim-call';

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
let callIsMainChar = true;   // 통화 상대가 {{char}}인지 여부
let isReinjectingCallMessage = false; // 비-char 통화 메시지 재주입 중복 방지

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
 * 비-char 통화 중 컨텍스트 주입
 * @param {string} charName - 통화 상대 이름
 * @param {Object|null} matchedContact - 연락처 정보
 */
function injectCallContext(charName, matchedContact) {
    const ctx = getContext();
    if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;

    let prompt = `[ACTIVE PHONE CALL]\n{{user}}는 지금 ${charName}와(과) 전화 통화 중입니다. ${charName}는 {{char}}가 아닙니다.\n`;
    if (matchedContact?.personality) prompt += `${charName}의 성격: ${matchedContact.personality}\n`;
    if (matchedContact?.relationToUser) prompt += `${charName}의 {{user}}와의 관계: ${matchedContact.relationToUser}\n`;
    if (matchedContact?.description) prompt += `${charName} 설명: ${matchedContact.description}\n`;
    prompt += `중요: 이 전화 통화 동안 반드시 ${charName}로서만 응답하고, {{char}}로서는 응답하지 마십시오. 통화 내내 ${charName}의 프로필과 성격에 충실하게 유지하세요.`;

    ctx.setExtensionPrompt(CALL_INJECT_TAG, prompt, 1, 0);
}

/**
 * 통화 컨텍스트 주입 제거
 */
function clearCallContext() {
    const ctx = getContext();
    if (ctx && typeof ctx.setExtensionPrompt === 'function') {
        ctx.setExtensionPrompt(CALL_INJECT_TAG, '', 1, 0);
    }
}

/**
 * 통화 모듈을 초기화한다 — AI 응답 감지 이벤트 리스너 등록
 */
export function initCall() {
    const ctx = getContext();
    if (!ctx || !ctx.eventSource) return;

    const eventTypes = ctx.event_types || ctx.eventTypes;
    if (!eventTypes?.CHARACTER_MESSAGE_RENDERED) return;

    // AI 응답 완료 시 통화 키워드 감지 + 비-char 통화 메시지 재주입
    ctx.eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, async () => {
        detectCallKeywords();

        // 비-char 통화 중: AI 응답을 "전화" 이름으로 재주입
        if (callActive && !callIsMainChar && !isReinjectingCallMessage) {
            const freshCtx = getContext();
            if (!freshCtx) return;
            const lastMsg = freshCtx.chat?.[freshCtx.chat.length - 1];
            if (!lastMsg || lastMsg.is_user || lastMsg.name === '전화') return;

            const content = lastMsg.mes;
            const msgIdx = (freshCtx.chat?.length ?? 1) - 1;

            isReinjectingCallMessage = true;
            try {
                await freshCtx.executeSlashCommandsWithOptions(`/hide ${msgIdx}`, { showOutput: false });
                await slashSendAs('전화', content);
            } catch (e) {
                console.error('[ST-LifeSim] 통화 메시지 재주입 오류:', e);
            } finally {
                isReinjectingCallMessage = false;
            }
        }
    });
}

/**
 * AI 응답 텍스트에서 통화 키워드를 감지한다
 */
function detectCallKeywords() {
    if (callActive) return; // 이미 통화 중이면 무시

    // 마지막 AI 메시지 텍스트 가져오기
    const ctx = getContext();
    if (!ctx) return;
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
        const charName = freshCtx?.name2 || '{{char}}';
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
 * @param {Object|null} [matchedContact] - 연락처 정보 (비-char 통화 시 컨텍스트 주입용)
 */
async function startCall(charName, matchedContact = null) {
    if (callActive) return;

    const ctx = getContext();
    const activeChar = ctx?.name2 || '{{char}}';
    const isMainChar = charName === activeChar;

    callActive = true;
    callIsMainChar = isMainChar;
    callStartTime = Date.now();
    callContact = charName;

    // 통화 시작 직전 채팅 메시지 인덱스 기록
    callStartMessageIdx = (ctx?.chat?.length ?? 1) - 1;

    // 비-char 통화 시 컨텍스트 주입
    if (!isMainChar) {
        injectCallContext(charName, matchedContact);
    }

    try {
        if (isMainChar) {
            await slashSend(`📞 통화 시작 — ${charName}`);
        } else {
            await slashSendAs('전화', `📞 통화 시작 — ${charName}와(과) 연결되었습니다.`);
        }
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
    const wasMainChar = callIsMainChar;
    callStartTime = null;
    callContact = '';
    callStartMessageIdx = -1;
    callIsMainChar = true;

    // 비-char 통화 컨텍스트 주입 제거
    if (!wasMainChar) {
        clearCallContext();
    }

    // 상단 배너 제거
    removeCallBanner();

    // 통화 종료 메시지 삽입
    const ctx = getContext();

    try {
        if (wasMainChar) {
            await slashSend(`📵 통화 종료 (통화시간: ${timeStr})`);
        } else {
            await slashSendAs('전화', `📵 통화 종료 (통화시간: ${timeStr})`);
        }
    } catch (e) {
        console.error('[ST-LifeSim] 통화 종료 오류:', e);
    }
    const endIdx = ((getContext()?.chat?.length ?? 1) - 1);

    // AI가 통화 내용 요약 생성 (채팅창에 보이지 않는 조용한 생성)
    let summary = '';
    try {
        const chatLen = ctx?.chat?.length ?? 0;
        const startFrom = Math.max(0, startIdx);
        const callMsgs = ctx?.chat?.slice(startFrom, chatLen) ?? [];
        if (callMsgs.length > 0 && typeof ctx?.generateQuietPrompt === 'function') {
            const msgText = callMsgs.map(m => `${m.is_user ? '{{user}}' : m.name}: ${m.mes}`).join('\n');
            const summaryPrompt = `The following is the conversation transcript from a call with ${endedContact}. Write a concise 2-3 sentence summary IN KOREAN of what was discussed during the call. The summary must be written in Korean regardless of the conversation language. Character names may be kept as-is:\n${msgText}`;
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
        endMessageIdx: endIdx,
        includeInContext: false,
        binding: getDefaultBinding(),
    });
    saveCallLogs(logs);

    showToast(`통화 종료 (${timeStr})`, 'success');
}

/**
 * 발신 시 AI가 착신/거부를 결정한다
 * 거부 시 부재중 처리, 착신 시 통화 시작
 * @param {string} charName
 */
async function initiateCallWithAiDecision(charName) {
    const ctx = getContext();
    const activeChar = ctx?.name2 || '{{char}}';
    const isMainChar = charName === activeChar;
    const matchedContact = getContacts('chat').find(c => c.name === charName);

    // 발신 중 메시지 삽입
    try {
        if (isMainChar) {
            await slashSend(`📱 발신 중... ${charName}`);
        } else {
            await slashSendAs(charName, '📱 {{user}}의 전화 요청...');
        }
    } catch (e) {
        console.error('[ST-LifeSim] 발신 메시지 오류:', e);
    }

    // AI에게 착신 여부를 결정하게 한다
    let acceptCall = true;
    try {
        if (ctx && typeof ctx.generateQuietPrompt === 'function') {
            const userName = ctx.name1 || 'the user';
            const decisionPrompt = buildCallDecisionPrompt({
                charName,
                userName,
                isMainChar,
                matchedContact,
                activeChar,
            });
            const decision = await ctx.generateQuietPrompt({ quietPrompt: decisionPrompt, quietName: charName }) || 'ACCEPT';
            acceptCall = !decision.toUpperCase().includes('REJECT');
        }
    } catch (e) {
        console.error('[ST-LifeSim] 착신 결정 오류:', e);
    }

    if (!acceptCall) {
        // 거부: 부재중 처리
        try {
            await slashSend(`📵 부재중 전화 — ${charName} (착신 거부)`);
        } catch (e) {
            console.error('[ST-LifeSim] 착신 거부 메시지 오류:', e);
        }
        // 부재중 로그 저장
        const logs = loadCallLogs();
        logs.push({
            id: generateId(),
            contactName: charName,
            date: new Date().toISOString(),
            durationSeconds: 0,
            summary: '착신 거부',
            startMessageIdx: -1,
            endMessageIdx: -1,
            includeInContext: false,
            missed: true,
            binding: getDefaultBinding(),
        });
        saveCallLogs(logs);
        showToast(`${charName}이(가) 전화를 거부했습니다.`, 'warn', 3000);
    } else {
        // 착신 수락: 통화 시작 (matchedContact 전달)
        await startCall(charName, matchedContact);
    }
}

function buildCallDecisionPrompt({ charName, userName, isMainChar, matchedContact, activeChar }) {
    if (isMainChar) {
        return `${charName} is receiving a phone call from ${userName}. Based on the current situation and ${charName}'s personality and mood, decide whether to ACCEPT or REJECT the call. Reply with only one word: "ACCEPT" or "REJECT".`;
    }
    const personality = matchedContact?.personality ? ` Personality: ${matchedContact.personality}.` : '';
    const relation = matchedContact?.relationToUser ? ` Relationship to {{user}}: ${matchedContact.relationToUser}.` : '';
    return `${charName} is NOT {{char}}. ${charName} is a contact of {{user}}.${personality}${relation} Decide if ${charName} accepts the incoming call from ${userName}. If ${activeChar} is mentioned, refer to ${activeChar} indirectly (e.g., "아, 그 녀석 얘기구나"). Reply with only one word: "ACCEPT" or "REJECT".`;
}


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

    // 연락처 드롭다운
    const ctx0 = getContext();
    const charName0 = ctx0?.name2;
    const dialSelect = document.createElement('select');
    dialSelect.className = 'slm-select';
    const customOpt = document.createElement('option');
    customOpt.value = '';
    customOpt.textContent = '직접 입력...';
    dialSelect.appendChild(customOpt);
    if (charName0) {
        const opt = document.createElement('option');
        opt.value = charName0;
        opt.textContent = `📞 ${charName0} (캐릭터)`;
        opt.selected = true;
        dialSelect.appendChild(opt);
    }
    getContacts('chat').forEach(c => {
        if (c.name !== charName0) {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            dialSelect.appendChild(opt);
        }
    });

    const dialInput = document.createElement('input');
    dialInput.className = 'slm-input';
    dialInput.type = 'text';
    dialInput.placeholder = '직접 이름 입력';
    dialInput.style.display = 'none';

    dialSelect.onchange = () => {
        dialInput.style.display = dialSelect.value === '' ? 'block' : 'none';
    };

    const dialBtn = document.createElement('button');
    dialBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    dialBtn.innerHTML = '📞 발신';
    dialBtn.onclick = async () => {
        const name = (dialSelect.value || dialInput.value).trim();
        if (!name) { showToast('이름을 입력해주세요.', 'warn'); return; }
        if (callActive) { showToast('이미 통화 중입니다.', 'warn'); return; }
        // 팝업 닫고 AI 착신 여부 판단
        const overlay = document.getElementById('slm-overlay-call-logs');
        if (overlay) overlay.remove();
        await initiateCallWithAiDecision(name);
    };

    dialRow.appendChild(dialSelect);
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

            const mMin = Math.floor(log.durationSeconds / 60);
            const sSec = log.durationSeconds % 60;
            const durStr = `${mMin}분 ${String(sSec).padStart(2, '0')}초`;

            const infoDiv = document.createElement('div');
            infoDiv.className = 'slm-call-info';
            infoDiv.innerHTML = `
                <span class="slm-call-icon">${log.missed ? '📵' : '📞'}</span>
                <span class="slm-call-name">${escapeHtml(log.contactName)}</span>
                <span class="slm-call-dur">${escapeHtml(durStr)}</span>
            `;
            row.appendChild(infoDiv);

            // 요약 표시 (인라인 수정 가능)
            const sumDiv = document.createElement('div');
            sumDiv.className = 'slm-call-summary';
            sumDiv.textContent = log.summary ? `📝 ${log.summary}` : '';
            row.appendChild(sumDiv);

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

            const actionRow = document.createElement('div');
            actionRow.className = 'slm-btn-row';

            if (typeof log.startMessageIdx === 'number' && typeof log.endMessageIdx === 'number'
                && log.startMessageIdx >= 0 && log.endMessageIdx >= log.startMessageIdx) {
                const hideBtn = document.createElement('button');
                hideBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
                hideBtn.textContent = '🙈 컨텍스트 제외';
                hideBtn.onclick = async () => {
                    try {
                        const ctx = getContext();
                        await ctx.executeSlashCommandsWithOptions(`/hide ${log.startMessageIdx}-${log.endMessageIdx}`, { showOutput: false });
                        showToast('통화 구간을 컨텍스트에서 제외했습니다.', 'success', 1600);
                    } catch (e) {
                        showToast('컨텍스트 제외 실패', 'error', 2000);
                    }
                };
                actionRow.appendChild(hideBtn);
            }

            // 수정 버튼
            const editBtn = document.createElement('button');
            editBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
            editBtn.textContent = '✏️ 수정';
            editBtn.onclick = () => {
                openCallLogEditDialog(log, logs, renderLogs);
            };
            actionRow.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
            deleteBtn.textContent = '🗑️ 삭제';
            deleteBtn.onclick = async () => {
                // /cut 명령으로 채팅 구간 삭제
                if (typeof log.startMessageIdx === 'number' && typeof log.endMessageIdx === 'number'
                    && log.startMessageIdx >= 0 && log.endMessageIdx >= log.startMessageIdx) {
                    try {
                        const ctx = getContext();
                        await ctx.executeSlashCommandsWithOptions(`/cut ${log.startMessageIdx}-${log.endMessageIdx}`, { showOutput: false });
                    } catch (e) {
                        console.error('[ST-LifeSim] /cut 오류:', e);
                    }
                }
                const all = loadCallLogs().filter(x => x.id !== log.id);
                saveCallLogs(all);
                const idx = logs.findIndex(x => x.id === log.id);
                if (idx !== -1) logs.splice(idx, 1);
                renderLogs();
                showToast('통화 기록 삭제됨', 'success', 1400);
            };
            actionRow.appendChild(deleteBtn);
            row.appendChild(actionRow);

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
        try {
            await slashSend(`📵 부재중 전화 — ${name} (3회)`);
            showToast('부재중 전화 삽입', 'success', 1500);
        } catch (e) {
            showToast('부재중 전화 삽입 실패', 'error');
        }
    };

    missedRow.appendChild(missedInput);
    missedRow.appendChild(missedBtn);
    wrapper.appendChild(missedRow);

    renderLogs();
    return wrapper;
}

/**
 * 통화 기록 수정 다이얼로그를 연다
 * @param {Object} log - 통화 기록
 * @param {Object[]} logs - 전체 기록 배열 (참조)
 * @param {Function} onUpdate - 갱신 콜백
 */
function openCallLogEditDialog(log, logs, onUpdate) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';

    const sumLabel = document.createElement('label');
    sumLabel.className = 'slm-label';
    sumLabel.textContent = '통화 요약';
    const sumInput = document.createElement('textarea');
    sumInput.className = 'slm-textarea';
    sumInput.rows = 3;
    sumInput.value = log.summary || '';

    wrapper.appendChild(sumLabel);
    wrapper.appendChild(sumInput);

    const footer = document.createElement('div');
    footer.className = 'slm-panel-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'slm-btn slm-btn-secondary';
    cancelBtn.textContent = '취소';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'slm-btn slm-btn-primary';
    saveBtn.textContent = '저장';

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    const { close } = createPopup({
        id: 'call-log-edit',
        title: '✏️ 통화 기록 수정',
        content: wrapper,
        footer,
        className: 'slm-sub-panel',
        onBack: () => openCallLogsPopup(),
    });

    cancelBtn.onclick = () => close();
    saveBtn.onclick = () => {
        const newSummary = sumInput.value.trim();
        const all = loadCallLogs();
        const idx = all.findIndex(x => x.id === log.id);
        if (idx !== -1) {
            all[idx].summary = newSummary;
            saveCallLogs(all);
            const logIdx = logs.findIndex(x => x.id === log.id);
            if (logIdx !== -1) logs[logIdx].summary = newSummary;
        }
        close();
        onUpdate();
        showToast('수정 완료', 'success', 1200);
    };
}

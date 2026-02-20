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
import { slashSend, slashSendAs, slashGen } from '../../utils/slash.js';
import { loadData, saveData, getDefaultBinding } from '../../utils/storage.js';
import { showToast, showConfirm, escapeHtml, generateId } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';

const MODULE_KEY = 'call-logs';

// 통화 감지 키워드 설정 저장 키
const KEYWORDS_KEY = 'call-keywords';

// 통화 중 컨텍스트 주입 태그
const CALL_INJECT_TAG = 'st-lifesim-call';
const CALL_POLICY_TAG = 'st-lifesim-call-policy';
const INCOMING_CALL_CONFIDENCE_THRESHOLD = 0.5;
const PROACTIVE_CALL_COOLDOWN_MS = 30000;
const PROACTIVE_CALL_DELAY_MS = 12000;

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
let lastIncomingCallCheckedIdx = -1;
let incomingCallUiOpen = false;
let lastProactiveCallAt = 0;

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
    injectCallPolicyPrompt();

    const eventTypes = ctx.event_types || ctx.eventTypes;
    if (!eventTypes?.CHARACTER_MESSAGE_RENDERED) return;

    // AI 응답 완료 시 통화 키워드 감지 + 비-char 통화 메시지 재주입
    ctx.eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, async () => {
        await detectCallKeywords();

        // 비-char 통화 중: AI 응답을 "전화" 이름으로 재주입
        if (callActive && !callIsMainChar && !isReinjectingCallMessage) {
            const freshCtx = getContext();
            if (!freshCtx) return;
            const lastMsg = freshCtx.chat?.[freshCtx.chat.length - 1];
            if (!lastMsg || lastMsg.is_user || lastMsg.name === '전화') return;

            const content = lastMsg.mes;
            const beforeSendLen = freshCtx.chat?.length ?? 0;

            isReinjectingCallMessage = true;
            try {
                await slashSendAs('전화', content);
                const latestChatLen = getContext()?.chat?.length ?? 0;
                const latestIdx = latestChatLen - 1;
                const maxSafeIdx = Math.max(0, latestChatLen - 1);
                const cutIdx = beforeSendLen > 0 ? Math.min(Math.max(0, latestIdx - 1), Math.min(beforeSendLen - 1, maxSafeIdx)) : -1;
                if (cutIdx >= 0) {
                    await freshCtx.executeSlashCommandsWithOptions(`/cut ${cutIdx}`, { showOutput: false });
                }
            } catch (e) {
                console.error('[ST-LifeSim] 통화 메시지 재주입 오류:', e);
            } finally {
                isReinjectingCallMessage = false;
            }
        }
    });
}

/**
 * 유저 메시지 전송 시 확률적으로 수신전화를 트리거한다
 * @param {number} probabilityPercent - 0~100
 */
export async function triggerProactiveIncomingCall(probabilityPercent) {
    if (callActive || incomingCallUiOpen) return;
    const chance = Math.max(0, Math.min(100, Number(probabilityPercent) || 0)) / 100;
    if (chance <= 0 || Math.random() >= chance) return;
    if (Date.now() - lastProactiveCallAt < PROACTIVE_CALL_COOLDOWN_MS) return;
    const charName = getContext()?.name2;
    if (!charName) return;
    lastProactiveCallAt = Date.now();
    await new Promise(resolve => setTimeout(resolve, PROACTIVE_CALL_DELAY_MS));
    if (callActive || incomingCallUiOpen) return;
    await showIncomingCallDialog(charName);
}

function injectCallPolicyPrompt() {
    const ctx = getContext();
    if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
    const prompt = `[PHONE CALL ROLEPLAY POLICY]
- Never assume an active phone call unless an explicit call-start marker appears in chat.
- Before a call starts, speak as normal chat text.
- If you want to call first, explicitly ask or state that you are calling now in a natural way, then wait for user action.
- Do not continue as if the call is already connected until the call is accepted.
- Make call initiation natural and context-driven (emotion, urgency, intimacy), not repetitive.`;
    ctx.setExtensionPrompt(CALL_POLICY_TAG, prompt, 1, 0);
}

/**
 * AI 응답 텍스트에서 통화 키워드를 감지한다
 */
async function detectCallKeywords() {
    if (callActive || incomingCallUiOpen) return; // 이미 통화 중이면 무시

    // 마지막 AI 메시지 텍스트 가져오기
    const ctx = getContext();
    if (!ctx) return;
    const msgIdx = (ctx.chat?.length ?? 1) - 1;
    if (msgIdx <= lastIncomingCallCheckedIdx) return;
    const lastMsg = ctx.chat?.[ctx.chat.length - 1];
    if (!lastMsg || lastMsg.is_user) return;
    lastIncomingCallCheckedIdx = msgIdx;

    const text = (lastMsg.mes || '').toLowerCase();
    const keywords = [
        ...loadData(KEYWORDS_KEY, DEFAULT_KEYWORDS, getDefaultBinding()),
        '전화 받', '전화를 받을', 'call me', 'calling you', 'pick up', 'answer the phone', 'ringing',
    ];
    const found = keywords.some(kw => text.includes(String(kw).toLowerCase()));
    if (!found) return;

    const intent = await classifyIncomingCallIntent(lastMsg.mes || '');
    if (!intent.incoming) return;

    const charName = ctx?.name2 || '{{char}}';
    await showIncomingCallDialog(charName);
}

async function classifyIncomingCallIntent(messageText) {
    const ctx = getContext();
    const fallback = {
        incoming: /(전화할게|전화 걸게|calling you|pick up|answer)/i.test(messageText),
    };
    if (!ctx || typeof ctx.generateQuietPrompt !== 'function') return fallback;

    const prompt = `You are classifying an assistant message for phone-call intent.
Message:
"""${messageText}"""

Return JSON only:
{"incoming_call":true|false,"confidence":0.0-1.0}

Set incoming_call=true ONLY when the message clearly means "the caller is calling now and user should pick up/accept/reject".
Set false for hypothetical talk, future planning, roleplay narration of an already-active call, or vague mention of phone/call.
No prose, no markdown, JSON only.`;
    try {
        const raw = await ctx.generateQuietPrompt({ quietPrompt: prompt, quietName: 'call-intent' }) || '';
        const jsonPart = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonPart) return fallback;
        const parsed = JSON.parse(jsonPart);
        return { incoming: !!parsed.incoming_call && Number(parsed.confidence || 0) >= INCOMING_CALL_CONFIDENCE_THRESHOLD };
    } catch {
        return fallback;
    }
}

async function showIncomingCallDialog(charName) {
    if (incomingCallUiOpen) return;
    incomingCallUiOpen = true;

    const existing = document.getElementById('slm-incoming-call-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'slm-incoming-call-overlay';
    overlay.className = 'slm-incoming-call-overlay';

    const card = document.createElement('div');
    card.className = 'slm-incoming-call-card';
    const title = document.createElement('div');
    title.className = 'slm-incoming-call-title';
    title.textContent = '📲 수신 전화';
    const caller = document.createElement('div');
    caller.className = 'slm-incoming-call-caller';
    caller.textContent = charName;

    const row = document.createElement('div');
    row.className = 'slm-incoming-call-actions';
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'slm-btn slm-btn-primary';
    acceptBtn.textContent = '✅ 수락';
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'slm-btn slm-btn-danger';
    rejectBtn.textContent = '❌ 거절';
    row.append(acceptBtn, rejectBtn);

    card.append(title, caller, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = () => {
        overlay.remove();
        incomingCallUiOpen = false;
    };

    acceptBtn.onclick = async () => {
        cleanup();
        const matchedContact = getContacts('chat').find(c => c.name === charName) || null;
        await startCall(charName, matchedContact);
        await slashGen(
            'You just connected a phone call with {{user}}. Start the call naturally with one short opening utterance. Do not narrate that the call was already active before this moment.',
            charName,
        );
    };

    rejectBtn.onclick = async () => {
        cleanup();
        await slashSend(`📵 수신 거절 — ${charName}`);
        appendMissedCallLog(charName, '수신 거절');
        await slashGen(
            `${charName}'s call was rejected by {{user}}. Generate one short follow-up reaction as a normal chat message.`,
            charName,
        );
    };

}

function appendMissedCallLog(charName, summary) {
    const logs = loadCallLogs();
    logs.push({
        id: generateId(),
        contactName: charName,
        date: new Date().toISOString(),
        durationSeconds: 0,
        summary,
        startMessageIdx: -1,
        endMessageIdx: -1,
        includeInContext: false,
        missed: true,
        binding: getDefaultBinding(),
    });
    saveCallLogs(logs);
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
        return `${charName} is receiving a phone call from ${userName}. Decide whether to ACCEPT or REJECT based on context, mood, and personality. Rules: output only one word ("ACCEPT" or "REJECT"), avoid neutral/extra text, and be decisive.`;
    }
    const personality = matchedContact?.personality ? ` Personality: ${matchedContact.personality}.` : '';
    const relation = matchedContact?.relationToUser ? ` Relationship to {{user}}: ${matchedContact.relationToUser}.` : '';
    return `${charName} is NOT {{char}}. ${charName} is a contact of {{user}}.${personality}${relation} Decide if ${charName} accepts the incoming call from ${userName}. If ${activeChar} is mentioned, refer to ${activeChar} indirectly. Reply with only one word: "ACCEPT" or "REJECT".`;
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
            row.style.position = 'relative';

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

            const quickDeleteBtn = document.createElement('button');
            quickDeleteBtn.className = 'slm-call-quick-delete';
            quickDeleteBtn.type = 'button';
            quickDeleteBtn.title = '기록만 삭제';
            quickDeleteBtn.textContent = '✕';
            quickDeleteBtn.onclick = () => {
                const all = loadCallLogs().filter(x => x.id !== log.id);
                saveCallLogs(all);
                const idx = logs.findIndex(x => x.id === log.id);
                if (idx !== -1) logs.splice(idx, 1);
                renderLogs();
                showToast('통화 기록 삭제됨', 'success', 1400);
            };
            row.appendChild(quickDeleteBtn);

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
                hideBtn.textContent = log.includeInContext ? '🙈 컨텍스트 제외' : '🙉 컨텍스트 포함';
                hideBtn.onclick = async () => {
                    try {
                        const ctx = getContext();
                        const isCurrentlyIncluded = !!log.includeInContext;
                        await ctx.executeSlashCommandsWithOptions(`/${isCurrentlyIncluded ? 'hide' : 'unhide'} ${log.startMessageIdx}-${log.endMessageIdx}`, { showOutput: false });
                        const all = loadCallLogs();
                        const hit = all.find(x => x.id === log.id);
                        if (hit) hit.includeInContext = !isCurrentlyIncluded;
                        saveCallLogs(all);
                        log.includeInContext = !isCurrentlyIncluded;
                        hideBtn.textContent = log.includeInContext ? '🙈 컨텍스트 제외' : '🙉 컨텍스트 포함';
                        showToast(log.includeInContext ? '통화 구간을 컨텍스트에 포함했습니다.' : '통화 구간을 컨텍스트에서 제외했습니다.', 'success', 1600);
                    } catch (e) {
                        showToast('컨텍스트 설정 실패', 'error', 2000);
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

            const hardDeleteBtn = document.createElement('button');
            hardDeleteBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
            hardDeleteBtn.textContent = '🧹 완전삭제';
            hardDeleteBtn.onclick = async () => {
                const hasRange = Number.isInteger(log.startMessageIdx)
                    && Number.isInteger(log.endMessageIdx)
                    && log.startMessageIdx >= 0
                    && log.endMessageIdx >= log.startMessageIdx;
                if (!hasRange) {
                    quickDeleteBtn.click();
                    return;
                }
                const confirmed = await showConfirm('정말로 삭제하시겠습니까?', '예', '아니오');
                if (!confirmed) return;
                const ctx = getContext();
                if (!ctx?.executeSlashCommandsWithOptions) {
                    showToast('완전삭제를 실행할 수 없습니다.', 'error', 1800);
                    return;
                }
                const chatLen = ctx.chat?.length ?? 0;
                const startIdx = Math.max(0, Math.min(log.startMessageIdx, Math.max(0, chatLen - 1)));
                const endIdx = Math.max(startIdx, Math.min(log.endMessageIdx, Math.max(0, chatLen - 1)));
                try {
                    await ctx.executeSlashCommandsWithOptions(`/cut ${startIdx}-${endIdx}`, { showOutput: false });
                } catch (e) {
                    console.error('[ST-LifeSim] 통화 완전삭제 오류:', e);
                    showToast('대화 삭제 실패', 'error', 1800);
                    return;
                }
                quickDeleteBtn.click();
            };
            actionRow.appendChild(hardDeleteBtn);
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

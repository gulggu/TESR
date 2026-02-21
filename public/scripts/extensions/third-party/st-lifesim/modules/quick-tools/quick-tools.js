/**
 * quick-tools.js
 * 퀵 도구 모음 모듈
 * - 퀵 센드: 입력창 텍스트를 /send로 전송 (AI 응답 없음)
 * - 시간 구분선: 시간 경과 구분선 삽입 (직접 입력 + CSS/HTML 커스텀)
 * - 읽씹 연출: 읽음 표시 후 AI가 묘사 (유저 → char 방향)
 * - 연락 안 됨 연출: 연락 불가 상황 삽입 (유저 → char 방향)
 * - 사건 생성기: 카테고리별 사건 생성
 * - 음성메모 연출: 음성메시지 삽입 (내용힌트 토글)
 */

import { getContext } from '../../utils/st-context.js';
import { slashSend, slashGen, slashSendAs } from '../../utils/slash.js';
import { showToast, escapeHtml, generateId } from '../../utils/ui.js';
import { loadData, saveData, getExtensionSettings } from '../../utils/storage.js';

// 사건 기록 아카이브 저장 키
const ARCHIVE_KEY = 'event-archive';
const ARCHIVE_BINDING = 'chat';
const DEFAULT_IMAGE_RADIUS = 10;
const MAX_IMAGE_RADIUS = 50;

/**
 * 퀵 센드 버튼을 sendform의 전송 버튼(#send_but) 바로 앞에 삽입한다
 */
export function injectQuickSendButton() {
    if (document.getElementById('slm-quick-send-btn')) return;

    const sendBtn = document.getElementById('send_but');
    if (!sendBtn) {
        const observer = new MutationObserver(() => {
            if (document.getElementById('send_but')) {
                observer.disconnect();
                injectQuickSendButton();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return;
    }

    // 퀵 센드 버튼
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
    sendBtn.parentNode.insertBefore(btn, sendBtn);

    // 삭제된 메시지 버튼
    const delBtn = document.createElement('div');
    delBtn.id = 'slm-deleted-msg-btn';
    delBtn.className = 'slm-quick-send-btn interactable';
    delBtn.title = '삭제된 메시지 전송';
    delBtn.innerHTML = '🚫';
    delBtn.setAttribute('aria-label', '삭제된 메시지');
    delBtn.setAttribute('tabindex', '0');
    delBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleDeletedMessage();
    });
    sendBtn.parentNode.insertBefore(delBtn, sendBtn);
}

/**
 * 퀵 센드 동작: 입력창 텍스트를 /send로 전송
 */
async function handleQuickSend() {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) {
        showToast('보낼 내용을 입력해주세요.', 'warn');
        return;
    }

    try {
        await slashSend(text);
        textarea.value = '';
        textarea.dispatchEvent(new Event('input'));
    } catch (e) {
        showToast('전송 실패: ' + e.message, 'error');
    }
}

/**
 * 삭제된 메시지 전송: 유저가 삭제된 메시지를 보낸 것처럼 연출한다
 */
async function handleDeletedMessage() {
    try {
        await slashSend('*삭제된메세지입니다*');
        showToast('삭제된 메시지 전송', 'success', 1200);
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

    // 직접 입력 (시간/날짜 지정)
    const customRow = document.createElement('div');
    customRow.className = 'slm-input-row';

    const customInput = document.createElement('input');
    customInput.className = 'slm-input';
    customInput.type = 'text';
    customInput.placeholder = '직접 입력 (예: 2025년 5월 3일 오후 2시)';

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
    const text = `<div class="slm-time-divider"><span class="slm-time-divider-label">${escapeHtml(timeLabel)}</span></div>`;
    await slashSend(text);
}

/**
 * 읽씹 연출 UI를 렌더링한다
 * (유저가 char에게 하는 기능 — char는 메시지를 읽고 답장하지 않음)
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
    desc.textContent = '유저가 {{char}}에게 보낸 메시지를 읽었지만 답장하지 않는 상황을 연출합니다. (char는 지시사항에 따라 자율적으로 읽씹할 수 있습니다)';
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
    const charName = ctx?.name2 || '{{char}}';

    try {
        await slashGen(
            `${charName} has read the message but has not replied yet. Briefly describe the situation in 1-2 sentences.`,
            charName,
        );
        showToast('읽씹 연출 완료', 'success', 1500);
    } catch (e) {
        showToast('읽씹 연출 실패: ' + e.message, 'error');
    }
}

/**
 * 연락 안 됨 연출 UI를 렌더링한다
 * (char가 user에게 연락했지만 user가 보지 않음)
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
    desc.textContent = '{{char}}가 {{user}}에게 연락했지만 {{user}}가 아직 확인하지 않은 상황을 연출합니다.';
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
 * ({{char}}가 {{user}}에게 연락했지만 {{user}}가 확인하지 않은 상황)
 */
async function handleNoContact() {
    const ctx = getContext();
    const charName = ctx?.name2 || '{{char}}';

    try {
        await slashGen(
            `${charName} tried to reach the user but the user has not seen or responded yet. Briefly describe the situation in 1-2 sentences.`,
            charName,
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

    let eventTitle = `${category} 이벤트`;
    let eventContent = `${category} 카테고리의 사건이 발생했습니다.`;

    try {
        if (ctx && typeof ctx.generateQuietPrompt === 'function') {
            const titlePrompt = `Generate a SHORT title (under 10 words, in Korean) for an unexpected "${category}" category event that fits naturally into the current story context. Return ONLY the title text, nothing else.`;
            const titleResult = await ctx.generateQuietPrompt({ quietPrompt: titlePrompt, quietName: '이벤트' });
            if (titleResult) eventTitle = titleResult.trim();

            const contentPrompt = `사건 카테고리: "${category}", 사건 제목: "${eventTitle}". 현재 상황에 맞는 사건 내용을 한국어 2~4문장으로 작성하세요.
- 반드시 한국어만 사용하세요.
- 출력은 사건 설명 본문만 작성하세요.
- 해당 요청은 user와 char 사이의 메시지 주고받기를 더 재미있게 변화구를 주기 위한 것입니다.
- "현실에서 만나게 된다" 등 메신저 형식의 룰을 깨뜨리려는 내용은 일체 금지합니다.
- 제3자/전지적 작가 시점의 시스템 안내문 톤으로 작성하고, 절대 ${ctx?.name2 || '{{char}}'}로 롤플레잉하지 마세요.`;
            const contentResult = await ctx.generateQuietPrompt({ quietPrompt: contentPrompt, quietName: '이벤트' });
            if (contentResult) eventContent = contentResult.trim();
        }

        const formatted = buildEventCssMessage(eventTitle, eventContent);
        await slashSendAs('이벤트', formatted);

        const summary = `[${category}] ${eventTitle}`;
        const archive = loadData(ARCHIVE_KEY, [], ARCHIVE_BINDING);
        archive.push({
            id: generateId(),
            category,
            summary,
            includeInContext: false,
        });
        saveData(ARCHIVE_KEY, archive, ARCHIVE_BINDING);

        showToast(`사건 생성: ${category}`, 'success', 1500);
    } catch (e) {
        showToast('사건 생성 실패: ' + e.message, 'error');
    }
}

function buildEventCssMessage(title, content) {
    const safeTitle = escapeHtml(title);
    const safeContent = escapeHtml(content).replace(/\n/g, '<br>');
    return `<div class="slm-event-card"><strong>${safeTitle}</strong><br>${safeContent}</div>`;
}

/**
 * 사건 기록 아카이브를 표시한다
 * @param {HTMLElement} container - 렌더링할 컨테이너
 */
function showEventArchive(container) {
    const archive = loadData(ARCHIVE_KEY, [], ARCHIVE_BINDING);

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
            // 날짜 제거, 요약 내용 표시
            row.textContent = item.summary || `[${item.category}] 사건 발생`;
            archiveDiv.appendChild(row);
        });
    }

    container.appendChild(archiveDiv);
}

/**
 * 음성메모/이미지 연출 UI를 렌더링한다
 * @returns {HTMLElement}
 */
export function renderVoiceMemoUI() {
    const container = document.createElement('div');
    container.className = 'slm-tool-section';

    const title = document.createElement('h4');
    title.textContent = '🎤 음성메모 연출';
    container.appendChild(title);

    const voiceGrid = document.createElement('div');
    voiceGrid.className = 'slm-voice-memo-grid';
    const voiceLeft = document.createElement('div');
    const voiceRight = document.createElement('div');
    voiceRight.className = 'slm-voice-memo-actions';

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
    durationInput.value = '';
    durationInput.placeholder = '직접 입력';
    durationRow.appendChild(durationLabel);
    durationRow.appendChild(durationInput);
    voiceLeft.appendChild(durationRow);

    const hintBody = document.createElement('div');
    hintBody.style.marginTop = '6px';
    const hintInput = document.createElement('input');
    hintInput.className = 'slm-input';
    hintInput.type = 'text';
    hintInput.placeholder = '예: 오늘 늦겠다고';
    hintBody.appendChild(hintInput);
    voiceLeft.appendChild(hintBody);

    // 실행 버튼 (user → 유저가 보내는 음성메모)
    const btn = document.createElement('button');
    btn.className = 'slm-btn slm-btn-primary';
    btn.textContent = '🎤 음성메모 삽입 (유저)';
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            const secs = Math.max(1, parseInt(durationInput.value) || 1);
            const hint = hintInput.value.trim();
            await handleVoiceMemo(secs, hint, false);
            hintInput.value = '';
        } finally {
            btn.disabled = false;
        }
    };
    voiceRight.appendChild(btn);

    // AI(캐릭터)가 보내는 음성메시지 버튼
    const aiVoiceBtn = document.createElement('button');
    aiVoiceBtn.className = 'slm-btn slm-btn-secondary';
    aiVoiceBtn.textContent = '🤖 AI 음성메시지 (캐릭터)';
    aiVoiceBtn.title = 'AI(캐릭터)가 음성메시지를 보내는 상황을 연출합니다';
    aiVoiceBtn.onclick = async () => {
        aiVoiceBtn.disabled = true;
        try {
            const secs = Math.max(1, parseInt(durationInput.value) || 1);
            const hint = hintInput.value.trim();
            await handleVoiceMemo(secs, hint, true);
            hintInput.value = '';
        } finally {
            aiVoiceBtn.disabled = false;
        }
    };
    voiceRight.appendChild(aiVoiceBtn);
    voiceGrid.appendChild(voiceLeft);
    voiceGrid.appendChild(voiceRight);
    container.appendChild(voiceGrid);

    const imageTitle = document.createElement('h4');
    imageTitle.style.marginTop = '14px';
    imageTitle.textContent = '🖼️ 이미지 삽입';
    container.appendChild(imageTitle);

    const imageRow = document.createElement('div');
    imageRow.className = 'slm-input-row';
    const imageInput = document.createElement('input');
    imageInput.className = 'slm-input';
    imageInput.type = 'url';
    imageInput.placeholder = 'https://...';
    const imageBtn = document.createElement('button');
    imageBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    imageBtn.textContent = '삽입';

    const imageDescInput = document.createElement('input');
    imageDescInput.className = 'slm-input';
    imageDescInput.type = 'text';
    imageDescInput.placeholder = '사진 설명(선택)';

    imageBtn.onclick = async () => {
        const url = imageInput.value.trim();
        if (!url) return;
        const radius = Math.max(0, Math.min(MAX_IMAGE_RADIUS, Number(getExtensionSettings()?.['st-lifesim']?.imageRadius ?? DEFAULT_IMAGE_RADIUS)));
        const desc = imageDescInput.value.trim();
        const descHtml = desc ? `<br><em class="slm-quick-image-desc">${escapeHtml(desc)}</em>` : '';
        await slashSend(`<img src="${escapeHtml(url)}" alt="이미지" class="slm-quick-image" style="border-radius:${radius}px">${descHtml}`);
        imageInput.value = '';
        imageDescInput.value = '';
    };
    imageRow.appendChild(imageInput);
    imageRow.appendChild(imageDescInput);
    imageRow.appendChild(imageBtn);
    container.appendChild(imageRow);

    return container;
}

/**
 * 음성메모 연출 실행
 * @param {number} seconds - 음성메시지 길이(초)
 * @param {string} hint - 내용 힌트 (선택)
 * @param {boolean} aiMode - true면 AI(캐릭터)가 보내는 모드
 */
async function handleVoiceMemo(seconds, hint, aiMode = false) {
    const ctx = getContext();
    const charName = ctx?.name2 || '{{char}}';

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const timeStr = `${m}:${String(s).padStart(2, '0')}`;

    try {
        if (aiMode) {
            await slashGen(
                `As ${charName}, send exactly one voice message in Korean. You must choose suitable duration and content yourself based on current context.
Output only this HTML format:
🎤 음성메시지 (M:SS)<br>[actual voice message content]`,
                charName,
            );
            showToast(`${charName}의 음성메시지 생성 완료`, 'success', 1500);
        } else {
            const hintText = hint ? escapeHtml(hint) : '(내용 없음)';
            const voiceHtml = `🎤 음성메시지 (${timeStr})<br>${hintText}`;
            await slashSend(voiceHtml);
            showToast('음성메시지 삽입 완료', 'success', 1500);
        }
    } catch (e) {
        showToast('음성메모 삽입 실패: ' + e.message, 'error');
    }
}

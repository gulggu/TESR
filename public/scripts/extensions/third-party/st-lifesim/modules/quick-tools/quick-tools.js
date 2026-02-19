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

import { getContext } from '../../../../../st-context.js';
import { slashSend, slashGen, slashSendAs } from '../../utils/slash.js';
import { showToast } from '../../utils/ui.js';
import { loadData, saveData, getDefaultBinding } from '../../utils/storage.js';

// 사건 기록 아카이브 저장 키
const ARCHIVE_KEY = 'event-archive';
// 시간구분선 CSS 커스텀 저장 키
const DIVIDER_STYLE_KEY = 'divider-style';

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

    // CSS 커스텀 토글
    const cssToggle = document.createElement('div');
    cssToggle.className = 'slm-divider-css-toggle';
    cssToggle.textContent = '🎨 구분선 스타일 커스텀 ▸';
    container.appendChild(cssToggle);

    const cssBody = document.createElement('div');
    cssBody.style.display = 'none';
    container.appendChild(cssBody);

    const cssHint = document.createElement('p');
    cssHint.className = 'slm-desc';
    cssHint.textContent = 'HTML로 구분선 서식을 직접 지정하세요. 저장하면 이후 모든 구분선에 적용됩니다. (첫 줄/마지막 줄에 ``` 없이 입력)';
    cssBody.appendChild(cssHint);

    const savedStyle = loadData(DIVIDER_STYLE_KEY, '', getDefaultBinding());

    const cssInput = document.createElement('textarea');
    cssInput.className = 'slm-textarea';
    cssInput.rows = 3;
    cssInput.placeholder = '예: <div style="text-align:center;color:#888;border-top:1px solid #ccc;padding:6px 0">{TIME}</div>';
    cssInput.value = savedStyle;
    cssBody.appendChild(cssInput);

    const cssDesc2 = document.createElement('p');
    cssDesc2.className = 'slm-desc';
    cssDesc2.textContent = '{TIME} 자리에 시간 텍스트가 삽입됩니다.';
    cssBody.appendChild(cssDesc2);

    // 미리보기 영역
    const previewLabel = document.createElement('p');
    previewLabel.className = 'slm-desc';
    previewLabel.textContent = '미리보기:';
    cssBody.appendChild(previewLabel);

    const preview = document.createElement('div');
    preview.className = 'slm-divider-preview';
    cssBody.appendChild(preview);

    function updatePreview() {
        const val = cssInput.value.trim();
        const sampleTime = '1시간 후';
        if (val) {
            preview.innerHTML = val.replace('{TIME}', sampleTime);
        } else {
            preview.textContent = `─────────── ${sampleTime} ───────────`;
        }
    }
    cssInput.addEventListener('input', updatePreview);
    updatePreview();

    const cssBtnRow = document.createElement('div');
    cssBtnRow.className = 'slm-btn-row';

    const cssSaveBtn = document.createElement('button');
    cssSaveBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    cssSaveBtn.textContent = '스타일 저장';
    cssSaveBtn.onclick = () => {
        saveData(DIVIDER_STYLE_KEY, cssInput.value.trim(), getDefaultBinding());
        showToast('구분선 스타일 저장됨', 'success', 1500);
    };

    const cssResetBtn = document.createElement('button');
    cssResetBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    cssResetBtn.textContent = '기본으로';
    cssResetBtn.onclick = () => {
        cssInput.value = '';
        saveData(DIVIDER_STYLE_KEY, '', getDefaultBinding());
        updatePreview();
        showToast('기본 스타일로 복원', 'success', 1500);
    };

    cssBtnRow.appendChild(cssSaveBtn);
    cssBtnRow.appendChild(cssResetBtn);
    cssBody.appendChild(cssBtnRow);

    cssToggle.onclick = () => {
        const isOpen = cssBody.style.display !== 'none';
        cssBody.style.display = isOpen ? 'none' : 'block';
        cssToggle.textContent = isOpen ? '🎨 구분선 스타일 커스텀 ▸' : '🎨 구분선 스타일 커스텀 ▾';
        if (!isOpen) updatePreview();
    };

    return container;
}

/**
 * 시간 구분선을 채팅에 삽입한다
 * @param {string} timeLabel - 시간 텍스트
 */
async function insertTimeDivider(timeLabel) {
    const customStyle = loadData(DIVIDER_STYLE_KEY, '', getDefaultBinding());
    let text;
    if (customStyle) {
        // 커스텀 HTML 스타일 적용 — {TIME}을 실제 시간으로 치환
        const html = customStyle.replace('{TIME}', timeLabel);
        // SillyTavern 렌더링을 위해 코드블록으로 감싸기
        text = `\`\`\`\n${html}\n\`\`\``;
    } else {
        text = `─────────── ${timeLabel} ───────────`;
    }
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
    const charName = ctx.name2 || '{{char}}';

    try {
        await slashSend('읽음 ✓✓');
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
 */
async function handleNoContact() {
    const ctx = getContext();
    const charName = ctx.name2 || '{{char}}';

    try {
        await slashSend('📵 연결되지 않습니다');
        await slashGen(
            `${charName}가 유저에게 연락을 했지만 유저가 아직 확인하지 않은 상황을 짧게 묘사하라.`,
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
    const charName = ctx.name2 || '{{char}}';

    try {
        const prompt = `${category} 분류의 사건이 발생했다. 현재 상황에 어울리는 사건을 간결하게 묘사하라.`;
        await slashGen(prompt, charName);

        const archive = loadData(ARCHIVE_KEY, [], getDefaultBinding());
        archive.push({
            id: crypto.randomUUID(),
            date: new Date().toISOString(),
            category,
            includeInContext: false,
        });
        saveData(ARCHIVE_KEY, archive, getDefaultBinding());

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
    const archive = loadData(ARCHIVE_KEY, [], getDefaultBinding());

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
 * 음성메모 연출 UI를 렌더링한다 (내용힌트 기본 접힘)
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

    // 내용 힌트 토글 (기본 접힘)
    const hintToggle = document.createElement('div');
    hintToggle.className = 'slm-voice-hint-toggle';
    const hintChevron = document.createElement('span');
    hintChevron.className = 'slm-voice-hint-toggle-chevron';
    hintChevron.textContent = '▶';
    hintToggle.appendChild(hintChevron);
    hintToggle.appendChild(document.createTextNode(' 내용 힌트 (선택)'));
    container.appendChild(hintToggle);

    const hintBody = document.createElement('div');
    hintBody.style.display = 'none';
    hintBody.style.marginTop = '6px';

    const hintInput = document.createElement('input');
    hintInput.className = 'slm-input';
    hintInput.type = 'text';
    hintInput.placeholder = '예: 오늘 늦겠다고';
    hintBody.appendChild(hintInput);
    container.appendChild(hintBody);

    hintToggle.onclick = () => {
        const isOpen = hintBody.style.display !== 'none';
        hintBody.style.display = isOpen ? 'none' : 'block';
        hintChevron.textContent = isOpen ? '▶' : '▼';
        hintChevron.classList.toggle('open', !isOpen);
    };

    // 실행 버튼
    const btn = document.createElement('button');
    btn.className = 'slm-btn slm-btn-primary';
    btn.style.marginTop = '8px';
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

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const timeStr = `${m}:${String(s).padStart(2, '0')}`;

    try {
        await slashSend(`🎤 음성메시지 (${timeStr})`);

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

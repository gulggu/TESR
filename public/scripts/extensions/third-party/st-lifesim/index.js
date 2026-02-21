/**
 * index.js — ST-LifeSim 확장 진입점
 *
 * 역할:
 * 1. 모든 모듈을 로드하고 초기화한다
 * 2. sendform 옆에 퀵 센드 버튼을 삽입한다
 * 3. 화면 우하단에 플로팅 아이콘을 렌더링한다
 *    - 메인 버튼(✉️) 클릭 시 기능별 서브 아이콘 슬라이드
 *    - 서브 아이콘 클릭 시 해당 기능 패널 팝업
 *    - 드래그로 위치 변경 가능
 * 4. AI 응답마다 컨텍스트를 주입한다
 * 5. 유저 메시지 전송 시 설정 확률로 SNS 포스팅/반응 트리거
 * 6. 확장 전체 ON/OFF 및 각 모듈별 개별 활성화 관리
 */

import { getContext } from './utils/st-context.js';
import { getExtensionSettings } from './utils/storage.js';
import { injectContext, clearContext } from './utils/context-inject.js';
import { createPopup, createTabs, closePopup } from './utils/popup.js';
import { showToast, showConfirm } from './utils/ui.js';
import { exportAllData, importAllData, clearAllData } from './utils/storage.js';
import { injectQuickSendButton, renderTimeDividerUI, renderReadReceiptUI, renderNoContactUI, renderEventGeneratorUI, renderVoiceMemoUI } from './modules/quick-tools/quick-tools.js';
import { startFirstMsgTimer, renderFirstMsgSettingsUI } from './modules/firstmsg/firstmsg.js';
import { initEmoticon, openEmoticonPopup } from './modules/emoticon/emoticon.js';
import { initContacts, openContactsPopup } from './modules/contacts/contacts.js';
import { initCall, onCharacterMessageRenderedForProactiveCall, openCallLogsPopup, triggerProactiveIncomingCall } from './modules/call/call.js';
import { initWallet, openWalletPopup } from './modules/wallet/wallet.js';
import { initSns, openSnsPopup, triggerNpcPosting, triggerPendingCommentReaction, hasPendingCommentReaction } from './modules/sns/sns.js';
import { initCalendar, openCalendarPopup } from './modules/calendar/calendar.js';
import { initGifticon, openGifticonPopup, trackGifticonUsageFromCharacterMessage } from './modules/gifticon/gifticon.js';

// 설정 키
const SETTINGS_KEY = 'st-lifesim';

// 주간/야간 테마 저장 키 (localStorage)
const THEME_STORAGE_KEY = 'st-lifesim:forced-theme';
const ALWAYS_ON_MODULES = new Set(['quickTools', 'contacts']);
const AI_ROUTE_DEFAULTS = {
    api: '',
    chatSource: '',
    modelSettingKey: '',
    model: '',
};
const ROUTE_MODEL_KEY_BY_SOURCE = {
    openai: 'openai_model',
    claude: 'claude_model',
    makersuite: 'google_model',
    vertexai: 'vertexai_model',
    openrouter: 'openrouter_model',
    ai21: 'ai21_model',
    mistralai: 'mistralai_model',
    cohere: 'cohere_model',
    perplexity: 'perplexity_model',
    groq: 'groq_model',
    chutes: 'chutes_model',
    siliconflow: 'siliconflow_model',
    electronhub: 'electronhub_model',
    nanogpt: 'nanogpt_model',
    deepseek: 'deepseek_model',
    aimlapi: 'aimlapi_model',
    xai: 'xai_model',
    pollinations: 'pollinations_model',
    cometapi: 'cometapi_model',
    moonshot: 'moonshot_model',
    fireworks: 'fireworks_model',
    azure_openai: 'azure_openai_model',
    custom: 'custom_model',
    zai: 'zai_model',
};
const SNS_PROMPT_DEFAULTS = {
    postChar: 'Write exactly one SNS post for {{charName}}. Use natural language and tone that fit {{charName}}\'s nationality/background, personality, and current situation. Keep it 1-2 casual daily-life sentences. Avoid repeating topics or phrasing from recent posts. Do not include hashtags, image tags, quotation marks, other people\'s reactions/comments, or [caption: ...] blocks. Output only {{charName}}\'s own post text.',
    postContact: 'Write exactly one SNS post for {{authorName}}. Personality: {{personality}}. Use natural language and tone that fit {{authorName}}\'s nationality/background and daily context. Keep it 1-2 casual daily-life sentences and avoid repeating recent topics/phrasing. Do not include hashtags, image tags, quotation marks, other people\'s reactions/comments, or [caption: ...] blocks. Output only {{authorName}}\'s own post text.',
    imageDescription: 'For {{authorName}}\'s SNS post "{{postContent}}", write exactly one short sentence describing the attached image. Mention only visible content. Do not use hashtags, quotes, parentheses, or any "caption:" prefix.',
    reply: 'Write exactly one SNS reply for this thread.\nPost author: {{postAuthorName}} ({{postAuthorHandle}})\nPost: "{{postContent}}"\nTarget comment author: {{commentAuthorName}} ({{commentAuthorHandle}})\nTarget comment: "{{commentText}}"\nReply author: {{replyAuthorName}} ({{replyAuthorHandle}})\nRules: one sentence only from {{replyAuthorName}}\'s perspective; use only fixed @handles if needed; use natural language fitting {{replyAuthorName}}\'s background; no explanations, quotes, or hashtags. Personality hint: {{replyPersonality}}.',
    extraComment: 'Write exactly one additional SNS comment for this post.\nPost author: {{postAuthorName}} ({{postAuthorHandle}})\nPost: "{{postContent}}"\nComment author: {{extraAuthorName}} ({{extraAuthorHandle}})\nRules: one short sentence from {{extraAuthorName}}\'s perspective; use only fixed @handles if needed; use natural language fitting {{extraAuthorName}}\'s background; no explanations, quotes, or hashtags. Personality hint: {{extraPersonality}}.',
};

// 기본 설정
const DEFAULT_SETTINGS = {
    enabled: true,
    defaultBinding: 'chat',
    modules: {
        quickTools: true,
        emoticon: true,
        contacts: true,
        call: true,
        wallet: true,
        sns: true,
        calendar: true,
        gifticon: true,
    },
    emoticonSize: 80,   // px
    emoticonRadius: 10, // px
    imageRadius: 10, // px
    defaultSnsImageUrl: '', // SNS 기본 이미지 URL
    themeColors: {}, // CSS 커스텀 색상
    toast: {
        offsetY: 16,
        colors: {
            info: '#1c1c1e',
            success: '#34c759',
            warn: '#ffd60a',
            error: '#ff3b30',
        },
    },
    firstMsg: {
        enabled: false,
        intervalSec: 10,
        probability: 8,
    },
    snsPostingProbability: 10, // % (0~100)
    proactiveCallProbability: 0, // % (0~100)
    snsExternalApiUrl: '',
    snsExternalApiTimeoutMs: 12000,
    snsLanguage: 'ko',
    snsKoreanTranslationPrompt: 'Translate the following SNS text into natural Korean. Output Korean text only.\n{{text}}',
    snsPrompts: { ...SNS_PROMPT_DEFAULTS },
    aiRoutes: {
        sns: { ...AI_ROUTE_DEFAULTS },
        snsTranslation: { ...AI_ROUTE_DEFAULTS },
        callSummary: { ...AI_ROUTE_DEFAULTS },
        contactProfile: { ...AI_ROUTE_DEFAULTS },
    },
};

/**
 * 현재 설정을 가져온다
 * @returns {Object}
 */
function getSettings() {
    const ext = getExtensionSettings();
    if (!ext) return { ...DEFAULT_SETTINGS };
    if (!ext[SETTINGS_KEY]) {
        ext[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    }
    // 신규 필드 기본값 보완
    if (ext[SETTINGS_KEY].emoticonSize == null) {
        ext[SETTINGS_KEY].emoticonSize = DEFAULT_SETTINGS.emoticonSize;
    }
    if (ext[SETTINGS_KEY].emoticonRadius == null) {
        ext[SETTINGS_KEY].emoticonRadius = DEFAULT_SETTINGS.emoticonRadius;
    }
    if (ext[SETTINGS_KEY].imageRadius == null) {
        ext[SETTINGS_KEY].imageRadius = DEFAULT_SETTINGS.imageRadius;
    }
    if (ext[SETTINGS_KEY].defaultBinding == null) {
        ext[SETTINGS_KEY].defaultBinding = DEFAULT_SETTINGS.defaultBinding;
    }
    if (ext[SETTINGS_KEY].defaultSnsImageUrl == null) {
        ext[SETTINGS_KEY].defaultSnsImageUrl = '';
    }
    if (ext[SETTINGS_KEY].themeColors == null) {
        ext[SETTINGS_KEY].themeColors = {};
    }
    if (ext[SETTINGS_KEY].toast == null) {
        ext[SETTINGS_KEY].toast = { ...DEFAULT_SETTINGS.toast, colors: { ...DEFAULT_SETTINGS.toast.colors } };
    }
    if (ext[SETTINGS_KEY].toast.offsetY == null) {
        ext[SETTINGS_KEY].toast.offsetY = DEFAULT_SETTINGS.toast.offsetY;
    }
    if (ext[SETTINGS_KEY].toast.colors == null) {
        ext[SETTINGS_KEY].toast.colors = { ...DEFAULT_SETTINGS.toast.colors };
    }
    ['info', 'success', 'warn', 'error'].forEach((key) => {
        if (!ext[SETTINGS_KEY].toast.colors[key]) {
            ext[SETTINGS_KEY].toast.colors[key] = DEFAULT_SETTINGS.toast.colors[key];
        }
    });
    if (ext[SETTINGS_KEY].firstMsg == null) {
        ext[SETTINGS_KEY].firstMsg = { ...DEFAULT_SETTINGS.firstMsg };
    }
    if (ext[SETTINGS_KEY].modules?.gifticon == null) {
        if (!ext[SETTINGS_KEY].modules) ext[SETTINGS_KEY].modules = {};
        ext[SETTINGS_KEY].modules.gifticon = true;
    }
    ALWAYS_ON_MODULES.forEach((moduleKey) => {
        if (!ext[SETTINGS_KEY].modules) ext[SETTINGS_KEY].modules = {};
        ext[SETTINGS_KEY].modules[moduleKey] = true;
    });
    if (ext[SETTINGS_KEY].snsPostingProbability == null) {
        ext[SETTINGS_KEY].snsPostingProbability = DEFAULT_SETTINGS.snsPostingProbability;
    }
    if (ext[SETTINGS_KEY].proactiveCallProbability == null) {
        ext[SETTINGS_KEY].proactiveCallProbability = DEFAULT_SETTINGS.proactiveCallProbability;
    }
    if (typeof ext[SETTINGS_KEY].snsExternalApiUrl !== 'string') {
        ext[SETTINGS_KEY].snsExternalApiUrl = DEFAULT_SETTINGS.snsExternalApiUrl;
    }
    if (!Number.isFinite(ext[SETTINGS_KEY].snsExternalApiTimeoutMs)) {
        ext[SETTINGS_KEY].snsExternalApiTimeoutMs = DEFAULT_SETTINGS.snsExternalApiTimeoutMs;
    }
    if (!['ko', 'en', 'ja', 'zh'].includes(ext[SETTINGS_KEY].snsLanguage)) {
        ext[SETTINGS_KEY].snsLanguage = DEFAULT_SETTINGS.snsLanguage;
    }
    if (typeof ext[SETTINGS_KEY].snsKoreanTranslationPrompt !== 'string') {
        ext[SETTINGS_KEY].snsKoreanTranslationPrompt = DEFAULT_SETTINGS.snsKoreanTranslationPrompt;
    }
    if (!ext[SETTINGS_KEY].snsPrompts || typeof ext[SETTINGS_KEY].snsPrompts !== 'object') {
        ext[SETTINGS_KEY].snsPrompts = { ...SNS_PROMPT_DEFAULTS };
    }
    Object.keys(SNS_PROMPT_DEFAULTS).forEach((key) => {
        if (typeof ext[SETTINGS_KEY].snsPrompts[key] !== 'string') {
            ext[SETTINGS_KEY].snsPrompts[key] = SNS_PROMPT_DEFAULTS[key];
        }
    });
    if (!ext[SETTINGS_KEY].aiRoutes || typeof ext[SETTINGS_KEY].aiRoutes !== 'object') {
        ext[SETTINGS_KEY].aiRoutes = {
            sns: { ...AI_ROUTE_DEFAULTS },
            snsTranslation: { ...AI_ROUTE_DEFAULTS },
            callSummary: { ...AI_ROUTE_DEFAULTS },
            contactProfile: { ...AI_ROUTE_DEFAULTS },
        };
    }
    ['sns', 'snsTranslation', 'callSummary', 'contactProfile'].forEach((feature) => {
        if (!ext[SETTINGS_KEY].aiRoutes[feature] || typeof ext[SETTINGS_KEY].aiRoutes[feature] !== 'object') {
            ext[SETTINGS_KEY].aiRoutes[feature] = { ...AI_ROUTE_DEFAULTS };
        }
        Object.keys(AI_ROUTE_DEFAULTS).forEach((key) => {
            if (typeof ext[SETTINGS_KEY].aiRoutes[feature][key] !== 'string') {
                ext[SETTINGS_KEY].aiRoutes[feature][key] = AI_ROUTE_DEFAULTS[key];
            }
        });
    });
    return ext[SETTINGS_KEY];
}

/**
 * 확장이 활성화되어 있는지 확인한다
 * @returns {boolean}
 */
function isEnabled() {
    return getSettings().enabled !== false;
}

/**
 * 특정 모듈이 활성화되어 있는지 확인한다
 * @param {string} moduleKey
 * @returns {boolean}
 */
function isModuleEnabled(moduleKey) {
    if (ALWAYS_ON_MODULES.has(moduleKey)) return isEnabled();
    return isEnabled() && getSettings().modules?.[moduleKey] !== false;
}

/**
 * ST-LifeSim 메뉴 버튼을 sendform의 전송 버튼(#send_but) 바로 앞에 삽입한다
 */
function injectLifeSimMenuButton() {
    if (document.getElementById('slm-menu-btn')) return;

    const sendBtn = document.getElementById('send_but');
    if (!sendBtn) {
        const observer = new MutationObserver(() => {
            if (document.getElementById('send_but')) {
                observer.disconnect();
                injectLifeSimMenuButton();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return;
    }

    const btn = document.createElement('button');
    btn.id = 'slm-menu-btn';
    btn.className = 'slm-menu-btn interactable';
    btn.title = 'ST-LifeSim 메뉴';
    btn.innerHTML = '📱';
    btn.setAttribute('aria-label', 'ST-LifeSim 메뉴 열기');
    btn.setAttribute('tabindex', '0');

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (document.getElementById('slm-overlay-main-menu')) {
            closePopup('main-menu');
        } else {
            openMainMenuPopup();
        }
    });

    sendBtn.parentNode.insertBefore(btn, sendBtn);
}

/**
 * ST-LifeSim 메인 메뉴 팝업을 연다
 */
function openMainMenuPopup() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-main-menu';

    const themeBtn = document.createElement('button');
    themeBtn.className = 'slm-theme-toggle-btn';

    function updateThemeBtn() {
        const t = getForcedTheme();
        if (t === 'light') {
            themeBtn.innerHTML = '<span class="slm-theme-toggle-icon">☀️</span><span class="slm-theme-toggle-label">주간</span>';
            themeBtn.title = '야간 모드로 전환';
        } else {
            themeBtn.innerHTML = '<span class="slm-theme-toggle-icon">🌙</span><span class="slm-theme-toggle-label">야간</span>';
            themeBtn.title = '주간 모드로 전환';
        }
    }
    updateThemeBtn();

    themeBtn.onclick = (e) => {
        e.stopPropagation();
        const newTheme = cycleTheme();
        updateThemeBtn();
        const label = newTheme === 'light' ? '주간 모드' : '야간 모드';
        showToast(`테마: ${label}`, 'success', 1200);
    };

    const grid = document.createElement('div');
    grid.className = 'slm-menu-grid';
    wrapper.appendChild(grid);

    const popup = createPopup({
        id: 'main-menu',
        title: '📱 ST-LifeSim',
        content: wrapper,
        className: 'slm-main-menu-panel',
    });
    const titleLeft = popup.panel.querySelector('.slm-panel-title-left');
    if (titleLeft) titleLeft.appendChild(themeBtn);

    const menuItems = [
        { key: 'quickTools', icon: '🛠️', label: '퀵 도구', action: openQuickToolsPanel },
        { key: 'emoticon', icon: '😊', label: '이모티콘', action: openEmoticonPopup },
        { key: 'contacts', icon: '📋', label: '연락처', action: openContactsPopup },
        { key: 'call', icon: '📞', label: '통화', action: openCallLogsPopup },
        { key: 'wallet', icon: '💰', label: '지갑', action: openWalletPopup },
        { key: 'gifticon', icon: '🎁', label: '기프티콘', action: openGifticonPopup },
        { key: 'sns', icon: '📸', label: 'SNS', action: openSnsPopup },
        { key: 'calendar', icon: '📅', label: '캘린더', action: openCalendarPopup },
        { key: null, icon: '⚙️', label: '설정', action: openSettingsPanel },
    ];

    menuItems.filter(item => item.key === null || isModuleEnabled(item.key)).forEach(item => {
        const itemBtn = document.createElement('button');
        itemBtn.className = 'slm-menu-item';
        itemBtn.innerHTML = `<span class="slm-menu-icon">${item.icon}</span><span class="slm-menu-label">${item.label}</span>`;
        itemBtn.onclick = () => {
            popup.close();
            item.action(openMainMenuPopup);
        };
        grid.appendChild(itemBtn);
    });
}

/**
 * 퀵 도구 패널을 연다 (시간구분선, 읽씹, 연락안됨, 사건생성, 음성메모)
 */
function openQuickToolsPanel(onBack) {
    const tabs = createTabs([
        {
            key: 'divider',
            label: '⏱️ 구분선',
            content: renderTimeDividerUI(),
        },
        {
            key: 'read',
            label: '👻 읽씹/안읽씹',
            content: (() => {
                const c = document.createElement('div');
                c.appendChild(renderReadReceiptUI());
                c.appendChild(renderNoContactUI());
                return c;
            })(),
        },
        {
            key: 'event',
            label: '⚡ 사건 발생',
            content: renderEventGeneratorUI(),
        },
        {
            key: 'media',
            label: '🎤 음성/사진',
            content: renderVoiceMemoUI(),
        },
    ], 'divider');

    createPopup({
        id: 'quick-tools',
        title: '🛠️ 퀵 도구',
        content: tabs,
        className: 'slm-quick-panel',
        onBack,
    });
}

/**
 * 설정 패널을 연다 (탭 분리: 일반 / 모듈 / 이모티콘·SNS / 테마)
 */
function openSettingsPanel(onBack) {
    const settings = getSettings();

    // ─────────────────────────────────────────
    // 탭 1: 일반 설정
    // ─────────────────────────────────────────
    function buildGeneralTab() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slm-settings-wrapper slm-form';

        // 전체 활성화/비활성화
        const enabledRow = document.createElement('div');
        enabledRow.className = 'slm-settings-row';
        const enabledLabel = document.createElement('label');
        enabledLabel.className = 'slm-toggle-label';
        const enabledCheck = document.createElement('input');
        enabledCheck.type = 'checkbox';
        enabledCheck.checked = settings.enabled !== false;
        enabledCheck.onchange = () => {
            settings.enabled = enabledCheck.checked;
            saveSettings();
            if (!settings.enabled) {
                clearContext();
                showToast('ST-LifeSim 비활성화됨', 'info');
            } else {
                showToast('ST-LifeSim 활성화됨', 'success');
            }
            syncQuickSendButtons();
        };
        enabledLabel.appendChild(enabledCheck);
        enabledLabel.appendChild(document.createTextNode(' 라이프심 활성화'));
        enabledRow.appendChild(enabledLabel);
        wrapper.appendChild(enabledRow);

        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

        // 데이터 내보내기 / 가져오기
        const dataTitle = document.createElement('div');
        dataTitle.className = 'slm-label';
        dataTitle.textContent = '💾 데이터 백업 / 복원';
        dataTitle.style.fontWeight = '600';
        dataTitle.style.marginBottom = '6px';
        wrapper.appendChild(dataTitle);

        const dataBtnRow = document.createElement('div');
        dataBtnRow.className = 'slm-btn-row';

        const exportBtn = document.createElement('button');
        exportBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
        exportBtn.textContent = '📤 내보내기';
        exportBtn.onclick = () => {
            try {
                const json = exportAllData();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `st-lifesim-backup-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('데이터 내보내기 완료', 'success');
            } catch (e) {
                showToast('내보내기 실패: ' + e.message, 'error');
            }
        };

        const importInput = document.createElement('input');
        importInput.type = 'file';
        importInput.accept = '.json';
        importInput.style.display = 'none';
        importInput.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                importAllData(text);
                showToast('데이터 가져오기 완료. 페이지를 새로고침하세요.', 'success', 4000);
            } catch (err) {
                showToast('가져오기 실패: ' + err.message, 'error');
            }
            importInput.value = '';
        };

        const importBtn = document.createElement('button');
        importBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
        importBtn.textContent = '📥 가져오기';
        importBtn.onclick = () => importInput.click();

        dataBtnRow.appendChild(exportBtn);
        dataBtnRow.appendChild(importBtn);
        dataBtnRow.appendChild(importInput);
        wrapper.appendChild(dataBtnRow);

        const resetBtn = document.createElement('button');
        resetBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
        resetBtn.style.marginTop = '10px';
        resetBtn.textContent = '🧹 확장 설정 기본값으로 초기화';
        resetBtn.onclick = async () => {
            const confirmed = await showConfirm('진짜 초기화하시겠습니까?', '예', '아니오');
            if (!confirmed) return;
            clearAllData();
            localStorage.removeItem(THEME_STORAGE_KEY);
            const ext = getExtensionSettings();
            if (ext && ext[SETTINGS_KEY]) {
                delete ext[SETTINGS_KEY];
            }
            saveSettings();
            showToast('ST-LifeSim 설정/데이터가 초기화되었습니다. 새로고침합니다.', 'success', 1800);
            setTimeout(() => location.reload(), 2000);
        };
        wrapper.appendChild(resetBtn);

        return wrapper;
    }

    // ─────────────────────────────────────────
    // 탭 2: 모듈 관리
    // ─────────────────────────────────────────
    function buildModulesTab() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slm-settings-wrapper slm-form';

        const moduleList = [
            { key: 'quickTools', label: '🛠️ 퀵 도구' },
            { key: 'emoticon', label: '😊 이모티콘' },
            { key: 'contacts', label: '📋 연락처' },
            { key: 'call', label: '📞 통화 기록' },
            { key: 'wallet', label: '💰 지갑' },
            { key: 'gifticon', label: '🎁 기프티콘' },
            { key: 'sns', label: '📸 SNS' },
            { key: 'calendar', label: '📅 캘린더' },
        ];

        moduleList.forEach(m => {
            const row = document.createElement('div');
            row.className = 'slm-settings-row';

            const lbl = document.createElement('label');
            lbl.className = 'slm-toggle-label';

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = settings.modules?.[m.key] !== false;
            if (ALWAYS_ON_MODULES.has(m.key)) chk.disabled = true;
            chk.onchange = () => {
                if (!settings.modules) settings.modules = {};
                settings.modules[m.key] = chk.checked;
                saveSettings();
                syncQuickSendButtons();
            };

            lbl.appendChild(chk);
            lbl.appendChild(document.createTextNode(` ${m.label}${ALWAYS_ON_MODULES.has(m.key) ? ' (항상 활성화)' : ''}`));
            row.appendChild(lbl);
            wrapper.appendChild(row);
        });

        return wrapper;
    }

    // ─────────────────────────────────────────
    // 탭 3: 이모티콘 & SNS 설정
    // ─────────────────────────────────────────
    function buildMediaTab() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slm-settings-wrapper slm-form';

        // 이모티콘 크기
        const sizeRow = document.createElement('div');
        sizeRow.className = 'slm-input-row';
        const sizeLbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '이모티콘 크기:' });
        const sizeInput = Object.assign(document.createElement('input'), {
            className: 'slm-input slm-input-sm', type: 'number', min: '20', max: '300',
            value: String(settings.emoticonSize || 80),
        });
        sizeInput.style.width = '70px';
        const sizePxLbl = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: 'px' });
        const sizeApplyBtn = document.createElement('button');
        sizeApplyBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
        sizeApplyBtn.textContent = '적용';
        sizeApplyBtn.onclick = () => {
            settings.emoticonSize = Math.max(20, Math.min(300, parseInt(sizeInput.value) || 80));
            saveSettings();
            showToast(`이모티콘 크기: ${settings.emoticonSize}px`, 'success', 1500);
        };
        sizeRow.append(sizeLbl, sizeInput, sizePxLbl, sizeApplyBtn);
        wrapper.appendChild(sizeRow);

        // 이모티콘 모서리
        const radiusRow = document.createElement('div');
        radiusRow.className = 'slm-input-row';
        radiusRow.style.marginTop = '8px';
        const radiusLbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '이모티콘 모서리:' });
        const radiusInput = Object.assign(document.createElement('input'), {
            className: 'slm-input slm-input-sm', type: 'number', min: '0', max: '50',
            value: String(settings.emoticonRadius ?? 10),
        });
        radiusInput.style.width = '70px';
        const radiusPxLbl = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: 'px' });
        const radiusApplyBtn = document.createElement('button');
        radiusApplyBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
        radiusApplyBtn.textContent = '적용';
        radiusApplyBtn.onclick = () => {
            const val = parseInt(radiusInput.value);
            settings.emoticonRadius = Math.max(0, Math.min(50, isNaN(val) ? 10 : val));
            radiusInput.value = String(settings.emoticonRadius);
            document.documentElement.style.setProperty('--slm-emoticon-radius', settings.emoticonRadius + 'px');
            saveSettings();
            showToast(`이모티콘 모서리: ${settings.emoticonRadius}px`, 'success', 1500);
        };
        radiusRow.append(radiusLbl, radiusInput, radiusPxLbl, radiusApplyBtn);
        wrapper.appendChild(radiusRow);

        const imageRadiusRow = document.createElement('div');
        imageRadiusRow.className = 'slm-input-row';
        imageRadiusRow.style.marginTop = '8px';
        const imageRadiusLbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '이미지 모서리:' });
        const imageRadiusInput = Object.assign(document.createElement('input'), {
            className: 'slm-input slm-input-sm', type: 'number', min: '0', max: '50',
            value: String(settings.imageRadius ?? 10),
        });
        imageRadiusInput.style.width = '70px';
        const imageRadiusPxLbl = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: 'px' });
        const imageRadiusApplyBtn = document.createElement('button');
        imageRadiusApplyBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
        imageRadiusApplyBtn.textContent = '적용';
        imageRadiusApplyBtn.onclick = () => {
            const val = parseInt(imageRadiusInput.value);
            settings.imageRadius = Math.max(0, Math.min(50, isNaN(val) ? 10 : val));
            imageRadiusInput.value = String(settings.imageRadius);
            document.documentElement.style.setProperty('--slm-image-radius', settings.imageRadius + 'px');
            saveSettings();
            showToast(`이미지 모서리: ${settings.imageRadius}px`, 'success', 1500);
        };
        imageRadiusRow.append(imageRadiusLbl, imageRadiusInput, imageRadiusPxLbl, imageRadiusApplyBtn);
        wrapper.appendChild(imageRadiusRow);

        return wrapper;
    }

    function buildProbabilityTab() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slm-settings-wrapper slm-form';

        wrapper.appendChild(renderFirstMsgSettingsUI(settings, saveSettings));
        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

        const snsProbRow = document.createElement('div');
        snsProbRow.className = 'slm-input-row';
        const snsProbLbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: 'SNS 자동 생성 확률:' });
        const snsProbInput = Object.assign(document.createElement('input'), {
            className: 'slm-input slm-input-sm', type: 'number', min: '0', max: '100',
            value: String(settings.snsPostingProbability ?? 10),
        });
        snsProbInput.style.width = '70px';
        const snsProbPctLbl = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: '%' });
        const snsProbApplyBtn = document.createElement('button');
        snsProbApplyBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
        snsProbApplyBtn.textContent = '적용';
        snsProbApplyBtn.onclick = () => {
            const val = parseInt(snsProbInput.value);
            settings.snsPostingProbability = Math.max(0, Math.min(100, isNaN(val) ? 10 : val));
            snsProbInput.value = String(settings.snsPostingProbability);
            saveSettings();
            showToast(`SNS 자동 생성 확률: ${settings.snsPostingProbability}%`, 'success', 1500);
        };
        snsProbRow.append(snsProbLbl, snsProbInput, snsProbPctLbl, snsProbApplyBtn);
        wrapper.appendChild(snsProbRow);

        const callProbRow = document.createElement('div');
        callProbRow.className = 'slm-input-row';
        callProbRow.style.marginTop = '8px';
        const callProbLbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '먼저 전화를 걸 확률:' });
        const callProbInput = Object.assign(document.createElement('input'), {
            className: 'slm-input slm-input-sm', type: 'number', min: '0', max: '100',
            value: String(settings.proactiveCallProbability ?? 0),
        });
        callProbInput.style.width = '70px';
        const callProbPctLbl = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: '%' });
        const callProbApplyBtn = document.createElement('button');
        callProbApplyBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
        callProbApplyBtn.textContent = '적용';
        callProbApplyBtn.onclick = () => {
            const val = parseInt(callProbInput.value);
            settings.proactiveCallProbability = Math.max(0, Math.min(100, isNaN(val) ? 0 : val));
            callProbInput.value = String(settings.proactiveCallProbability);
            saveSettings();
            showToast(`선전화 확률: ${settings.proactiveCallProbability}%`, 'success', 1500);
        };
        callProbRow.append(callProbLbl, callProbInput, callProbPctLbl, callProbApplyBtn);
        wrapper.appendChild(callProbRow);

        return wrapper;
    }

    // ─────────────────────────────────────────
    // 탭 4: 테마 (CSS 색상 커스터마이징)
    // ─────────────────────────────────────────
    function buildThemeTab() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slm-settings-wrapper slm-form';

        const desc = document.createElement('p');
        desc.className = 'slm-desc';
        desc.textContent = '컬러 피커로 ST-LifeSim UI 색상을 자유롭게 변경하세요. 변경 즉시 적용됩니다.';
        wrapper.appendChild(desc);

        if (!settings.themeColors) settings.themeColors = {};

        const colorDefs = [
            { key: '--slm-primary', label: '주요 색 (버튼/강조)', defaultVal: '#007aff' },
            { key: '--slm-secondary', label: '보조 색 (보조 버튼)', defaultVal: '#6c757d' },
            { key: '--slm-bg', label: '패널 배경', defaultVal: '#ffffff' },
            { key: '--slm-surface', label: '카드/셀 배경', defaultVal: '#ffffff' },
            { key: '--slm-text', label: '텍스트 색', defaultVal: '#1c1c1e' },
            { key: '--slm-border', label: '테두리 색', defaultVal: '#c7c7cc' },
            { key: '--slm-accent', label: '액센트 색 (SNS 헤더 등)', defaultVal: '#007aff' },
        ];

        colorDefs.forEach(def => {
            const row = document.createElement('div');
            row.className = 'slm-input-row';
            row.style.marginBottom = '8px';

            const lbl = document.createElement('label');
            lbl.className = 'slm-label';
            lbl.style.flex = '1';
            lbl.textContent = def.label;

            const picker = document.createElement('input');
            picker.type = 'color';
            picker.className = 'slm-color-picker';
            // 저장된 색상 또는 현재 CSS 변수값 또는 기본값
            const savedColor = settings.themeColors[def.key];
            const currentCssVal = getComputedStyle(document.documentElement).getPropertyValue(def.key).trim();
            picker.value = normalizeColorValue(savedColor || currentCssVal, def.defaultVal);

            picker.oninput = () => {
                document.documentElement.style.setProperty(def.key, picker.value);
                settings.themeColors[def.key] = picker.value;
                saveSettings();
            };

            const resetBtn = document.createElement('button');
            resetBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
            resetBtn.textContent = '↺';
            resetBtn.title = '기본값으로 복원';
            resetBtn.onclick = () => {
                document.documentElement.style.setProperty(def.key, def.defaultVal);
                settings.themeColors[def.key] = def.defaultVal;
                picker.value = def.defaultVal;
                saveSettings();
            };

            row.appendChild(lbl);
            row.appendChild(picker);
            row.appendChild(resetBtn);
            wrapper.appendChild(row);
        });

        const resetAllBtn = document.createElement('button');
        resetAllBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
        resetAllBtn.style.marginTop = '12px';
        resetAllBtn.textContent = '🔄 전체 색상 초기화';
        resetAllBtn.onclick = () => {
            colorDefs.forEach((def, i) => {
                document.documentElement.style.setProperty(def.key, def.defaultVal);
                settings.themeColors[def.key] = def.defaultVal;
                // Update each color picker in place
                const pickers = wrapper.querySelectorAll('input[type="color"]');
                if (pickers[i]) pickers[i].value = def.defaultVal;
            });
            saveSettings();
            showToast('색상 초기화됨', 'success', 1500);
        };
        wrapper.appendChild(resetAllBtn);

        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));
        const toastTitle = Object.assign(document.createElement('div'), {
            className: 'slm-label',
            textContent: '🔔 팝업 알림(토스트)',
        });
        toastTitle.style.fontWeight = '700';
        wrapper.appendChild(toastTitle);

        const toastOffsetRow = document.createElement('div');
        toastOffsetRow.className = 'slm-input-row';
        const toastOffsetLbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '세로 위치:' });
        const toastOffsetInput = Object.assign(document.createElement('input'), {
            className: 'slm-input slm-input-sm', type: 'number', min: '0', max: '300',
            value: String(settings.toast?.offsetY ?? 16),
        });
        toastOffsetInput.style.width = '80px';
        const toastOffsetUnit = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: 'px' });
        const toastOffsetApply = document.createElement('button');
        toastOffsetApply.className = 'slm-btn slm-btn-primary slm-btn-sm';
        toastOffsetApply.textContent = '적용';
        toastOffsetApply.onclick = () => {
            settings.toast.offsetY = Math.max(0, Math.min(300, parseInt(toastOffsetInput.value) || 16));
            toastOffsetInput.value = String(settings.toast.offsetY);
            document.documentElement.style.setProperty('--slm-toast-top', `${settings.toast.offsetY}px`);
            saveSettings();
            showToast(`토스트 위치: ${settings.toast.offsetY}px`, 'success', 1200);
        };
        toastOffsetRow.append(toastOffsetLbl, toastOffsetInput, toastOffsetUnit, toastOffsetApply);
        wrapper.appendChild(toastOffsetRow);

        const toastColorDefs = [
            { key: 'info', label: '기본' },
            { key: 'success', label: '성공' },
            { key: 'warn', label: '경고' },
            { key: 'error', label: '오류' },
        ];
        toastColorDefs.forEach(({ key, label }) => {
            const row = document.createElement('div');
            row.className = 'slm-input-row';
            const lbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: `토스트 ${label}:` });
            lbl.style.flex = '1';
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.className = 'slm-color-picker';
            const fallback = DEFAULT_SETTINGS.toast.colors[key];
            picker.value = normalizeColorValue(settings.toast?.colors?.[key], fallback);
            picker.oninput = () => {
                settings.toast.colors[key] = picker.value;
                document.documentElement.style.setProperty(`--slm-toast-${key}`, picker.value);
                saveSettings();
            };
            row.append(lbl, picker);
            wrapper.appendChild(row);
        });

        return wrapper;
    }

    function buildSnsPromptTab() {
        const wrapper = document.createElement('div');
        wrapper.className = 'slm-settings-wrapper slm-form';
        if (!settings.aiRoutes) settings.aiRoutes = { sns: { ...AI_ROUTE_DEFAULTS }, snsTranslation: { ...AI_ROUTE_DEFAULTS }, callSummary: { ...AI_ROUTE_DEFAULTS }, contactProfile: { ...AI_ROUTE_DEFAULTS } };
        if (!settings.aiRoutes.sns) settings.aiRoutes.sns = { ...AI_ROUTE_DEFAULTS };
        if (!settings.aiRoutes.snsTranslation) settings.aiRoutes.snsTranslation = { ...AI_ROUTE_DEFAULTS };
        if (!settings.aiRoutes.callSummary) settings.aiRoutes.callSummary = { ...AI_ROUTE_DEFAULTS };
        if (!settings.aiRoutes.contactProfile) settings.aiRoutes.contactProfile = { ...AI_ROUTE_DEFAULTS };

        const apiRouteTitle = Object.assign(document.createElement('div'), {
            className: 'slm-label',
            textContent: '🤖 기능별 AI 모델 지정',
        });
        apiRouteTitle.style.fontWeight = '700';
        wrapper.appendChild(apiRouteTitle);

        const apiRouteDesc = Object.assign(document.createElement('div'), {
            className: 'slm-label',
            textContent: '공급자와 모델을 지정하면 해당 기능에만 별도 AI를 사용합니다. 비워두면 현재 전역 설정을 사용합니다.',
        });
        apiRouteDesc.style.fontSize = '12px';
        apiRouteDesc.style.marginBottom = '8px';
        wrapper.appendChild(apiRouteDesc);

        // 공급자별 표시 레이블 및 예시 모델
        const PROVIDER_OPTIONS = [
            { value: '', label: '전역 설정 사용 (기본)', models: [] },
            { value: 'openai', label: 'OpenAI (GPT)', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
            { value: 'claude', label: 'Claude (Anthropic)', models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'] },
            { value: 'makersuite', label: 'Google AI (Gemini)', models: ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'] },
            { value: 'openrouter', label: 'OpenRouter', models: ['google/gemini-2.0-flash-001', 'anthropic/claude-3.5-haiku', 'meta-llama/llama-3.3-70b-instruct'] },
            { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
            { value: 'groq', label: 'Groq', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
            { value: 'mistralai', label: 'Mistral AI', models: ['mistral-large-latest', 'mistral-small-latest'] },
            { value: 'xai', label: 'xAI (Grok)', models: ['grok-2-latest', 'grok-beta'] },
            { value: 'cohere', label: 'Cohere', models: ['command-r-plus', 'command-r'] },
            { value: 'perplexity', label: 'Perplexity', models: ['llama-3.1-sonar-large-128k-online'] },
            { value: 'vertexai', label: 'Vertex AI (Google Cloud)', models: ['gemini-2.5-pro', 'gemini-2.0-flash'] },
            { value: 'custom', label: '커스텀 API', models: [] },
        ];

        function buildAiRouteEditor(title, route) {
            const group = document.createElement('div');
            group.className = 'slm-form-group';
            const groupTitle = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: title });
            groupTitle.style.fontWeight = '600';
            group.appendChild(groupTitle);

            const sourceSelect = document.createElement('select');
            sourceSelect.className = 'slm-select';
            PROVIDER_OPTIONS.forEach(({ value, label }) => {
                sourceSelect.appendChild(Object.assign(document.createElement('option'), { value, textContent: label }));
            });
            const validSources = PROVIDER_OPTIONS.map(o => o.value);
            sourceSelect.value = validSources.includes(route.chatSource) ? route.chatSource : '';

            // Model preset dropdown
            const modelSelect = document.createElement('select');
            modelSelect.className = 'slm-select';

            // Direct-input field (shown when '✏️ 직접 입력' is chosen)
            const modelInput = document.createElement('input');
            modelInput.className = 'slm-input';
            modelInput.type = 'text';
            modelInput.placeholder = '모델명 직접 입력';
            modelInput.style.display = 'none';

            function refreshModelSelect() {
                const presets = PROVIDER_OPTIONS.find(o => o.value === sourceSelect.value)?.models || [];
                modelSelect.innerHTML = '';
                modelSelect.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: '-- 모델 선택 (전역 기본) --' }));
                presets.forEach(m => {
                    modelSelect.appendChild(Object.assign(document.createElement('option'), { value: m, textContent: m }));
                });
                modelSelect.appendChild(Object.assign(document.createElement('option'), { value: '__custom__', textContent: '✏️ 직접 입력' }));
                modelInput.placeholder = presets.length > 0 ? `예: ${presets[0]}` : '모델명 입력 (예: gpt-4o-mini)';

                const currentModel = route.model || '';
                if (!currentModel) {
                    modelSelect.value = '';
                    modelInput.style.display = 'none';
                } else if (presets.includes(currentModel)) {
                    modelSelect.value = currentModel;
                    modelInput.style.display = 'none';
                } else {
                    modelSelect.value = '__custom__';
                    modelInput.value = currentModel;
                    modelInput.style.display = '';
                }
            }

            sourceSelect.onchange = () => {
                route.chatSource = sourceSelect.value;
                route.api = '';
                route.modelSettingKey = ROUTE_MODEL_KEY_BY_SOURCE[route.chatSource] || '';
                route.model = '';
                refreshModelSelect();
                saveSettings();
            };
            group.appendChild(sourceSelect);

            modelSelect.onchange = () => {
                if (modelSelect.value === '__custom__') {
                    modelInput.style.display = '';
                    modelInput.focus();
                } else {
                    modelInput.style.display = 'none';
                    route.model = modelSelect.value;
                }
                saveSettings();
            };

            refreshModelSelect();
            modelInput.oninput = () => { route.model = modelInput.value.trim(); saveSettings(); };
            group.appendChild(modelSelect);
            group.appendChild(modelInput);

            wrapper.appendChild(group);
        }

        buildAiRouteEditor('SNS 생성 라우팅', settings.aiRoutes.sns);
        buildAiRouteEditor('SNS 번역 라우팅', settings.aiRoutes.snsTranslation);
        buildAiRouteEditor('통화 요약 라우팅', settings.aiRoutes.callSummary);
        buildAiRouteEditor('연락처 AI 생성 라우팅', settings.aiRoutes.contactProfile);
        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

        const endpointRow = document.createElement('div');
        endpointRow.className = 'slm-form-group';
        endpointRow.appendChild(Object.assign(document.createElement('label'), { className: 'slm-label', textContent: 'SNS 외부 API URL (선택)' }));
        const endpointSelect = document.createElement('select');
        endpointSelect.className = 'slm-select';
        const endpointOptions = ['', '/api/backends/chat-completions/generate', '/api/openai/chat/completions'];
        if (settings.snsExternalApiUrl && !endpointOptions.includes(settings.snsExternalApiUrl)) endpointOptions.push(settings.snsExternalApiUrl);
        endpointOptions.forEach((value) => {
            endpointSelect.appendChild(Object.assign(document.createElement('option'), {
                value,
                textContent: value || '내부 생성 사용',
            }));
        });
        endpointSelect.value = settings.snsExternalApiUrl || '';
        endpointSelect.onchange = () => {
            settings.snsExternalApiUrl = endpointSelect.value.trim();
            saveSettings();
        };
        endpointRow.appendChild(endpointSelect);
        wrapper.appendChild(endpointRow);

        const timeoutRow = document.createElement('div');
        timeoutRow.className = 'slm-input-row';
        const timeoutLabel = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '외부 API 타임아웃:' });
        const timeoutInput = Object.assign(document.createElement('input'), {
            className: 'slm-input slm-input-sm', type: 'number', min: '1000', max: '60000',
            value: String(settings.snsExternalApiTimeoutMs ?? 12000),
        });
        timeoutInput.style.width = '100px';
        const timeoutUnit = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: 'ms' });
        const timeoutApply = document.createElement('button');
        timeoutApply.className = 'slm-btn slm-btn-primary slm-btn-sm';
        timeoutApply.textContent = '적용';
        timeoutApply.onclick = () => {
            settings.snsExternalApiTimeoutMs = Math.max(1000, Math.min(60000, parseInt(timeoutInput.value) || 12000));
            timeoutInput.value = String(settings.snsExternalApiTimeoutMs);
            saveSettings();
        };
        timeoutRow.append(timeoutLabel, timeoutInput, timeoutUnit, timeoutApply);
        wrapper.appendChild(timeoutRow);
        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

        const translationPromptGroup = document.createElement('div');
        translationPromptGroup.className = 'slm-form-group';
        const translationPromptLabel = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '한글 번역 프롬프트 ({{text}} 사용)' });
        const translationPromptInput = document.createElement('textarea');
        translationPromptInput.className = 'slm-textarea';
        translationPromptInput.rows = 3;
        translationPromptInput.value = settings.snsKoreanTranslationPrompt || DEFAULT_SETTINGS.snsKoreanTranslationPrompt;
        translationPromptInput.oninput = () => {
            settings.snsKoreanTranslationPrompt = translationPromptInput.value;
            saveSettings();
        };
        translationPromptGroup.append(translationPromptLabel, translationPromptInput);
        wrapper.appendChild(translationPromptGroup);

        if (!settings.snsPrompts) settings.snsPrompts = { ...SNS_PROMPT_DEFAULTS };
        const promptDefs = [
            { key: 'postChar', label: '캐릭터 게시글 프롬프트' },
            { key: 'postContact', label: '연락처 게시글 프롬프트' },
            { key: 'imageDescription', label: '이미지 설명 프롬프트' },
            { key: 'reply', label: '답글 프롬프트' },
            { key: 'extraComment', label: '추가 댓글 프롬프트' },
        ];
        promptDefs.forEach(({ key, label }) => {
            const group = document.createElement('div');
            group.className = 'slm-form-group';
            const lbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: label });
            const input = document.createElement('textarea');
            input.className = 'slm-textarea';
            input.rows = 4;
            input.value = settings.snsPrompts[key] || SNS_PROMPT_DEFAULTS[key];
            input.oninput = () => {
                settings.snsPrompts[key] = input.value;
                saveSettings();
            };
            const resetBtn = document.createElement('button');
            resetBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
            resetBtn.textContent = '↺ 기본값';
            resetBtn.onclick = () => {
                settings.snsPrompts[key] = SNS_PROMPT_DEFAULTS[key];
                input.value = settings.snsPrompts[key];
                saveSettings();
            };
            group.append(lbl, input, resetBtn);
            wrapper.appendChild(group);
        });
        return wrapper;
    }

    const tabs = createTabs([
        { key: 'general', label: '⚙️ 일반', content: buildGeneralTab() },
        { key: 'modules', label: '🧩 모듈', content: buildModulesTab() },
        { key: 'media', label: '🖼️ 이미지', content: buildMediaTab() },
        { key: 'probability', label: '🎲 확률', content: buildProbabilityTab() },
        { key: 'theme', label: '🎨 테마', content: buildThemeTab() },
        { key: 'prompts', label: '📝 프롬프트', content: buildSnsPromptTab() },
    ], 'general');

    createPopup({
        id: 'settings',
        title: '⚙️ ST-LifeSim 설정',
        content: tabs,
        className: 'slm-sub-panel slm-settings-panel',
        onBack,
    });
}

/**
 * 설정을 저장한다
 */
function saveSettings() {
    const ctx = getContext();
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

function hasForcedCallIntentFromLatestUserMessage() {
    const ctx = getContext();
    const lastUserMsg = ctx?.chat?.[ctx.chat.length - 1];
    if (!lastUserMsg || !lastUserMsg.is_user) return false;
    const text = String(lastUserMsg.mes || '');
    // 전화 요청 패턴: "전화해줘", "call me" 등
    const callRequestRe = /전화\s*해|전화\s*줘|전화\s*걸어|전화\s*해줘|call\s*me|give\s*me\s*a\s*call|call\s*now/i;
    // 그리움/보고싶다 패턴: 전화 유도 강도 있는 표현
    const longingRe = /보고\s*싶[어다]|보고\s*싶[어다]고|그립[다워]|miss\s+you\b/i;
    return callRequestRe.test(text) || longingRe.test(text);
}

function syncQuickSendButtons() {
    const quickBtn = document.getElementById('slm-quick-send-btn');
    const deletedBtn = document.getElementById('slm-deleted-msg-btn');
    if (!isEnabled()) {
        quickBtn?.remove();
        deletedBtn?.remove();
        return;
    }
    if (isModuleEnabled('quickTools')) {
        injectQuickSendButton();
    }
}

// ── 주간/야간 테마 토글 ──────────────────────────────────────────
/**
 * 현재 강제 테마를 읽는다 ('light' | 'dark')
 * @returns {'light'|'dark'}
 */
function getForcedTheme() {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
}

/**
 * 강제 테마를 적용한다
 * @param {'light'|'dark'} theme
 */
function applyForcedTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-slm-theme', resolved);
    localStorage.setItem(THEME_STORAGE_KEY, resolved);
}

/**
 * 주간 ↔ 야간 테마를 순환한다
 * @returns {'light'|'dark'} 새 테마 값
 */
function cycleTheme() {
    const current = getForcedTheme();
    const next = current === 'light' ? 'dark' : 'light';
    applyForcedTheme(next);
    return next;
}

/**
 * 컬러피커에서 처리 가능한 HEX 색상값으로 정규화한다
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeColorValue(value, fallback) {
    const hex = (value || '').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : fallback;
}

/**
 * 확장 초기화 - SillyTavern이 준비된 후 실행된다
 */
async function init() {
    console.log('[ST-LifeSim] 초기화 시작');

    const ctx = getContext();
    if (!ctx) {
        console.error('[ST-LifeSim] 컨텍스트를 가져올 수 없습니다.');
        return false;
    }

    const settings = getSettings();

    // 이모티콘 모서리 반경 CSS 변수 적용
    document.documentElement.style.setProperty('--slm-emoticon-radius', (settings.emoticonRadius ?? 10) + 'px');
    document.documentElement.style.setProperty('--slm-image-radius', (settings.imageRadius ?? 10) + 'px');

    // 저장된 강제 테마 적용 (주간/야간 토글)
    applyForcedTheme(getForcedTheme());

    // 저장된 테마 색상 적용
    if (settings.themeColors) {
        Object.entries(settings.themeColors).forEach(([key, val]) => {
            if (key && val) document.documentElement.style.setProperty(key, val);
        });
    }
    document.documentElement.style.setProperty('--slm-toast-top', `${settings.toast?.offsetY ?? 16}px`);
    ['info', 'success', 'warn', 'error'].forEach((key) => {
        const val = settings.toast?.colors?.[key];
        if (val) document.documentElement.style.setProperty(`--slm-toast-${key}`, val);
    });

    // 각 모듈 초기화 (활성화된 경우만, 오류 발생 시 개별 모듈만 스킵)
    const moduleInits = [
        { key: 'emoticon', fn: initEmoticon },
        { key: 'contacts', fn: initContacts },
        { key: 'call', fn: initCall },
        { key: 'wallet', fn: initWallet },
        { key: 'sns', fn: initSns },
        { key: 'calendar', fn: initCalendar },
        { key: 'gifticon', fn: initGifticon },
    ];
    for (const { key, fn } of moduleInits) {
        if (isModuleEnabled(key)) {
            try { fn(); } catch (e) { console.error(`[ST-LifeSim] 모듈 초기화 오류 (${key}):`, e); }
        }
    }

    // 퀵 센드 버튼 삽입 (sendform 전송 버튼 옆)
    if (isEnabled() && isModuleEnabled('quickTools')) {
        try { injectQuickSendButton(); } catch (e) { console.error('[ST-LifeSim] 퀵 센드 버튼 오류:', e); }
    }

    // ST-LifeSim 메뉴 버튼 삽입 (sendform 옆)
    try { injectLifeSimMenuButton(); } catch (e) { console.error('[ST-LifeSim] 메뉴 버튼 오류:', e); }

    // 선톡 타이머 시작 (활성화된 경우)
    try { startFirstMsgTimer(settings.firstMsg); } catch (e) { console.error('[ST-LifeSim] 선톡 타이머 오류:', e); }

    // AI 응답 후 컨텍스트 주입
    const eventTypes = ctx.eventTypes || ctx.event_types;
    const evSrc = ctx.eventSource;

    if (evSrc && eventTypes?.CHARACTER_MESSAGE_RENDERED) {
        evSrc.on(eventTypes.CHARACTER_MESSAGE_RENDERED, async () => {
            if (isEnabled()) {
                await injectContext().catch(e => console.error('[ST-LifeSim] 컨텍스트 주입 오류:', e));
            }
        });
    }

    // 채팅 로드 시 컨텍스트 주입
    if (evSrc && eventTypes?.CHAT_CHANGED) {
        evSrc.on(eventTypes.CHAT_CHANGED, async () => {
            if (isEnabled()) {
                await injectContext().catch(e => console.error('[ST-LifeSim] 컨텍스트 주입 오류:', e));
            }
        });
    }

    // 유저 메시지 전송 시 설정된 확률로 SNS 포스팅 트리거
    if (evSrc && eventTypes?.MESSAGE_SENT) {
        let snsTriggerInFlight = false;
        let snsReactionInFlight = false;
        evSrc.on(eventTypes.MESSAGE_SENT, () => {
            if (isModuleEnabled('sns')) {
                const prob = (getSettings().snsPostingProbability ?? 10) / 100;
                if (!snsTriggerInFlight && Math.random() < prob) {
                    snsTriggerInFlight = true;
                    triggerNpcPosting()
                        .catch(e => console.error('[ST-LifeSim] SNS 자동 포스팅 오류:', e))
                        .finally(() => { snsTriggerInFlight = false; });
                }
                if (!snsReactionInFlight && Math.random() < prob && hasPendingCommentReaction()) {
                    snsReactionInFlight = true;
                    triggerPendingCommentReaction()
                        .catch(e => console.error('[ST-LifeSim] SNS 댓글 반응 생성 오류:', e))
                        .finally(() => { snsReactionInFlight = false; });
                }
            }
            if (!isModuleEnabled('call')) return;
            const callProb = getSettings().proactiveCallProbability ?? 0;
            const forceCall = hasForcedCallIntentFromLatestUserMessage();
            if (callProb > 0 || forceCall) {
                triggerProactiveIncomingCall(callProb, { deferUntilAiResponse: true, force: forceCall })
                    .catch(e => console.error('[ST-LifeSim] 선전화 트리거 오류:', e));
            }
        });
    }

    if (evSrc && eventTypes?.CHARACTER_MESSAGE_RENDERED) {
        evSrc.on(eventTypes.CHARACTER_MESSAGE_RENDERED, () => {
            onCharacterMessageRenderedForProactiveCall();
            trackGifticonUsageFromCharacterMessage();
        });
    }

    console.log('[ST-LifeSim] 초기화 완료');
    return true;
}

let initialized = false;
let initializing = false;
async function initIfNeeded() {
    if (initialized || initializing) return;
    initializing = true;
    try { initialized = await init(); } catch (e) { console.error('[ST-LifeSim] 초기화 오류:', e); } finally { initializing = false; }
}

// SillyTavern APP_READY 이벤트에서 초기화 실행 (호환성 위해 즉시 시도도 함께 수행)
try {
    const ctx = getContext();
    const evSrc = ctx?.eventSource;
    const eventTypes = ctx?.eventTypes || ctx?.event_types;
    if (evSrc?.on && eventTypes?.APP_READY) {
        evSrc.on(eventTypes.APP_READY, initIfNeeded);
    }
} catch (e) {
    console.error('[ST-LifeSim] 이벤트 등록 오류:', e);
}
void initIfNeeded();

/**
 * index.js — ST-LifeSim 확장 진입점
 *
 * 역할:
 * 1. 모든 모듈을 로드하고 초기화한다
 * 2. sendform 옆에 퀵 센드 버튼을 삽입한다
 * 3. 화면 우하단에 플로팅 아이콘을 렌더링한다
 *    - 아이콘 클릭 시 기능 메뉴 팝업 표시
 * 4. AI 응답마다 컨텍스트를 주입한다
 * 5. 확장 전체 ON/OFF 및 각 모듈별 개별 활성화 관리
 */

import { getContext } from '../../../st-context.js';
import { extension_settings } from '../../../extensions.js';
import { injectContext, clearContext } from './utils/context-inject.js';
import { createPopup } from './utils/popup.js';
import { showToast } from './utils/ui.js';
import { injectQuickSendButton, renderTimeDividerUI, renderReadReceiptUI, renderNoContactUI, renderEventGeneratorUI, renderVoiceMemoUI } from './modules/quick-tools/quick-tools.js';
import { initEmoticon, openEmoticonPopup } from './modules/emoticon/emoticon.js';
import { initContacts, openContactsPopup } from './modules/contacts/contacts.js';
import { initCall, openCallLogsPopup } from './modules/call/call.js';
import { initWallet, openWalletPopup } from './modules/wallet/wallet.js';
import { initSns, openSnsPopup } from './modules/sns/sns.js';
import { initCalendar, openCalendarPopup } from './modules/calendar/calendar.js';

// 설정 키
const SETTINGS_KEY = 'st-lifesim';

// 기본 설정
const DEFAULT_SETTINGS = {
    enabled: true,
    modules: {
        quickTools: true,
        emoticon: true,
        contacts: true,
        call: true,
        wallet: true,
        sns: true,
        calendar: true,
    },
};

/**
 * 현재 설정을 가져온다
 * @returns {Object}
 */
function getSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    }
    return extension_settings[SETTINGS_KEY];
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
    return isEnabled() && getSettings().modules?.[moduleKey] !== false;
}

/**
 * 플로팅 버튼 및 독(Dock) UI를 렌더링한다
 */
function renderFloatingDock() {
    // 이미 있으면 제거 후 재생성
    const existing = document.getElementById('slm-dock');
    if (existing) existing.remove();

    const dock = document.createElement('div');
    dock.id = 'slm-dock';
    dock.className = 'slm-dock';
    document.body.appendChild(dock);

    // 플로팅 메인 버튼
    const mainBtn = document.createElement('button');
    mainBtn.id = 'slm-main-btn';
    mainBtn.className = 'slm-main-btn';
    mainBtn.title = 'ST-LifeSim';
    mainBtn.innerHTML = '🌸';
    mainBtn.setAttribute('aria-label', 'ST-LifeSim 메뉴');

    mainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMainMenu();
    });

    dock.appendChild(mainBtn);
}

/**
 * 메인 메뉴 팝업을 토글한다
 */
function toggleMainMenu() {
    const existing = document.getElementById('slm-overlay-main-menu');
    if (existing) { existing.remove(); return; }

    const content = buildMainMenuContent();
    createPopup({
        id: 'main-menu',
        title: '🌸 ST-LifeSim',
        content,
        className: 'slm-main-menu-panel',
    });
}

/**
 * 메인 메뉴 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildMainMenuContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-main-menu';

    // 활성화된 모듈 버튼 목록
    const menuItems = [
        { key: 'quickTools', icon: '🛠️', label: '퀵 도구', action: openQuickToolsPanel },
        { key: 'emoticon', icon: '😊', label: '이모티콘', action: openEmoticonPopup },
        { key: 'contacts', icon: '📋', label: '연락처', action: openContactsPopup },
        { key: 'call', icon: '📞', label: '통화 기록', action: openCallLogsPopup },
        { key: 'wallet', icon: '💰', label: '지갑', action: openWalletPopup },
        { key: 'sns', icon: '📸', label: 'SNS', action: openSnsPopup },
        { key: 'calendar', icon: '📅', label: '캘린더', action: openCalendarPopup },
    ];

    const grid = document.createElement('div');
    grid.className = 'slm-menu-grid';

    menuItems.forEach(item => {
        if (!isModuleEnabled(item.key)) return;

        const btn = document.createElement('button');
        btn.className = 'slm-menu-item';
        btn.innerHTML = `
            <span class="slm-menu-icon">${item.icon}</span>
            <span class="slm-menu-label">${item.label}</span>
        `;
        btn.onclick = () => {
            // 메인 메뉴를 닫고 해당 팝업 열기
            const overlay = document.getElementById('slm-overlay-main-menu');
            if (overlay) overlay.remove();
            item.action();
        };
        grid.appendChild(btn);
    });

    wrapper.appendChild(grid);

    // 설정 버튼
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm slm-settings-btn';
    settingsBtn.textContent = '⚙️ 설정';
    settingsBtn.onclick = () => {
        const overlay = document.getElementById('slm-overlay-main-menu');
        if (overlay) overlay.remove();
        openSettingsPanel();
    };
    wrapper.appendChild(settingsBtn);

    return wrapper;
}

/**
 * 퀵 도구 패널을 연다 (시간구분선, 읽씹, 연락안됨, 사건생성, 음성메모)
 */
function openQuickToolsPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-quick-tools-panel';

    // 각 퀵 도구를 순서대로 추가
    wrapper.appendChild(renderTimeDividerUI());
    const hr = document.createElement('hr');
    hr.className = 'slm-hr';
    wrapper.appendChild(hr);
    wrapper.appendChild(renderReadReceiptUI());
    wrapper.appendChild(renderNoContactUI());
    wrapper.appendChild(renderEventGeneratorUI());
    wrapper.appendChild(renderVoiceMemoUI());

    createPopup({
        id: 'quick-tools',
        title: '🛠️ 퀵 도구',
        content: wrapper,
        className: 'slm-quick-panel',
    });
}

/**
 * 설정 패널을 연다
 */
function openSettingsPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-settings-wrapper slm-form';

    const settings = getSettings();

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
    };

    enabledLabel.appendChild(enabledCheck);
    enabledLabel.appendChild(document.createTextNode(' ST-LifeSim 전체 활성화'));
    enabledRow.appendChild(enabledLabel);
    wrapper.appendChild(enabledRow);

    wrapper.appendChild(document.createElement('hr')).className = 'slm-hr';

    // 모듈별 토글
    const moduleList = [
        { key: 'quickTools', label: '🛠️ 퀵 도구' },
        { key: 'emoticon', label: '😊 이모티콘' },
        { key: 'contacts', label: '📋 연락처' },
        { key: 'call', label: '📞 통화 기록' },
        { key: 'wallet', label: '💰 지갑' },
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
        chk.onchange = () => {
            if (!settings.modules) settings.modules = {};
            settings.modules[m.key] = chk.checked;
            saveSettings();
        };

        lbl.appendChild(chk);
        lbl.appendChild(document.createTextNode(` ${m.label}`));
        row.appendChild(lbl);
        wrapper.appendChild(row);
    });

    createPopup({
        id: 'settings',
        title: '⚙️ ST-LifeSim 설정',
        content: wrapper,
        className: 'slm-sub-panel',
    });
}

/**
 * 설정을 저장한다
 */
function saveSettings() {
    const ctx = getContext();
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

/**
 * 확장 초기화 - SillyTavern이 준비된 후 실행된다
 */
async function init() {
    console.log('[ST-LifeSim] 초기화 시작');

    const ctx = getContext();
    if (!ctx) {
        console.error('[ST-LifeSim] 컨텍스트를 가져올 수 없습니다.');
        return;
    }

    const settings = getSettings();

    // 각 모듈 초기화 (활성화된 경우만)
    if (isModuleEnabled('emoticon')) initEmoticon();
    if (isModuleEnabled('contacts')) initContacts();
    if (isModuleEnabled('call')) initCall();
    if (isModuleEnabled('wallet')) initWallet();
    if (isModuleEnabled('sns')) initSns();
    if (isModuleEnabled('calendar')) initCalendar();

    // 퀵 센드 버튼 삽입 (sendform 전송 버튼 옆)
    if (isModuleEnabled('quickTools')) {
        injectQuickSendButton();
    }

    // 플로팅 독 렌더링
    renderFloatingDock();

    // AI 응답 후 컨텍스트 주입
    if (ctx.eventSource && ctx.event_types) {
        ctx.eventSource.on(ctx.event_types.CHARACTER_MESSAGE_RENDERED, async () => {
            if (isEnabled()) {
                await injectContext();
            }
        });

        // 채팅 로드 시 컨텍스트 주입
        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, async () => {
            if (isEnabled()) {
                await injectContext();
            }
        });
    }

    console.log('[ST-LifeSim] 초기화 완료');
}

// SillyTavern이 준비되면 초기화 실행
jQuery(async () => {
    await init();
});

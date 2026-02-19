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
 * 5. 유저 메시지 전송 시 10% 확률로 SNS 포스팅 트리거
 * 6. 확장 전체 ON/OFF 및 각 모듈별 개별 활성화 관리
 */

import { getContext } from '../../../st-context.js';
import { extension_settings } from '../../../extensions.js';
import { injectContext, clearContext } from './utils/context-inject.js';
import { createPopup, createTabs } from './utils/popup.js';
import { showToast } from './utils/ui.js';
import { exportAllData, importAllData } from './utils/storage.js';
import { injectQuickSendButton, renderTimeDividerUI, renderReadReceiptUI, renderNoContactUI, renderEventGeneratorUI, renderVoiceMemoUI } from './modules/quick-tools/quick-tools.js';
import { initEmoticon, openEmoticonPopup } from './modules/emoticon/emoticon.js';
import { initContacts, openContactsPopup } from './modules/contacts/contacts.js';
import { initCall, openCallLogsPopup } from './modules/call/call.js';
import { initWallet, openWalletPopup } from './modules/wallet/wallet.js';
import { initSns, openSnsPopup, triggerNpcPosting } from './modules/sns/sns.js';
import { initCalendar, openCalendarPopup } from './modules/calendar/calendar.js';

// 설정 키
const SETTINGS_KEY = 'st-lifesim';

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
    },
    emoticonSize: 80, // px
};

/**
 * 현재 설정을 가져온다
 * @returns {Object}
 */
function getSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    }
    // 신규 필드 기본값 보완
    if (extension_settings[SETTINGS_KEY].emoticonSize == null) {
        extension_settings[SETTINGS_KEY].emoticonSize = DEFAULT_SETTINGS.emoticonSize;
    }
    if (extension_settings[SETTINGS_KEY].defaultBinding == null) {
        extension_settings[SETTINGS_KEY].defaultBinding = DEFAULT_SETTINGS.defaultBinding;
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
        openMainMenuPopup();
    });

    sendBtn.parentNode.insertBefore(btn, sendBtn);
}

/**
 * ST-LifeSim 메인 메뉴 팝업을 연다
 */
function openMainMenuPopup() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-main-menu';

    const grid = document.createElement('div');
    grid.className = 'slm-menu-grid';
    wrapper.appendChild(grid);

    const popup = createPopup({
        id: 'main-menu',
        title: '📱 ST-LifeSim',
        content: wrapper,
        className: 'slm-main-menu-panel',
    });

    const menuItems = [
        { key: 'quickTools', icon: '🛠️', label: '퀵 도구', action: openQuickToolsPanel },
        { key: 'emoticon', icon: '😊', label: '이모티콘', action: openEmoticonPopup },
        { key: 'contacts', icon: '📋', label: '연락처', action: openContactsPopup },
        { key: 'call', icon: '📞', label: '통화', action: openCallLogsPopup },
        { key: 'wallet', icon: '💰', label: '지갑', action: openWalletPopup },
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
 * 설정 패널을 연다
 */
function openSettingsPanel(onBack) {
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

    const settingsHr = document.createElement('hr');
    settingsHr.className = 'slm-hr';
    wrapper.appendChild(settingsHr);

    // 데이터 바인딩 방식 (채팅별 / 캐릭터별)
    const bindingRow = document.createElement('div');
    bindingRow.className = 'slm-settings-row';

    const bindingTitle = document.createElement('span');
    bindingTitle.className = 'slm-label';
    bindingTitle.textContent = '데이터 연동 방식:';
    bindingRow.appendChild(bindingTitle);

    const bindingChatLabel = document.createElement('label');
    bindingChatLabel.className = 'slm-toggle-label';
    const bindingChatRadio = document.createElement('input');
    bindingChatRadio.type = 'radio';
    bindingChatRadio.name = 'slm-global-binding';
    bindingChatRadio.value = 'chat';
    bindingChatRadio.checked = (settings.defaultBinding || 'chat') === 'chat';
    bindingChatLabel.appendChild(bindingChatRadio);
    bindingChatLabel.appendChild(document.createTextNode(' 채팅별'));

    const bindingCharLabel = document.createElement('label');
    bindingCharLabel.className = 'slm-toggle-label';
    const bindingCharRadio = document.createElement('input');
    bindingCharRadio.type = 'radio';
    bindingCharRadio.name = 'slm-global-binding';
    bindingCharRadio.value = 'character';
    bindingCharRadio.checked = settings.defaultBinding === 'character';
    bindingCharLabel.appendChild(bindingCharRadio);
    bindingCharLabel.appendChild(document.createTextNode(' 캐릭터별'));

    const onBindingChange = () => {
        settings.defaultBinding = bindingChatRadio.checked ? 'chat' : 'character';
        saveSettings();
        showToast(`데이터 연동: ${settings.defaultBinding === 'chat' ? '채팅별' : '캐릭터별'}`, 'success', 1500);
    };
    bindingChatRadio.onchange = onBindingChange;
    bindingCharRadio.onchange = onBindingChange;

    bindingRow.appendChild(bindingChatLabel);
    bindingRow.appendChild(bindingCharLabel);
    wrapper.appendChild(bindingRow);

    const bindingHr = document.createElement('hr');
    bindingHr.className = 'slm-hr';
    wrapper.appendChild(bindingHr);

    // 이모티콘 출력 크기 설정
    const sizeRow = document.createElement('div');
    sizeRow.className = 'slm-input-row';

    const sizeLbl = document.createElement('label');
    sizeLbl.className = 'slm-label';
    sizeLbl.textContent = '이모티콘 크기:';

    const sizeInput = document.createElement('input');
    sizeInput.className = 'slm-input slm-input-sm';
    sizeInput.type = 'number';
    sizeInput.min = '20';
    sizeInput.max = '300';
    sizeInput.value = String(settings.emoticonSize || 80);
    sizeInput.style.width = '70px';

    const sizePxLabel = document.createElement('span');
    sizePxLabel.className = 'slm-label';
    sizePxLabel.textContent = 'px';

    const sizeApplyBtn = document.createElement('button');
    sizeApplyBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    sizeApplyBtn.textContent = '적용';
    sizeApplyBtn.onclick = () => {
        const val = parseInt(sizeInput.value) || 80;
        settings.emoticonSize = Math.max(20, Math.min(300, val));
        saveSettings();
        showToast(`이모티콘 크기: ${settings.emoticonSize}px`, 'success', 1500);
    };

    sizeRow.appendChild(sizeLbl);
    sizeRow.appendChild(sizeInput);
    sizeRow.appendChild(sizePxLabel);
    sizeRow.appendChild(sizeApplyBtn);
    wrapper.appendChild(sizeRow);

    const sizeHr = document.createElement('hr');
    sizeHr.className = 'slm-hr';
    wrapper.appendChild(sizeHr);

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

    const dataHr = document.createElement('hr');
    dataHr.className = 'slm-hr';
    wrapper.appendChild(dataHr);

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
    exportBtn.title = '모든 ST-LifeSim 데이터를 JSON 파일로 저장합니다';
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
    importBtn.title = 'JSON 백업 파일에서 데이터를 복원합니다';
    importBtn.onclick = () => importInput.click();

    dataBtnRow.appendChild(exportBtn);
    dataBtnRow.appendChild(importBtn);
    dataBtnRow.appendChild(importInput);
    wrapper.appendChild(dataBtnRow);

    createPopup({
        id: 'settings',
        title: '⚙️ ST-LifeSim 설정',
        content: wrapper,
        className: 'slm-sub-panel',
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

    // ST-LifeSim 메뉴 버튼 삽입 (sendform 옆)
    injectLifeSimMenuButton();

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

        // 유저 메시지 전송 시 10% 확률로 SNS 포스팅 트리거
        if (isModuleEnabled('sns') && ctx.event_types.MESSAGE_SENT) {
            ctx.eventSource.on(ctx.event_types.MESSAGE_SENT, () => {
                if (isEnabled() && Math.random() < 0.10) {
                    triggerNpcPosting().catch(e => console.error('[ST-LifeSim] SNS 자동 포스팅 오류:', e));
                }
            });
        }
    }

    console.log('[ST-LifeSim] 초기화 완료');
}

// SillyTavern이 준비되면 초기화 실행
jQuery(async () => {
    await init();
});

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
import { createPopup, createTabs, closePopup } from './utils/popup.js';
import { showToast } from './utils/ui.js';
import { exportAllData, importAllData } from './utils/storage.js';
import { injectQuickSendButton, renderTimeDividerUI, renderReadReceiptUI, renderNoContactUI, renderEventGeneratorUI, renderVoiceMemoUI } from './modules/quick-tools/quick-tools.js';
import { startFirstMsgTimer, renderFirstMsgSettingsUI } from './modules/firstmsg/firstmsg.js';
import { initEmoticon, openEmoticonPopup } from './modules/emoticon/emoticon.js';
import { initContacts, openContactsPopup } from './modules/contacts/contacts.js';
import { initCall, openCallLogsPopup } from './modules/call/call.js';
import { initWallet, openWalletPopup } from './modules/wallet/wallet.js';
import { initSns, openSnsPopup, triggerNpcPosting } from './modules/sns/sns.js';
import { initCalendar, openCalendarPopup } from './modules/calendar/calendar.js';
import { initGifticon, openGifticonPopup } from './modules/gifticon/gifticon.js';

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
        gifticon: true,
    },
    emoticonSize: 80,   // px
    emoticonRadius: 10, // px
    defaultSnsImageUrl: '', // SNS 기본 이미지 URL
    themeColors: {}, // CSS 커스텀 색상
    firstMsg: {
        enabled: false,
        intervalSec: 10,
        probability: 8,
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
    // 신규 필드 기본값 보완
    if (extension_settings[SETTINGS_KEY].emoticonSize == null) {
        extension_settings[SETTINGS_KEY].emoticonSize = DEFAULT_SETTINGS.emoticonSize;
    }
    if (extension_settings[SETTINGS_KEY].emoticonRadius == null) {
        extension_settings[SETTINGS_KEY].emoticonRadius = DEFAULT_SETTINGS.emoticonRadius;
    }
    if (extension_settings[SETTINGS_KEY].defaultBinding == null) {
        extension_settings[SETTINGS_KEY].defaultBinding = DEFAULT_SETTINGS.defaultBinding;
    }
    if (extension_settings[SETTINGS_KEY].defaultSnsImageUrl == null) {
        extension_settings[SETTINGS_KEY].defaultSnsImageUrl = '';
    }
    if (extension_settings[SETTINGS_KEY].themeColors == null) {
        extension_settings[SETTINGS_KEY].themeColors = {};
    }
    if (extension_settings[SETTINGS_KEY].firstMsg == null) {
        extension_settings[SETTINGS_KEY].firstMsg = { ...DEFAULT_SETTINGS.firstMsg };
    }
    if (extension_settings[SETTINGS_KEY].modules?.gifticon == null) {
        if (!extension_settings[SETTINGS_KEY].modules) extension_settings[SETTINGS_KEY].modules = {};
        extension_settings[SETTINGS_KEY].modules.gifticon = true;
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
        };
        enabledLabel.appendChild(enabledCheck);
        enabledLabel.appendChild(document.createTextNode(' ST-LifeSim 전체 활성화'));
        enabledRow.appendChild(enabledLabel);
        wrapper.appendChild(enabledRow);

        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

        // 데이터 바인딩 방식
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

        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

        // 선톡 설정
        wrapper.appendChild(renderFirstMsgSettingsUI(settings, saveSettings));

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

        wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

        // SNS 기본 이미지 URL
        const snsImgLbl = Object.assign(document.createElement('label'), { className: 'slm-label', textContent: 'SNS 기본 이미지 URL:' });
        const snsImgInput = Object.assign(document.createElement('input'), {
            className: 'slm-input', type: 'url',
            placeholder: 'https://... (게시글에 URL 미지정 시 이 이미지 사용)',
            value: settings.defaultSnsImageUrl || '',
        });
        const snsImgApplyBtn = document.createElement('button');
        snsImgApplyBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
        snsImgApplyBtn.style.marginTop = '4px';
        snsImgApplyBtn.textContent = '저장';
        snsImgApplyBtn.onclick = () => {
            settings.defaultSnsImageUrl = snsImgInput.value.trim();
            saveSettings();
            showToast('SNS 기본 이미지 저장됨', 'success', 1500);
        };
        wrapper.appendChild(snsImgLbl);
        wrapper.appendChild(snsImgInput);
        wrapper.appendChild(snsImgApplyBtn);

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
            { key: '--slm-primary', label: '주요 색 (버튼/강조)', defaultVal: '#1a73e8' },
            { key: '--slm-secondary', label: '보조 색 (보조 버튼)', defaultVal: '#6c757d' },
            { key: '--slm-bg', label: '패널 배경', defaultVal: '#1e1e2e' },
            { key: '--slm-surface', label: '카드/셀 배경', defaultVal: '#2a2a3c' },
            { key: '--slm-text', label: '텍스트 색', defaultVal: '#e0e0e0' },
            { key: '--slm-border', label: '테두리 색', defaultVal: '#3a3a5c' },
            { key: '--slm-accent', label: '액센트 색 (SNS 헤더 등)', defaultVal: '#833ab4' },
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
            picker.value = savedColor || (currentCssVal ? currentCssVal : def.defaultVal);

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

        return wrapper;
    }

    const tabs = createTabs([
        { key: 'general', label: '⚙️ 일반', content: buildGeneralTab() },
        { key: 'modules', label: '🧩 모듈', content: buildModulesTab() },
        { key: 'media', label: '😊 이모티콘·SNS', content: buildMediaTab() },
        { key: 'theme', label: '🎨 테마', content: buildThemeTab() },
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

    // 이모티콘 모서리 반경 CSS 변수 적용
    document.documentElement.style.setProperty('--slm-emoticon-radius', (settings.emoticonRadius ?? 10) + 'px');

    // 저장된 테마 색상 적용
    if (settings.themeColors) {
        Object.entries(settings.themeColors).forEach(([key, val]) => {
            if (key && val) document.documentElement.style.setProperty(key, val);
        });
    }

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
    if (isModuleEnabled('quickTools')) {
        try { injectQuickSendButton(); } catch (e) { console.error('[ST-LifeSim] 퀵 센드 버튼 오류:', e); }
    }

    // ST-LifeSim 메뉴 버튼 삽입 (sendform 옆)
    try { injectLifeSimMenuButton(); } catch (e) { console.error('[ST-LifeSim] 메뉴 버튼 오류:', e); }

    // 선톡 타이머 시작 (활성화된 경우)
    try { startFirstMsgTimer(settings.firstMsg); } catch (e) { console.error('[ST-LifeSim] 선톡 타이머 오류:', e); }

    // AI 응답 후 컨텍스트 주입
    const eventSource = ctx.eventSource;
    const eventTypes = ctx.event_types || ctx.eventTypes;
    if (eventSource && eventTypes) {
        if (eventTypes.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, async () => {
                if (isEnabled()) {
                    await injectContext().catch(e => console.error('[ST-LifeSim] 컨텍스트 주입 오류:', e));
                }
            });
        }

        // 채팅 로드 시 컨텍스트 주입
        if (eventTypes.CHAT_CHANGED) {
            eventSource.on(eventTypes.CHAT_CHANGED, async () => {
                if (isEnabled()) {
                    await injectContext().catch(e => console.error('[ST-LifeSim] 컨텍스트 주입 오류:', e));
                }
            });
        }

        // 유저 메시지 전송 시 10% 확률로 SNS 포스팅 트리거
        if (isModuleEnabled('sns') && eventTypes.MESSAGE_SENT) {
            eventSource.on(eventTypes.MESSAGE_SENT, () => {
                if (isEnabled() && Math.random() < 0.10) {
                    triggerNpcPosting().catch(e => console.error('[ST-LifeSim] SNS 자동 포스팅 오류:', e));
                }
            });
        }
    }

    console.log('[ST-LifeSim] 초기화 완료');
}

// SillyTavern이 준비되면 초기화 실행
// jQuery가 없는 환경에서도 동작하도록 대응
if (typeof jQuery !== 'undefined') {
    jQuery(async () => {
        try { await init(); } catch (e) { console.error('[ST-LifeSim] 초기화 오류:', e); }
    });
} else {
    document.addEventListener('DOMContentLoaded', async () => {
        try { await init(); } catch (e) { console.error('[ST-LifeSim] 초기화 오류:', e); }
    });
}

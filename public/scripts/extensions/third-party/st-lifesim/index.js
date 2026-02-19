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
import { createPopup } from './utils/popup.js';
import { showToast } from './utils/ui.js';
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

// 독 메뉴 열림 상태
let dockMenuOpen = false;

/**
 * 플로팅 버튼 및 독(Dock) UI를 렌더링한다 — 드래그 가능
 */
function renderFloatingDock() {
    // 이미 있으면 제거 후 재생성
    const existing = document.getElementById('slm-dock');
    if (existing) existing.remove();

    const dock = document.createElement('div');
    dock.id = 'slm-dock';
    dock.className = 'slm-dock';
    document.body.appendChild(dock);

    // 서브 아이콘 컨테이너
    const menuContainer = document.createElement('div');
    menuContainer.id = 'slm-dock-menu';
    menuContainer.className = 'slm-dock-menu';
    menuContainer.style.display = 'none';
    dock.appendChild(menuContainer);

    // 플로팅 메인 버튼
    const mainBtn = document.createElement('button');
    mainBtn.id = 'slm-main-btn';
    mainBtn.className = 'slm-main-btn';
    mainBtn.title = 'ST-LifeSim';
    mainBtn.innerHTML = '✉️';
    mainBtn.setAttribute('aria-label', 'ST-LifeSim 메뉴');
    dock.appendChild(mainBtn);

    // 서브 메뉴 아이템 목록
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

    // 메뉴 열기/닫기 토글
    function toggleMenu() {
        dockMenuOpen = !dockMenuOpen;
        if (dockMenuOpen) {
            mainBtn.classList.add('open');
            menuContainer.style.display = 'flex';
            menuContainer.innerHTML = '';

            // 활성 모듈만 아이콘 버튼 추가 (역순으로 — 아래서 위로 슬라이드)
            const activeItems = menuItems.filter(item => item.key === null || isModuleEnabled(item.key));
            activeItems.reverse().forEach((item, i) => {
                const btn = document.createElement('button');
                btn.className = 'slm-sub-icon-btn';
                btn.style.animationDelay = `${i * 0.04}s`;
                btn.innerHTML = `<span class="slm-sub-icon-emoji">${item.icon}</span><span>${item.label}</span>`;
                btn.onclick = (ev) => {
                    ev.stopPropagation();
                    closeDockMenu();
                    item.action();
                };
                menuContainer.appendChild(btn);
            });

            // 외부 클릭으로 닫기
            setTimeout(() => {
                document.addEventListener('click', closeDockMenuOnClickOutside, { once: true });
            }, 0);
        } else {
            closeDockMenu();
        }
    }

    function closeDockMenu() {
        dockMenuOpen = false;
        mainBtn.classList.remove('open');
        menuContainer.style.display = 'none';
    }

    function closeDockMenuOnClickOutside(e) {
        if (!dock.contains(e.target)) {
            closeDockMenu();
        }
    }

    mainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!moved) toggleMenu();
    });
    // ── 드래그 지원 (마우스 + 터치) ──
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let dockStartRight = 20, dockStartBottom = 24;
    let moved = false;

    function onDragStart(clientX, clientY) {
        isDragging = true;
        moved = false;
        dragStartX = clientX;
        dragStartY = clientY;
        const rect = dock.getBoundingClientRect();
        dockStartRight = window.innerWidth - rect.right;
        dockStartBottom = window.innerHeight - rect.bottom;
    }

    function onDragMove(clientX, clientY) {
        if (!isDragging) return;
        const dx = clientX - dragStartX;
        const dy = clientY - dragStartY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        if (!moved) return;

        let newRight = dockStartRight - dx;
        let newBottom = dockStartBottom - dy;

        // 화면 밖으로 나가지 않도록 제한
        newRight = Math.max(8, Math.min(newRight, window.innerWidth - 60));
        newBottom = Math.max(8, Math.min(newBottom, window.innerHeight - 60));

        dock.style.right = `${newRight}px`;
        dock.style.bottom = `${newBottom}px`;
    }

    function onDragEnd() {
        isDragging = false;
    }

    // 마우스 이벤트
    mainBtn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        onDragStart(e.clientX, e.clientY);
        const onMove = (ev) => onDragMove(ev.clientX, ev.clientY);
        const onUp = () => {
            onDragEnd();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // 터치 이벤트
    mainBtn.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        onDragStart(t.clientX, t.clientY);
    }, { passive: true });

    mainBtn.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        onDragMove(t.clientX, t.clientY);
    }, { passive: true });

    mainBtn.addEventListener('touchend', () => {
        if (!moved) {
            toggleMenu();
        }
        onDragEnd();
    });
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

    const settingsHr = document.createElement('hr');
    settingsHr.className = 'slm-hr';
    wrapper.appendChild(settingsHr);

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

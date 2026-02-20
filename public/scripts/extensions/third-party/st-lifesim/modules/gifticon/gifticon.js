/**
 * gifticon.js
 * 기프티콘(상품권) 주고받기 모듈
 * - 기프티콘 보관함: 받은/보낸 기프티콘 목록
 * - 보내기: 대상에게 기프티콘 전송 (채팅에 메시지 삽입)
 * - 받기: 상대가 보낸 기프티콘 수신
 * - 컨텍스트에 보관함 정보 주입
 */

import { getContext } from '../../utils/st-context.js';
import { slashSend } from '../../utils/slash.js';
import { loadData, saveData, getDefaultBinding } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast, escapeHtml, generateId } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';

const MODULE_KEY = 'gifticons';

/**
 * @typedef {Object} Gifticon
 * @property {string} id
 * @property {string} name - 기프티콘 이름 (예: 스타벅스 아메리카노)
 * @property {string} brand - 브랜드
 * @property {string} imageUrl - 이미지 URL
 * @property {string} value - 금액/가치 설명 (예: 4,500원)
 * @property {string} expiryDate - 만료일 (YYYY-MM-DD, 선택)
 * @property {'received'|'sent'|'used'} status
 * @property {string} counterpart - 상대방 이름
 * @property {string} date - 거래 날짜 ISO 문자열
 * @property {string} memo - 메모
 */

/**
 * 기프티콘 목록을 불러온다
 * @returns {Gifticon[]}
 */
function loadGifticons() {
    return loadData(MODULE_KEY, [], getDefaultBinding());
}

/**
 * 기프티콘 목록을 저장한다
 * @param {Gifticon[]} list
 */
function saveGifticons(list) {
    saveData(MODULE_KEY, list, getDefaultBinding());
}

/**
 * 기프티콘 모듈을 초기화한다
 */
export function initGifticon() {
    registerContextBuilder('gifticon', () => {
        const list = loadGifticons();
        const active = list.filter(g => g.status === 'received');
        if (active.length === 0) return null;
        const lines = active.map(g => {
            let line = `• ${g.name} (${g.brand || '?'})`;
            if (g.value) line += ` — ${g.value}`;
            if (g.expiryDate) line += ` [exp: ${g.expiryDate}]`;
            return line;
        });
        return `=== Gifticon Wallet ===\nAvailable gift cards:\n${lines.join('\n')}`;
    });
}

/**
 * 기프티콘 팝업을 연다
 */
export function openGifticonPopup(onBack) {
    const content = buildGifticonContent();
    createPopup({
        id: 'gifticon',
        title: '🎁 기프티콘',
        content,
        className: 'slm-gifticon-panel',
        onBack,
    });
}

/**
 * 기프티콘 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildGifticonContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-gifticon-wrapper';

    // 탭: 보관함 / 보내기 / 받기
    const tabBar = document.createElement('div');
    tabBar.className = 'slm-tab-bar';
    wrapper.appendChild(tabBar);

    const body = document.createElement('div');
    wrapper.appendChild(body);

    const tabs = [
        { key: 'inbox', label: '📦 보관함', render: renderInbox },
        { key: 'send', label: '📤 보내기', render: renderSendForm },
        { key: 'receive', label: '📥 받기', render: renderReceiveForm },
    ];

    let activeKey = 'inbox';

    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'slm-tab-btn' + (tab.key === activeKey ? ' active' : '');
        btn.textContent = tab.label;
        btn.onclick = () => {
            tabBar.querySelectorAll('.slm-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeKey = tab.key;
            body.innerHTML = '';
            body.appendChild(tab.render());
        };
        tabBar.appendChild(btn);
    });

    // 초기 탭 표시
    body.appendChild(tabs[0].render());
    return wrapper;
}

/**
 * 보관함 탭을 렌더링한다
 * @returns {HTMLElement}
 */
function renderInbox() {
    const container = document.createElement('div');
    container.className = 'slm-gifticon-inbox';

    const list = loadGifticons();

    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'slm-empty';
        empty.textContent = '기프티콘이 없습니다.';
        container.appendChild(empty);
        return container;
    }

    // 필터 버튼
    const filterRow = document.createElement('div');
    filterRow.className = 'slm-btn-row';
    const filters = ['전체', '받은', '보낸', '사용됨'];
    let activeFilter = '전체';

    const listDiv = document.createElement('div');

    function renderList() {
        listDiv.innerHTML = '';
        let filtered = list;
        if (activeFilter === '받은') filtered = list.filter(g => g.status === 'received');
        else if (activeFilter === '보낸') filtered = list.filter(g => g.status === 'sent');
        else if (activeFilter === '사용됨') filtered = list.filter(g => g.status === 'used');

        if (filtered.length === 0) {
            listDiv.innerHTML = '<div class="slm-empty">해당 기프티콘이 없습니다.</div>';
            return;
        }

        filtered.slice().reverse().forEach(g => {
            const card = document.createElement('div');
            card.className = `slm-gifticon-card slm-gifticon-${g.status}`;

            const topRow = document.createElement('div');
            topRow.className = 'slm-gifticon-top';

            if (g.imageUrl) {
                const img = document.createElement('img');
                img.src = g.imageUrl;
                img.alt = g.name;
                img.className = 'slm-gifticon-img';
                img.onerror = () => img.style.display = 'none';
                topRow.appendChild(img);
            }

            const info = document.createElement('div');
            info.className = 'slm-gifticon-info';
            info.innerHTML = `
                <div class="slm-gifticon-name">${escapeHtml(g.name)}</div>
                <div class="slm-gifticon-brand">${escapeHtml(g.brand || '')}</div>
                ${g.value ? `<div class="slm-gifticon-value">${escapeHtml(g.value)}</div>` : ''}
                ${g.expiryDate ? `<div class="slm-gifticon-expiry">만료: ${escapeHtml(g.expiryDate)}</div>` : ''}
                <div class="slm-gifticon-counterpart">${g.status === 'received' ? '보낸이' : '받는이'}: ${escapeHtml(g.counterpart || '?')}</div>
                ${g.memo ? `<div class="slm-gifticon-memo">${escapeHtml(g.memo)}</div>` : ''}
            `;
            topRow.appendChild(info);
            card.appendChild(topRow);

            // 받은 기프티콘이면 '사용 완료' 버튼
            if (g.status === 'received') {
                const useBtn = document.createElement('button');
                useBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
                useBtn.textContent = '✅ 사용 완료';
                useBtn.style.marginTop = '6px';
                useBtn.onclick = () => {
                    const all = loadGifticons();
                    const idx = all.findIndex(x => x.id === g.id);
                    if (idx !== -1) { all[idx].status = 'used'; saveGifticons(all); }
                    renderList();
                    showToast(`${g.name} 사용 완료`, 'success', 1500);
                };
                card.appendChild(useBtn);
            }

            // 삭제 버튼
            const delBtn = document.createElement('button');
            delBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
            delBtn.textContent = '🗑️';
            delBtn.style.cssText = 'margin-top:6px;margin-left:6px';
            delBtn.onclick = () => {
                const all = loadGifticons().filter(x => x.id !== g.id);
                saveGifticons(all);
                renderList();
                showToast('삭제됨', 'success', 1000);
            };
            card.appendChild(delBtn);

            listDiv.appendChild(card);
        });
    }

    filters.forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'slm-btn slm-btn-secondary slm-btn-sm' + (f === activeFilter ? ' active' : '');
        btn.textContent = f;
        btn.onclick = () => {
            filterRow.querySelectorAll('.slm-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = f;
            renderList();
        };
        filterRow.appendChild(btn);
    });

    container.appendChild(filterRow);
    container.appendChild(listDiv);
    renderList();
    return container;
}

/**
 * 기프티콘 보내기 폼을 렌더링한다
 * @returns {HTMLElement}
 */
function renderSendForm() {
    const container = document.createElement('div');
    container.className = 'slm-form';

    const nameInput = createField(container, '기프티콘 이름 *', 'text', '');
    const brandInput = createField(container, '브랜드', 'text', '');
    const valueInput = createField(container, '금액/가치', 'text', '');
    const imgInput = createField(container, '이미지 URL (선택)', 'url', '');
    const expiryInput = createField(container, '만료일 (선택)', 'date', '');
    const memoInput = createField(container, '메모 (선택)', 'text', '');

    // 받는 사람
    const recipLabel = document.createElement('label');
    recipLabel.className = 'slm-label';
    recipLabel.textContent = '받는 사람 *';

    const recipSelect = document.createElement('select');
    recipSelect.className = 'slm-select';
    recipSelect.innerHTML = '<option value="">직접 입력...</option>';

    const ctx = getContext();
    const charName = ctx?.name2;
    if (charName) {
        const opt = document.createElement('option');
        opt.value = charName;
        opt.textContent = charName;
        recipSelect.appendChild(opt);
    }
    getContacts('chat').forEach(c => {
        if (c.name !== charName) {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            recipSelect.appendChild(opt);
        }
    });

    const recipInput = document.createElement('input');
    recipInput.className = 'slm-input';
    recipInput.type = 'text';
    recipInput.placeholder = '직접 입력';
    recipInput.style.display = 'none';
    recipSelect.onchange = () => {
        recipInput.style.display = recipSelect.value === '' ? 'block' : 'none';
    };

    container.appendChild(recipLabel);
    container.appendChild(recipSelect);
    container.appendChild(recipInput);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'slm-btn slm-btn-primary';
    sendBtn.style.marginTop = '12px';
    sendBtn.textContent = '📤 기프티콘 보내기';
    sendBtn.onclick = async () => {
        const name = nameInput.value.trim();
        const recipient = recipSelect.value || recipInput.value.trim();
        if (!name) { showToast('기프티콘 이름을 입력해주세요.', 'warn'); return; }
        if (!recipient) { showToast('받는 사람을 입력해주세요.', 'warn'); return; }

        sendBtn.disabled = true;
        try {
            const g = {
                id: generateId(),
                name,
                brand: brandInput.value.trim(),
                imageUrl: imgInput.value.trim(),
                value: valueInput.value.trim(),
                expiryDate: expiryInput.value || '',
                status: 'sent',
                counterpart: recipient,
                date: new Date().toISOString(),
                memo: memoInput.value.trim(),
            };

            const list = loadGifticons();
            list.push(g);
            saveGifticons(list);

            // 채팅에 기프티콘 메시지 삽입
            const imgTag = g.imageUrl ? `<img src="${escapeHtml(g.imageUrl)}" alt="${escapeHtml(g.name)}" style="width:80px;height:80px;object-fit:contain;vertical-align:middle">` : '';
            const msgHtml = `🎁 <b>${escapeHtml(recipient)}</b>에게 기프티콘을 보냈습니다!<br>${imgTag} <b>${escapeHtml(g.name)}</b>${g.value ? ` (${escapeHtml(g.value)})` : ''}${g.memo ? `<br><em>${escapeHtml(g.memo)}</em>` : ''}`;
            await slashSend(msgHtml);

            showToast(`${recipient}에게 기프티콘 전송 완료`, 'success');

            // 폼 초기화
            nameInput.value = '';
            brandInput.value = '';
            valueInput.value = '';
            imgInput.value = '';
            expiryInput.value = '';
            memoInput.value = '';
            recipInput.value = '';
        } catch (e) {
            showToast('전송 실패: ' + e.message, 'error');
        } finally {
            sendBtn.disabled = false;
        }
    };

    container.appendChild(sendBtn);
    return container;
}

/**
 * 기프티콘 받기 폼을 렌더링한다
 * @returns {HTMLElement}
 */
function renderReceiveForm() {
    const container = document.createElement('div');
    container.className = 'slm-form';

    const desc = document.createElement('p');
    desc.className = 'slm-desc';
    desc.textContent = '받은 기프티콘을 보관함에 추가합니다.';
    container.appendChild(desc);

    const nameInput = createField(container, '기프티콘 이름 *', 'text', '');
    const brandInput = createField(container, '브랜드', 'text', '');
    const valueInput = createField(container, '금액/가치', 'text', '');
    const imgInput = createField(container, '이미지 URL (선택)', 'url', '');
    const expiryInput = createField(container, '만료일 (선택)', 'date', '');
    const senderInput = createField(container, '보낸 사람', 'text', '');
    const memoInput = createField(container, '메모 (선택)', 'text', '');

    const addBtn = document.createElement('button');
    addBtn.className = 'slm-btn slm-btn-primary';
    addBtn.style.marginTop = '12px';
    addBtn.textContent = '📥 보관함에 추가';
    addBtn.onclick = () => {
        const name = nameInput.value.trim();
        if (!name) { showToast('기프티콘 이름을 입력해주세요.', 'warn'); return; }

        const g = {
            id: generateId(),
            name,
            brand: brandInput.value.trim(),
            imageUrl: imgInput.value.trim(),
            value: valueInput.value.trim(),
            expiryDate: expiryInput.value || '',
            status: 'received',
            counterpart: senderInput.value.trim() || '?',
            date: new Date().toISOString(),
            memo: memoInput.value.trim(),
        };

        const list = loadGifticons();
        list.push(g);
        saveGifticons(list);

        showToast(`기프티콘 "${name}" 추가됨`, 'success');
        nameInput.value = '';
        brandInput.value = '';
        valueInput.value = '';
        imgInput.value = '';
        expiryInput.value = '';
        senderInput.value = '';
        memoInput.value = '';
    };

    container.appendChild(addBtn);
    return container;
}

/**
 * 인라인 폼 필드를 생성한다
 */
function createField(container, label, type, value) {
    const lbl = document.createElement('label');
    lbl.className = 'slm-label';
    lbl.textContent = label;

    const input = document.createElement('input');
    input.className = 'slm-input';
    input.type = type;
    input.value = value;

    container.appendChild(lbl);
    container.appendChild(input);
    return input;
}

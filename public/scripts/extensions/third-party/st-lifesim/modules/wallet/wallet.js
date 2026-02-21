/**
 * wallet.js
 * 지갑 & 송금 모듈
 * - 첫 액세스 시 초기 잔액/화폐 설정
 * - 잔액 관리 (충전/차감)
 * - 송금 기능 (채팅에 결과 노출 + 내부 기록)
 * - 커스텀 화폐 이름/기호 설정 (토글 접힘)
 * - 거래 내역 관리 (토글 접힘)
 */

import { loadData, saveData } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast, escapeHtml, generateId } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';
import { getContext } from '../../utils/st-context.js';
import { slashSend } from '../../utils/slash.js';

const MODULE_KEY = 'wallet';
// 초기 설정 완료 여부 키
const SETUP_DONE_KEY = 'wallet-setup-done';
const CHAT_BINDING = 'chat';

/**
 * 기본 지갑 데이터
 */
const DEFAULT_WALLET = {
    currencyName: '원',
    currencySymbol: '₩',
    balance: 0,
    history: [],
};
const WALLET_TX_MARKER_PREFIX = 'stls-wallet-tx:';

/**
 * 지갑 데이터를 불러온다
 * @returns {Object}
 */
function loadWallet() {
    const wallet = loadData(MODULE_KEY, { ...DEFAULT_WALLET }, CHAT_BINDING);
    syncWalletHistoryWithChat(wallet);
    return wallet;
}

/**
 * 지갑 데이터를 저장한다
 * @param {Object} wallet
 */
function saveWallet(wallet) {
    saveData(MODULE_KEY, wallet, CHAT_BINDING);
}

function getWalletMarker(id) {
    return `${WALLET_TX_MARKER_PREFIX}${id}`;
}

function syncWalletHistoryWithChat(wallet) {
    const history = Array.isArray(wallet?.history) ? wallet.history : [];
    if (history.length === 0) return;
    const chat = getContext()?.chat || [];
    const filtered = history.filter((entry) => {
        if (!entry?.messageMarker) return true;
        return chat.some((msg) => String(msg?.mes || '').includes(entry.messageMarker));
    });
    if (filtered.length === history.length) return;
    wallet.history = filtered;
    saveWallet(wallet);
}

/**
 * 숫자를 화폐 형식으로 포맷한다
 * @param {number} amount
 * @param {string} symbol
 * @returns {string}
 */
function formatCurrency(amount, symbol) {
    return `${symbol} ${amount.toLocaleString('ko-KR')}`;
}

function getContactDisplayName(contact) {
    return contact?.displayName || contact?.name || '';
}

/**
 * 초기 설정이 완료되었는지 확인한다
 * @returns {boolean}
 */
function isSetupDone() {
    return loadData(SETUP_DONE_KEY, false, CHAT_BINDING) === true;
}

/**
 * 지갑 모듈을 초기화한다
 */
export function initWallet() {
    registerContextBuilder('wallet', () => {
        const wallet = loadWallet();
        const { currencyName, currencySymbol, balance } = wallet;
        return `=== Wallet (${currencyName} ${currencySymbol}) ===\nCurrent Balance: ${formatCurrency(balance, currencySymbol)}`;
    });
}

/**
 * 지갑 팝업을 연다
 */
export function openWalletPopup(onBack) {
    // 첫 액세스 시 초기 설정
    if (!isSetupDone()) {
        openWalletSetupPopup(onBack);
        return;
    }

    const content = buildWalletContent();
    createPopup({
        id: 'wallet',
        title: '💰 지갑',
        content,
        className: 'slm-wallet-panel',
        onBack,
    });
}

/**
 * 첫 액세스 초기 설정 팝업
 */
function openWalletSetupPopup(onBack) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-wallet-setup slm-form';

    const h3 = document.createElement('h3');
    h3.textContent = '💰 지갑 초기 설정';
    wrapper.appendChild(h3);

    const p = document.createElement('p');
    p.textContent = '처음 사용 전 현재 잔액과 화폐 단위를 설정해주세요.';
    wrapper.appendChild(p);

    const currNameInput = createInlineField(wrapper, '화폐 이름', '원');
    const currSymInput = createInlineField(wrapper, '화폐 기호', '₩');
    const balInput = createInlineField(wrapper, '현재 잔액', '1000000');
    balInput.type = 'number';

    const footer = document.createElement('div');
    footer.className = 'slm-panel-footer';

    const startBtn = document.createElement('button');
    startBtn.className = 'slm-btn slm-btn-primary';
    startBtn.textContent = '시작하기';

    footer.appendChild(startBtn);

    const { close } = createPopup({
        id: 'wallet-setup',
        title: '💰 지갑 설정',
        content: wrapper,
        footer,
        className: 'slm-sub-panel',
        onBack,
    });

    startBtn.onclick = () => {
        const w = loadWallet();
        w.currencyName = currNameInput.value.trim() || '원';
        w.currencySymbol = currSymInput.value.trim() || '₩';
        w.balance = parseInt(balInput.value) || 0;
        saveWallet(w);
        saveData(SETUP_DONE_KEY, true, CHAT_BINDING);
        close();
        openWalletPopup(onBack);
        showToast('지갑 설정 완료', 'success');
    };
}

/**
 * 지갑 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildWalletContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-wallet-wrapper';

    let wallet = loadWallet();

    // 잔액 표시 영역
    const balanceDisplay = document.createElement('div');
    balanceDisplay.className = 'slm-wallet-balance';

    function refreshBalance() {
        wallet = loadWallet();
        balanceDisplay.innerHTML = `
            <div class="slm-balance-label">잔액</div>
            <div class="slm-balance-amount">${formatCurrency(wallet.balance, wallet.currencySymbol)}</div>
        `;
    }
    refreshBalance();
    wrapper.appendChild(balanceDisplay);

    // 충전/차감 버튼
    const adjustRow = document.createElement('div');
    adjustRow.className = 'slm-btn-row';
    adjustRow.style.justifyContent = 'center';

    const chargeInput = document.createElement('input');
    chargeInput.className = 'slm-input slm-input-sm';
    chargeInput.type = 'number';
    chargeInput.min = '0';
    chargeInput.placeholder = '금액';

    const chargeBtn = document.createElement('button');
    chargeBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    chargeBtn.textContent = '+ 충전';
    chargeBtn.onclick = () => adjustBalance(parseInt(chargeInput.value) || 0, '충전', '', refreshAll);

    const deductBtn = document.createElement('button');
    deductBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    deductBtn.textContent = '- 차감';
    deductBtn.onclick = () => adjustBalance(-(parseInt(chargeInput.value) || 0), '차감', '', refreshAll);

    adjustRow.appendChild(chargeInput);
    adjustRow.appendChild(chargeBtn);
    adjustRow.appendChild(deductBtn);
    wrapper.appendChild(adjustRow);

    // 구분선
    const hr = document.createElement('hr');
    hr.className = 'slm-hr';
    wrapper.appendChild(hr);

    // 송금 폼 (토글 접힘)
    const sendToggle = createToggleSection('💸 송금하기', false);
    const sendSection = sendToggle.body;
    sendSection.classList.add('slm-send-section');
    wrapper.appendChild(sendToggle.container);

    const senderLabel = document.createElement('label');
    senderLabel.className = 'slm-label';
    senderLabel.textContent = '보내는 사람';

    const senderSelect = document.createElement('select');
    senderSelect.className = 'slm-select';
    const userName = getContext()?.name1 || 'user';
    senderSelect.innerHTML = `<option value="${userName}">${userName}</option><option value="">직접 입력...</option>`;
    getContacts('chat').forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = getContactDisplayName(c);
        senderSelect.appendChild(opt);
    });

    const senderInput = document.createElement('input');
    senderInput.className = 'slm-input';
    senderInput.type = 'text';
    senderInput.placeholder = '보내는 사람 직접 입력';
    senderInput.style.display = 'none';
    senderSelect.onchange = () => {
        senderInput.style.display = senderSelect.value === '' ? 'block' : 'none';
    };

    const recipientLabel = document.createElement('label');
    recipientLabel.className = 'slm-label';
    recipientLabel.textContent = '받는 사람';

    const recipientSelect = document.createElement('select');
    recipientSelect.className = 'slm-select';

    function populateContacts() {
        recipientSelect.innerHTML = '<option value="">직접 입력...</option>';
        const contacts = getContacts('chat');
        contacts.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = getContactDisplayName(c);
            recipientSelect.appendChild(opt);
        });
    }
    populateContacts();

    const recipientInput = document.createElement('input');
    recipientInput.className = 'slm-input';
    recipientInput.type = 'text';
    recipientInput.placeholder = '직접 입력';
    recipientInput.style.display = 'none';

    recipientSelect.onchange = () => {
        recipientInput.style.display = recipientSelect.value === '' ? 'block' : 'none';
    };

    const amountLabel = document.createElement('label');
    amountLabel.className = 'slm-label';
    amountLabel.textContent = '금액';

    const amountInput = document.createElement('input');
    amountInput.className = 'slm-input';
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.placeholder = '0';

    const memoLabel = document.createElement('label');
    memoLabel.className = 'slm-label';
    memoLabel.textContent = '메모';

    const memoInput = document.createElement('input');
    memoInput.className = 'slm-input';
    memoInput.type = 'text';
    memoInput.placeholder = '메모 (선택)';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'slm-btn slm-btn-primary';
    sendBtn.textContent = '송금 확인';
    sendBtn.onclick = async () => {
        const sender = senderSelect.value || senderInput.value.trim() || userName;
        const recipient = recipientSelect.value || recipientInput.value.trim();
        const amount = parseInt(amountInput.value) || 0;
        const memo = memoInput.value.trim();

        if (!recipient) { showToast('받는 사람을 입력해주세요.', 'warn'); return; }
        if (amount <= 0) { showToast('금액을 입력해주세요.', 'warn'); return; }

        sendBtn.disabled = true;
        try {
            await handleSend(sender, recipient, amount, memo);
            amountInput.value = '';
            memoInput.value = '';
            refreshAll();
        } finally {
            sendBtn.disabled = false;
        }
    };

    sendSection.appendChild(senderLabel);
    sendSection.appendChild(senderSelect);
    sendSection.appendChild(senderInput);
    sendSection.appendChild(recipientLabel);
    sendSection.appendChild(recipientSelect);
    sendSection.appendChild(recipientInput);
    sendSection.appendChild(amountLabel);
    sendSection.appendChild(amountInput);
    sendSection.appendChild(memoLabel);
    sendSection.appendChild(memoInput);
    sendSection.appendChild(sendBtn);

    // 구분선
    const hr2 = document.createElement('hr');
    hr2.className = 'slm-hr';
    wrapper.appendChild(hr2);

    // 거래 내역 (토글 접힘)
    const historySection = createToggleSection('📋 거래 내역', false);
    wrapper.appendChild(historySection.container);

    const histList = document.createElement('div');
    histList.className = 'slm-history-list';
    historySection.body.appendChild(histList);

    // 화폐 설정 (토글 접힘)
    const settingsSection = createToggleSection('⚙️ 화폐 설정', false);
    wrapper.appendChild(settingsSection.container);

    const currNameInput = createInlineField(settingsSection.body, '화폐 이름', wallet.currencyName);
    const currSymInput = createInlineField(settingsSection.body, '화폐 기호', wallet.currencySymbol);
    const initBalInput = createInlineField(settingsSection.body, '잔액 직접 설정', String(wallet.balance));
    initBalInput.type = 'number';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    applyBtn.textContent = '적용';
    applyBtn.onclick = () => {
        const w = loadWallet();
        w.currencyName = currNameInput.value.trim() || '원';
        w.currencySymbol = currSymInput.value.trim() || '₩';
        const newBal = parseInt(initBalInput.value);
        if (!isNaN(newBal)) w.balance = newBal;
        saveWallet(w);
        refreshAll();
        showToast('화폐 설정 적용', 'success', 1500);
    };
    settingsSection.body.appendChild(applyBtn);

    // 거래 내역 렌더링
    function renderHistory() {
        histList.innerHTML = '';
        const w = loadWallet();
        if (w.history.length === 0) {
            histList.innerHTML = '<div class="slm-empty">거래 내역이 없습니다.</div>';
            return;
        }
        w.history.slice().reverse().slice(0, 20).forEach(h => {
            const row = document.createElement('div');
            row.className = 'slm-history-row';
            const sign = h.amount > 0 ? '+' : '';
            const icon = h.type === 'send' ? '📤' : '📥';
            row.innerHTML = `
                <span class="slm-hist-icon">${icon}</span>
                <span class="slm-hist-name">${escapeHtml(h.counterpart || '직접')}</span>
                <span class="slm-hist-amount ${h.amount < 0 ? 'neg' : 'pos'}">${sign}${escapeHtml(formatCurrency(h.amount, w.currencySymbol))}</span>
            `;
            histList.appendChild(row);
        });
    }

    function refreshAll() {
        refreshBalance();
        renderHistory();
    }

    renderHistory();
    return wrapper;
}

/**
 * 토글 가능한 섹션을 생성한다
 * @param {string} title
 * @param {boolean} openByDefault
 * @returns {{ container: HTMLElement, body: HTMLElement }}
 */
function createToggleSection(title, openByDefault = false) {
    const container = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'slm-toggle-section-header';

    const h4 = document.createElement('h4');
    h4.textContent = title;

    const chevron = document.createElement('span');
    chevron.className = 'slm-toggle-chevron' + (openByDefault ? ' open' : '');
    chevron.textContent = '▾';

    header.appendChild(h4);
    header.appendChild(chevron);

    const body = document.createElement('div');
    body.className = 'slm-toggle-section-body';
    body.style.display = openByDefault ? 'block' : 'none';

    header.onclick = () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        chevron.classList.toggle('open', !isOpen);
    };

    container.appendChild(header);
    container.appendChild(body);

    return { container, body };
}

/**
 * 잔액을 조정한다
 */
function adjustBalance(delta, type, counterpart, onDone) {
    if (delta === 0) return;
    const wallet = loadWallet();
    wallet.balance += delta;
    wallet.history.push({
        id: generateId(),
        type: delta > 0 ? 'charge' : 'deduct',
        amount: delta,
        counterpart,
        note: type,
        date: new Date().toISOString(),
        balanceAfter: wallet.balance,
    });
    saveWallet(wallet);
    if (onDone) onDone();
    showToast(`${type}: ${formatCurrency(Math.abs(delta), wallet.currencySymbol)}`, 'success', 1500);
}

/**
 * 송금을 처리한다
 */
async function handleSend(sender, recipient, amount, memo) {
    const wallet = loadWallet();
    if (amount > wallet.balance) {
        showToast('잔액이 부족합니다.', 'error');
        return;
    }

    wallet.balance -= amount;
    const now = new Date();
    wallet.history.push({
        id: generateId(),
        type: 'send',
        amount: -amount,
        sender,
        counterpart: recipient,
        note: memo,
        date: now.toISOString(),
        balanceAfter: wallet.balance,
    });
    saveWallet(wallet);

    showToast(`💸 ${sender} → ${recipient} ${formatCurrency(amount, wallet.currencySymbol)} 송금 완료`, 'success');
    // '|'는 slash 체인 구분자로 해석될 수 있어 함께 정리한다.
    const safeMemo = String(memo || '').replace(/[|\r\n]/g, ' ').trim();
    let marker = '';
    if (wallet.history.length > 0) {
        const historyEntry = wallet.history[wallet.history.length - 1];
        marker = getWalletMarker(historyEntry.id);
        historyEntry.messageMarker = marker;
        saveWallet(wallet);
    }
    await slashSend(`💸 **송금 완료**\n- 보내는 사람: ${escapeHtml(sender)}\n- 받는 사람: ${escapeHtml(recipient)}\n- 금액: ${escapeHtml(formatCurrency(amount, wallet.currencySymbol))}${safeMemo ? `\n- 메모: ${escapeHtml(safeMemo)}` : ''}${marker ? `\n<!--${marker}-->` : ''}`);
}

/**
 * 인라인 폼 필드를 생성한다
 */
function createInlineField(container, label, value) {
    const row = document.createElement('div');
    row.className = 'slm-input-row';

    const lbl = document.createElement('label');
    lbl.className = 'slm-label';
    lbl.textContent = label;

    const input = document.createElement('input');
    input.className = 'slm-input slm-input-sm';
    input.type = 'text';
    input.value = value;

    row.appendChild(lbl);
    row.appendChild(input);
    container.appendChild(row);
    return input;
}

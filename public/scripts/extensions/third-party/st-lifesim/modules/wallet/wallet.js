/**
 * wallet.js
 * 지갑 & 송금 모듈
 * - 잔액 관리 (충전/차감)
 * - 송금 기능 (채팅에 송금 메시지 삽입)
 * - 커스텀 화폐 이름/기호 설정
 * - 거래 내역 관리
 */

import { slashSend } from '../../utils/slash.js';
import { loadData, saveData } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast, escapeHtml } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';

const MODULE_KEY = 'wallet';

/**
 * 기본 지갑 데이터
 */
const DEFAULT_WALLET = {
    currencyName: '원',
    currencySymbol: '₩',
    balance: 1000000,
    history: [],
};

/**
 * 지갑 데이터를 불러온다
 * @returns {Object}
 */
function loadWallet() {
    return loadData(MODULE_KEY, { ...DEFAULT_WALLET }, 'chat');
}

/**
 * 지갑 데이터를 저장한다
 * @param {Object} wallet
 */
function saveWallet(wallet) {
    saveData(MODULE_KEY, wallet, 'chat');
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

/**
 * 지갑 모듈을 초기화한다
 */
export function initWallet() {
    // 컨텍스트 빌더 등록
    registerContextBuilder('wallet', () => {
        const wallet = loadWallet();
        const { currencyName, currencySymbol, balance } = wallet;
        return `=== 지갑 (${currencyName} ${currencySymbol}) ===\n현재 잔액: ${formatCurrency(balance, currencySymbol)}`;
    });
}

/**
 * 지갑 팝업을 연다
 */
export function openWalletPopup() {
    const content = buildWalletContent();
    createPopup({
        id: 'wallet',
        title: '💰 지갑',
        content,
        className: 'slm-wallet-panel',
    });
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

    // 송금 폼
    const sendSection = document.createElement('div');
    sendSection.className = 'slm-send-section';

    const sendTitle = document.createElement('h4');
    sendTitle.textContent = '💸 송금하기';
    sendSection.appendChild(sendTitle);

    // 받는 사람 선택
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
            opt.textContent = c.name;
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
        if (recipientSelect.value === '') {
            recipientInput.style.display = 'block';
        } else {
            recipientInput.style.display = 'none';
        }
    };

    // 금액 입력
    const amountLabel = document.createElement('label');
    amountLabel.className = 'slm-label';
    amountLabel.textContent = '금액';

    const amountInput = document.createElement('input');
    amountInput.className = 'slm-input';
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.placeholder = '0';

    // 메모 입력
    const memoLabel = document.createElement('label');
    memoLabel.className = 'slm-label';
    memoLabel.textContent = '메모';

    const memoInput = document.createElement('input');
    memoInput.className = 'slm-input';
    memoInput.type = 'text';
    memoInput.placeholder = '메모 (선택)';

    // 송금 버튼
    const sendBtn = document.createElement('button');
    sendBtn.className = 'slm-btn slm-btn-primary';
    sendBtn.textContent = '송금 확인';
    sendBtn.onclick = async () => {
        const recipient = recipientSelect.value || recipientInput.value.trim();
        const amount = parseInt(amountInput.value) || 0;
        const memo = memoInput.value.trim();

        if (!recipient) { showToast('받는 사람을 입력해주세요.', 'warn'); return; }
        if (amount <= 0) { showToast('금액을 입력해주세요.', 'warn'); return; }

        sendBtn.disabled = true;
        try {
            await handleSend(recipient, amount, memo);
            amountInput.value = '';
            memoInput.value = '';
            refreshAll();
        } finally {
            sendBtn.disabled = false;
        }
    };

    sendSection.appendChild(recipientLabel);
    sendSection.appendChild(recipientSelect);
    sendSection.appendChild(recipientInput);
    sendSection.appendChild(amountLabel);
    sendSection.appendChild(amountInput);
    sendSection.appendChild(memoLabel);
    sendSection.appendChild(memoInput);
    sendSection.appendChild(sendBtn);
    wrapper.appendChild(sendSection);

    // 구분선
    const hr2 = document.createElement('hr');
    hr2.className = 'slm-hr';
    wrapper.appendChild(hr2);

    // 거래 내역
    const historySection = document.createElement('div');
    historySection.className = 'slm-history-section';

    const histTitle = document.createElement('h4');
    histTitle.textContent = '📋 거래 내역';
    historySection.appendChild(histTitle);

    const histList = document.createElement('div');
    histList.className = 'slm-history-list';
    historySection.appendChild(histList);
    wrapper.appendChild(historySection);

    // 화폐 설정 섹션
    const settingsSection = document.createElement('div');
    settingsSection.className = 'slm-settings-section';

    const setTitle = document.createElement('h4');
    setTitle.textContent = '⚙️ 화폐 설정';
    settingsSection.appendChild(setTitle);

    const currNameInput = createInlineField(settingsSection, '화폐 이름', wallet.currencyName);
    const currSymInput = createInlineField(settingsSection, '화폐 기호', wallet.currencySymbol);
    const initBalInput = createInlineField(settingsSection, '초기 잔액', String(wallet.balance));
    initBalInput.type = 'number';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    applyBtn.textContent = '적용';
    applyBtn.onclick = () => {
        const w = loadWallet();
        w.currencyName = currNameInput.value.trim() || '원';
        w.currencySymbol = currSymInput.value.trim() || '₩';
        w.balance = parseInt(initBalInput.value) || w.balance;
        saveWallet(w);
        refreshAll();
        showToast('화폐 설정 적용', 'success', 1500);
    };
    settingsSection.appendChild(applyBtn);
    wrapper.appendChild(settingsSection);

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
            const d = new Date(h.date);
            const sign = h.amount > 0 ? '+' : '';
            const icon = h.type === 'send' ? '📤' : '📥';
            row.innerHTML = `
                <span class="slm-hist-icon">${icon}</span>
                <span class="slm-hist-name">${escapeHtml(h.counterpart || '직접')}</span>
                <span class="slm-hist-amount ${h.amount < 0 ? 'neg' : 'pos'}">${sign}${escapeHtml(formatCurrency(h.amount, w.currencySymbol))}</span>
                <span class="slm-hist-date">${d.toLocaleDateString('ko-KR')}</span>
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
 * 잔액을 조정한다
 * @param {number} delta - 변동 금액 (양수: 충전, 음수: 차감)
 * @param {string} type - 타입 설명
 * @param {string} counterpart - 상대방
 * @param {Function} onDone - 완료 후 콜백
 */
function adjustBalance(delta, type, counterpart, onDone) {
    if (delta === 0) return;
    const wallet = loadWallet();
    wallet.balance += delta;
    wallet.history.push({
        id: crypto.randomUUID(),
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
 * 송금을 처리하고 채팅에 송금 메시지를 삽입한다
 * @param {string} recipient - 받는 사람
 * @param {number} amount - 송금 금액
 * @param {string} memo - 메모
 */
async function handleSend(recipient, amount, memo) {
    const wallet = loadWallet();
    if (amount > wallet.balance) {
        showToast('잔액이 부족합니다.', 'error');
        return;
    }

    wallet.balance -= amount;
    const now = new Date();
    wallet.history.push({
        id: crypto.randomUUID(),
        type: 'send',
        amount: -amount,
        counterpart: recipient,
        note: memo,
        date: now.toISOString(),
        balanceAfter: wallet.balance,
    });
    saveWallet(wallet);

    // 채팅에 송금 메시지 삽입
    const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const msg = [
        '━━━━━━━━━━━━',
        '💸 송금 완료',
        '━━━━━━━━━━━━',
        `받는 분: ${recipient}`,
        `금  액: ${formatCurrency(amount, wallet.currencySymbol)}`,
        `잔  액: ${formatCurrency(wallet.balance, wallet.currencySymbol)}`,
        `일  시: ${dateStr}`,
        memo ? `메  모: ${memo}` : '',
        '━━━━━━━━━━━━',
    ].filter(Boolean).join('\n');

    await slashSend(msg);
    showToast('송금 완료', 'success');
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

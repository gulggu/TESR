/**
 * ui.js
 * 토스트 알림, 확인 다이얼로그 등 공통 UI 유틸리티
 */

/**
 * HTML 특수 문자를 이스케이프하여 XSS를 방지한다
 * @param {string} str - 이스케이프할 문자열
 * @returns {string} 안전한 HTML 문자열
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 토스트 알림을 화면에 표시한다
 * @param {string} message - 표시할 메시지
 * @param {'info'|'success'|'error'|'warn'} type - 토스트 타입
 * @param {number} duration - 표시 시간(ms), 기본 3000ms
 */
export function showToast(message, type = 'info', duration = 3000) {
    // 토스트 컨테이너 없으면 생성
    let container = document.getElementById('slm-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'slm-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `slm-toast slm-toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // 잠시 후 사라지게 한다
    setTimeout(() => {
        toast.classList.add('slm-toast-hide');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

/**
 * 확인/취소 다이얼로그를 표시한다
 * @param {string} message - 표시할 메시지
 * @param {string} [confirmText] - 확인 버튼 텍스트 (기본: '확인')
 * @param {string} [cancelText] - 취소 버튼 텍스트 (기본: '취소')
 * @returns {Promise<boolean>} 확인이면 true, 취소이면 false
 */
export function showConfirm(message, confirmText = '확인', cancelText = '취소') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'slm-overlay slm-confirm-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'slm-confirm-dialog';

        const msg = document.createElement('p');
        msg.className = 'slm-confirm-msg';
        msg.textContent = message;

        const btns = document.createElement('div');
        btns.className = 'slm-confirm-btns';

        let onKey;

        function close() {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'slm-btn slm-btn-secondary';
        cancelBtn.textContent = cancelText;
        cancelBtn.onclick = () => { close(); resolve(false); };

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'slm-btn slm-btn-primary';
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = () => { close(); resolve(true); };

        btns.appendChild(cancelBtn);
        btns.appendChild(confirmBtn);
        dialog.appendChild(msg);
        dialog.appendChild(btns);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        onKey = (e) => {
            if (e.key === 'Escape') { close(); resolve(false); }
        };
        document.addEventListener('keydown', onKey);
    });
}

/**
 * 단순 입력 다이얼로그를 표시한다
 * @param {string} label - 입력 필드 레이블
 * @param {string} [defaultValue] - 기본값
 * @param {string} [placeholder] - 플레이스홀더
 * @returns {Promise<string|null>} 입력 값 또는 null (취소)
 */
export function showPrompt(label, defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'slm-overlay slm-confirm-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'slm-confirm-dialog';

        const lbl = document.createElement('label');
        lbl.className = 'slm-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.className = 'slm-input';
        input.type = 'text';
        input.value = defaultValue;
        input.placeholder = placeholder;

        const btns = document.createElement('div');
        btns.className = 'slm-confirm-btns';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'slm-btn slm-btn-secondary';
        cancelBtn.textContent = '취소';
        cancelBtn.onclick = () => { overlay.remove(); resolve(null); };

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'slm-btn slm-btn-primary';
        confirmBtn.textContent = '확인';
        confirmBtn.onclick = () => { overlay.remove(); resolve(input.value); };

        btns.appendChild(cancelBtn);
        btns.appendChild(confirmBtn);
        dialog.appendChild(lbl);
        dialog.appendChild(input);
        dialog.appendChild(btns);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        input.focus();

        // Enter로 확인, ESC로 취소
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { overlay.remove(); resolve(input.value); }
            if (e.key === 'Escape') { overlay.remove(); resolve(null); }
        });
    });
}

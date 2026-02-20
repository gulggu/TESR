/**
 * emoticon.js
 * 이모티콘 모듈 - URL 기반 이모티콘 관리 및 전송
 * - 이모티콘 추가/편집/삭제
 * - 카테고리 탭 분류 + 검색 + 즐겨찾기
 * - 클릭 시 /send ![이름](URL) 전송
 * - 출력 크기: 설정에서 지정한 px (scale 방식)
 * - AI 공용 이모티콘은 컨텍스트에 주입
 */

import { slashSend } from '../../utils/slash.js';
import { loadData, saveData, getDefaultBinding, getExtensionSettings } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { isCallActive } from '../call/call.js';

/**
 * 이모티콘 출력 크기를 가져온다 (extension_settings에서)
 * @returns {number}
 */
function getEmoticonSize() {
    const ext = getExtensionSettings();
    return ext?.['st-lifesim']?.emoticonSize || 80;
}

/**
 * 이모티콘 border-radius를 가져온다 (extension_settings에서)
 * @returns {number}
 */
function getEmoticonRadius() {
    const ext = getExtensionSettings();
    return ext?.['st-lifesim']?.emoticonRadius ?? 10;
}

const MODULE_KEY = 'emoticons';

/**
 * @typedef {Object} Emoticon
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {string} category
 * @property {boolean} favorite
 * @property {boolean} aiUsable - AI도 사용 가능한지 여부
 */

/**
 * 저장된 이모티콘 목록을 불러온다
 * @returns {Emoticon[]}
 */
function loadEmoticons() {
    return loadData(MODULE_KEY, [], getDefaultBinding());
}

/**
 * 이모티콘 목록을 저장한다
 * @param {Emoticon[]} emoticons
 */
function saveEmoticons(emoticons) {
    saveData(MODULE_KEY, emoticons, getDefaultBinding());
}

/**
 * 이모티콘 모듈을 초기화한다
 */
export function initEmoticon() {
    // 컨텍스트 빌더 등록: AI 사용 가능 이모티콘 목록 주입
    registerContextBuilder('emoticon', () => {
        // 통화 중에는 이모티콘 컨텍스트 주입 안 함
        if (isCallActive()) return null;

        const emoticons = loadEmoticons();
        const aiEmoticons = emoticons.filter(e => e.aiUsable);
        if (aiEmoticons.length === 0) return null;
        const size = getEmoticonSize();
        const radius = getEmoticonRadius();
        const list = aiEmoticons.map(e => {
            // Escape values for safe HTML embedding
            const safeName = e.name.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeUrl = e.url.replace(/"/g, '&quot;');
            return `• ${safeName}: <img src="${safeUrl}" alt="${safeName}" style="width:${size}px;height:${size}px;object-fit:contain;display:inline-block;vertical-align:middle;border-radius:${radius}px">`;
        }).join('\n');
        return `=== Available Emoticons for AI ===\nTo use an emoticon, copy the exact HTML tag shown below:\n${list}`;
    });
}

/**
 * 이모티콘 팝업을 연다
 */
export function openEmoticonPopup(onBack) {
    const content = buildEmoticonContent();
    createPopup({
        id: 'emoticon',
        title: '😊 이모티콘',
        content,
        className: 'slm-emoticon-panel',
        onBack,
    });
}

/**
 * 이모티콘 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildEmoticonContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-emoticon-wrapper';

    // 상태: 현재 선택된 카테고리, 검색어
    let currentCategory = '전체';
    let searchQuery = '';

    // 검색창
    const searchInput = document.createElement('input');
    searchInput.className = 'slm-input slm-search';
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 이모티콘 검색...';
    searchInput.oninput = () => {
        searchQuery = searchInput.value.toLowerCase();
        renderGrid();
    };
    wrapper.appendChild(searchInput);

    // 카테고리 탭바
    const tabBar = document.createElement('div');
    tabBar.className = 'slm-emoticon-tabs';
    wrapper.appendChild(tabBar);

    // 이모티콘 그리드
    const grid = document.createElement('div');
    grid.className = 'slm-emoticon-grid';
    wrapper.appendChild(grid);

    // 하단 버튼
    const footer = document.createElement('div');
    footer.className = 'slm-panel-footer';

    const addBtn = document.createElement('button');
    addBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    addBtn.textContent = '+ 이모티콘 추가';
    addBtn.onclick = () => openAddEmoticonDialog(renderAll);

    const importBtn = document.createElement('button');
    importBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    importBtn.textContent = '📥 가져오기';
    importBtn.title = 'JSON 파일에서 이모티콘 프리셋 가져오기';
    importBtn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const imported = Array.isArray(data) ? data : (data.emoticons || []);
                if (!Array.isArray(imported) || imported.length === 0) {
                    showToast('유효한 이모티콘 데이터가 없습니다.', 'warn');
                    return;
                }
                const existing = loadEmoticons();
                const existingUrls = new Set(existing.map(e => e.url));
                let added = 0;
                imported.forEach(em => {
                    if (em.url && !existingUrls.has(em.url)) {
                        existing.push({
                            id: crypto.randomUUID(),
                            name: em.name || '이모티콘',
                            url: em.url,
                            category: em.category || '기본',
                            favorite: false,
                            aiUsable: em.aiUsable !== false,
                        });
                        added++;
                    }
                });
                saveEmoticons(existing);
                renderAll();
                showToast(`이모티콘 ${added}개 가져오기 완료`, 'success');
            } catch (err) {
                showToast('가져오기 실패: ' + err.message, 'error');
            }
        };
        input.click();
    };

    const exportBtn = document.createElement('button');
    exportBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    exportBtn.textContent = '📤 내보내기';
    exportBtn.title = '이모티콘 프리셋을 JSON 파일로 저장 (가져오기로 공유 가능)';
    exportBtn.onclick = () => {
        try {
            const emoticons = loadEmoticons();
            if (emoticons.length === 0) {
                showToast('내보낼 이모티콘이 없습니다.', 'warn');
                return;
            }
            const data = { emoticons };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `emoticon-preset-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`이모티콘 ${emoticons.length}개 내보내기 완료`, 'success');
        } catch (err) {
            showToast('내보내기 실패: ' + err.message, 'error');
        }
    };

    // 이모티콘 URL 목록 공유 버튼
    const shareBtn = document.createElement('button');
    shareBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    shareBtn.textContent = '🔗 URL 공유';
    shareBtn.title = '저장된 이모티콘의 이름과 URL 목록을 텍스트 파일로 다운로드';
    shareBtn.onclick = () => {
        try {
            const emoticons = loadEmoticons();
            if (emoticons.length === 0) {
                showToast('공유할 이모티콘이 없습니다.', 'warn');
                return;
            }
            const lines = emoticons.map(e =>
                `[${e.category || '기본'}] ${e.name}\t${e.url}`,
            );
            const text = `ST-LifeSim 이모티콘 URL 목록 (${new Date().toLocaleDateString('ko-KR')})\n` +
                         `총 ${emoticons.length}개\n\n` +
                         lines.join('\n');
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `emoticon-urls-${new Date().toISOString().slice(0, 10)}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`URL 목록 ${emoticons.length}개 다운로드 완료`, 'success');
        } catch (err) {
            showToast('공유 실패: ' + err.message, 'error');
        }
    };

    footer.appendChild(addBtn);
    footer.appendChild(importBtn);
    footer.appendChild(exportBtn);
    footer.appendChild(shareBtn);
    wrapper.appendChild(footer);

    // 전체 렌더링
    function renderAll() {
        renderTabs();
        renderGrid();
    }

    // 카테고리 탭 렌더링
    function renderTabs() {
        tabBar.innerHTML = '';
        const emoticons = loadEmoticons();
        const categories = ['전체', '즐겨찾기', ...new Set(emoticons.map(e => e.category).filter(Boolean))];

        categories.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'slm-tab-btn' + (cat === currentCategory ? ' active' : '');
            btn.textContent = cat;
            btn.onclick = () => {
                currentCategory = cat;
                renderAll();
            };
            tabBar.appendChild(btn);
        });
    }

    // 이모티콘 그리드 렌더링
    function renderGrid() {
        grid.innerHTML = '';
        const emoticons = loadEmoticons();

        let filtered = emoticons;
        if (currentCategory === '즐겨찾기') {
            filtered = filtered.filter(e => e.favorite);
        } else if (currentCategory !== '전체') {
            filtered = filtered.filter(e => e.category === currentCategory);
        }
        if (searchQuery) {
            filtered = filtered.filter(e => e.name.toLowerCase().includes(searchQuery));
        }

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'slm-empty';
            empty.textContent = '이모티콘이 없습니다.';
            grid.appendChild(empty);
            return;
        }

        filtered.forEach(e => {
            const cell = document.createElement('div');
            cell.className = 'slm-emoticon-cell';
            cell.title = `${e.name}${e.aiUsable ? '' : ' 🔒'}`;

            const img = document.createElement('img');
            img.src = e.url;
            img.alt = e.name;
            img.className = 'slm-emoticon-img';
            img.onerror = () => { img.style.display = 'none'; };

            const lockIcon = document.createElement('span');
            lockIcon.className = 'slm-emoticon-lock';
            lockIcon.textContent = e.aiUsable ? '' : '🔒';

            // 클릭 시 전송 (설정된 크기로 scale)
            cell.onclick = async () => {
                try {
                    const size = getEmoticonSize();
                    const radius = getEmoticonRadius();
                    // HTML img 태그로 크기/모서리 지정 (URL/이름 이스케이프)
                    const safeName = e.name.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    const safeUrl = e.url.replace(/"/g, '&quot;');
                    const html = `<img src="${safeUrl}" alt="${safeName}" style="width:${size}px;height:${size}px;object-fit:contain;display:inline-block;vertical-align:middle;border-radius:${radius}px">`;
                    await slashSend(html);
                    showToast(`이모티콘 전송: ${e.name}`, 'success', 1000);
                } catch (err) {
                    showToast('전송 실패', 'error');
                }
            };

            // 우클릭으로 즐겨찾기/삭제
            cell.oncontextmenu = (ev) => {
                ev.preventDefault();
                openEmoticonContextMenu(ev, e, renderAll);
            };

            cell.appendChild(img);
            cell.appendChild(lockIcon);
            grid.appendChild(cell);
        });
    }

    renderAll();
    return wrapper;
}

/**
 * 이모티콘 추가 서브창을 연다
 * @param {Function} onSave - 저장 후 콜백
 * @param {Emoticon|null} existing - 편집할 이모티콘 (없으면 새로 추가)
 */
function openAddEmoticonDialog(onSave, existing = null) {
    const isEdit = !!existing;
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';

    // 이름 입력
    const nameInput = createFormField(wrapper, '이름', 'text', existing?.name || '');

    // URL 입력
    const urlLabel = document.createElement('label');
    urlLabel.className = 'slm-label';
    urlLabel.textContent = 'URL';
    const urlInput = document.createElement('input');
    urlInput.className = 'slm-input';
    urlInput.type = 'url';
    urlInput.value = existing?.url || '';

    // 미리보기
    const preview = document.createElement('img');
    preview.className = 'slm-preview-img';
    preview.style.display = 'none';
    urlInput.oninput = () => {
        const val = urlInput.value.trim();
        if (val) {
            preview.src = val;
            preview.style.display = 'block';
            preview.style.borderRadius = getEmoticonRadius() + 'px';
        } else {
            preview.style.display = 'none';
        }
    };
    if (existing?.url) {
        preview.src = existing.url;
        preview.style.display = 'block';
        preview.style.borderRadius = getEmoticonRadius() + 'px';
    }

    wrapper.appendChild(urlLabel);
    wrapper.appendChild(urlInput);
    wrapper.appendChild(preview);

    // 카테고리 입력
    const catInput = createFormField(wrapper, '카테고리', 'text', existing?.category || '기본');

    // AI 사용 여부
    const aiRow = document.createElement('div');
    aiRow.className = 'slm-radio-row';
    const aiLabel = document.createElement('span');
    aiLabel.className = 'slm-label';
    aiLabel.textContent = 'AI 사용:';

    const radioYes = document.createElement('input');
    radioYes.type = 'radio';
    radioYes.name = 'slm-ai-usable';
    radioYes.value = 'yes';
    radioYes.checked = existing ? existing.aiUsable : true;

    const radioYesLabel = document.createElement('label');
    radioYesLabel.textContent = '가능';

    const radioNo = document.createElement('input');
    radioNo.type = 'radio';
    radioNo.name = 'slm-ai-usable';
    radioNo.value = 'no';
    radioNo.checked = existing ? !existing.aiUsable : false;

    const radioNoLabel = document.createElement('label');
    radioNoLabel.textContent = '불가';

    aiRow.appendChild(aiLabel);
    aiRow.appendChild(radioYes);
    aiRow.appendChild(radioYesLabel);
    aiRow.appendChild(radioNo);
    aiRow.appendChild(radioNoLabel);
    wrapper.appendChild(aiRow);

    // footer 버튼 생성 후 createPopup에 전달
    const footer = document.createElement('div');
    footer.className = 'slm-panel-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'slm-btn slm-btn-secondary';
    cancelBtn.textContent = '취소';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'slm-btn slm-btn-primary';
    saveBtn.textContent = '저장';

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    const { close } = createPopup({
        id: 'emoticon-add',
        title: isEdit ? '이모티콘 편집' : '이모티콘 추가',
        content: wrapper,
        footer,
        className: 'slm-sub-panel',
    });

    cancelBtn.onclick = () => close();

    saveBtn.onclick = () => {
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();
        const category = catInput.value.trim() || '기본';
        const aiUsable = radioYes.checked;

        if (!name || !url) {
            showToast('이름과 URL을 입력해주세요.', 'warn');
            return;
        }

        const emoticons = loadEmoticons();
        if (isEdit) {
            const idx = emoticons.findIndex(e => e.id === existing.id);
            if (idx !== -1) {
                emoticons[idx] = { ...existing, name, url, category, aiUsable };
            }
        } else {
            emoticons.push({
                id: crypto.randomUUID(),
                name, url, category,
                favorite: false,
                aiUsable,
            });
        }
        saveEmoticons(emoticons);
        close();
        onSave();
        showToast(isEdit ? '이모티콘 편집 완료' : '이모티콘 추가 완료', 'success');
    };
}

/**
 * 이모티콘 우클릭 컨텍스트 메뉴
 */
function openEmoticonContextMenu(ev, emoticon, onUpdate) {
    // 기존 메뉴 제거
    document.querySelectorAll('.slm-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'slm-context-menu';
    menu.style.left = `${Math.min(ev.clientX, window.innerWidth - 160)}px`;
    menu.style.top = `${Math.min(ev.clientY, window.innerHeight - 120)}px`;

    const favItem = document.createElement('button');
    favItem.className = 'slm-context-item';
    favItem.textContent = emoticon.favorite ? '⭐ 즐겨찾기 해제' : '⭐ 즐겨찾기 추가';
    favItem.onclick = () => {
        const list = loadEmoticons();
        const idx = list.findIndex(e => e.id === emoticon.id);
        if (idx !== -1) list[idx].favorite = !list[idx].favorite;
        saveEmoticons(list);
        menu.remove();
        onUpdate();
    };

    const editItem = document.createElement('button');
    editItem.className = 'slm-context-item';
    editItem.textContent = '✏️ 편집';
    editItem.onclick = () => { menu.remove(); openAddEmoticonDialog(onUpdate, emoticon); };

    const delItem = document.createElement('button');
    delItem.className = 'slm-context-item slm-context-danger';
    delItem.textContent = '🗑️ 삭제';
    delItem.onclick = () => {
        const list = loadEmoticons().filter(e => e.id !== emoticon.id);
        saveEmoticons(list);
        menu.remove();
        onUpdate();
    };

    menu.appendChild(favItem);
    menu.appendChild(editItem);
    menu.appendChild(delItem);
    document.body.appendChild(menu);

    // 외부 클릭으로 메뉴 닫기
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
}

/**
 * 폼 필드를 생성하고 컨테이너에 추가한다
 * @param {HTMLElement} container
 * @param {string} label
 * @param {string} type
 * @param {string} value
 * @returns {HTMLInputElement}
 */
function createFormField(container, label, type, value) {
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

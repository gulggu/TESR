/**
 * contacts.js
 * NPC 연락처 모듈
 * - 연락처 등록/편집/삭제
 * - {{char}} 연락처 자동 등록
 * - 연락처 클릭 시 상세 정보 팝업
 * - 컨텍스트에 인물 정보 주입
 * - 채팅별 또는 캐릭터별 바인딩
 */

import { getContext } from '../../utils/st-context.js';
import { loadData, saveData } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast, escapeHtml } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';

const MODULE_KEY = 'contacts';

/**
 * @typedef {Object} Contact
 * @property {string} id
 * @property {string} name
 * @property {string} avatar
 * @property {string} description
 * @property {string} relationToUser
 * @property {string} relationToChar
 * @property {string} personality
 * @property {string} phone
 * @property {string[]} tags
 * @property {'chat'|'character'} binding
 * @property {boolean} [isCharAuto] - {{char}} 자동 추가 여부
 */

/**
 * 저장된 연락처 목록을 불러온다
 * @param {'chat'|'character'} binding
 * @returns {Contact[]}
 */
function loadContacts(binding = 'chat') {
    return loadData(MODULE_KEY, [], binding);
}

/**
 * 연락처 목록을 저장한다
 * @param {Contact[]} contacts
 * @param {'chat'|'character'} binding
 */
function saveContacts(contacts, binding = 'chat') {
    saveData(MODULE_KEY, contacts, binding);
}

/**
 * {{char}} 연락처를 자동으로 추가한다 (아직 없는 경우에만)
 */
function ensureCharContact() {
    const ctx = getContext();
    if (!ctx) return;
    const charName = ctx.name2;
    if (!charName) return;

    const contacts = loadContacts('chat');
    const exists = contacts.some(c => c.isCharAuto || c.name === charName);
    if (exists) return;

    contacts.push({
        id: crypto.randomUUID(),
        name: charName,
        avatar: ctx.characters?.[ctx.characterId]?.avatar
            ? `/characters/${ctx.characters?.[ctx.characterId]?.avatar}`
            : '',
        description: ctx.characters?.[ctx.characterId]?.description || '',
        relationToUser: '주요 캐릭터',
        relationToChar: '',
        personality: ctx.characters?.[ctx.characterId]?.personality || '',
        phone: '',
        tags: [],
        binding: 'chat',
        isCharAuto: true,
    });
    saveContacts(contacts, 'chat');
}

/**
 * 연락처 모듈을 초기화한다
 */
export function initContacts() {
    // 컨텍스트 빌더 등록
    registerContextBuilder('contacts', () => {
        const chatContacts = loadContacts('chat');
        const charContacts = loadContacts('character');
        const all = [...chatContacts, ...charContacts];

        if (all.length === 0) return null;

        const lines = all.map(c => {
            let line = `• ${c.name}`;
            if (c.relationToUser) line += ` | Relation to {{user}}: ${c.relationToUser}`;
            if (c.relationToChar) line += ` | Relation to {{char}}: ${c.relationToChar}`;
            if (c.personality) line += ` | Personality: ${c.personality}`;
            return line;
        });

        return `=== Contacts ===\n${lines.join('\n')}\n→ These characters may contact {{user}} or be mentioned in {{char}}'s conversation at any time.`;
    });

    // 채팅 로드 시 {{char}} 자동 추가
    const ctx = getContext();
    if (ctx?.eventSource && ctx?.event_types) {
        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
            ensureCharContact();
        });
    }
    // 즉시도 한번 실행
    ensureCharContact();
}

/**
 * 연락처 팝업을 연다
 */
export function openContactsPopup(onBack) {
    const content = buildContactsContent();
    createPopup({
        id: 'contacts',
        title: '📋 연락처',
        content,
        className: 'slm-contacts-panel',
        onBack,
    });
}

/**
 * 연락처 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildContactsContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-contacts-wrapper';

    // 바인딩 타입 상태
    let binding = 'chat';

    // 검색창
    const searchInput = document.createElement('input');
    searchInput.className = 'slm-input slm-search';
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 검색...';
    searchInput.oninput = () => renderList();
    wrapper.appendChild(searchInput);

    // 새 연락처 버튼
    const addBtn = document.createElement('button');
    addBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    addBtn.textContent = '+ 새 연락처';
    addBtn.style.marginBottom = '8px';
    addBtn.onclick = () => openContactDialog(null, binding, renderList);
    wrapper.appendChild(addBtn);

    // 연락처 목록
    const list = document.createElement('div');
    list.className = 'slm-contacts-list';
    wrapper.appendChild(list);

    // 바인딩 전환
    const bindingRow = document.createElement('div');
    bindingRow.className = 'slm-binding-row';
    bindingRow.innerHTML = `
        <span class="slm-label">저장 방식:</span>
        <label><input type="radio" name="slm-binding" value="chat" checked> 이 채팅</label>
        <label><input type="radio" name="slm-binding" value="character"> 이 캐릭터</label>
    `;
    bindingRow.querySelectorAll('input[name="slm-binding"]').forEach(r => {
        r.onchange = () => { binding = r.value; renderList(); };
    });
    wrapper.appendChild(bindingRow);

    function renderList() {
        list.innerHTML = '';
        const contacts = loadContacts(binding);
        const query = searchInput.value.toLowerCase();
        const filtered = query
            ? contacts.filter(c => c.name.toLowerCase().includes(query) || (c.description || '').toLowerCase().includes(query))
            : contacts;

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'slm-empty';
            empty.textContent = '연락처가 없습니다.';
            list.appendChild(empty);
            return;
        }

        filtered.forEach(contact => {
            const row = document.createElement('div');
            row.className = 'slm-contact-row';
            row.style.cursor = 'pointer';

            // 아바타
            const avatar = document.createElement('div');
            avatar.className = 'slm-contact-avatar';
            if (contact.avatar) {
                const img = document.createElement('img');
                img.src = contact.avatar;
                img.alt = contact.name;
                img.onerror = () => { avatar.textContent = contact.name[0] || '?'; };
                avatar.appendChild(img);
            } else {
                avatar.textContent = contact.name[0] || '?';
            }

            // 정보
            const info = document.createElement('div');
            info.className = 'slm-contact-info';

            const name = document.createElement('span');
            name.className = 'slm-contact-name';
            name.textContent = contact.name;

            const rel = document.createElement('span');
            rel.className = 'slm-contact-rel';
            rel.textContent = contact.relationToUser || contact.description || '';

            info.appendChild(name);
            info.appendChild(rel);

            // 클릭 시 상세 팝업
            const clickArea = document.createElement('div');
            clickArea.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer';
            clickArea.appendChild(avatar);
            clickArea.appendChild(info);
            clickArea.onclick = () => openContactDetailPopup(contact);

            // 편집 버튼
            const editBtn = document.createElement('button');
            editBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
            editBtn.textContent = '편집';
            editBtn.onclick = (e) => { e.stopPropagation(); openContactDialog(contact, binding, renderList); };

            // 삭제 버튼
            const delBtn = document.createElement('button');
            delBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
            delBtn.textContent = '삭제';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                const updated = loadContacts(binding).filter(c => c.id !== contact.id);
                saveContacts(updated, binding);
                renderList();
                showToast('연락처 삭제', 'success', 1500);
            };

            row.appendChild(clickArea);
            row.appendChild(editBtn);
            row.appendChild(delBtn);
            list.appendChild(row);
        });
    }

    renderList();
    return wrapper;
}

/**
 * 연락처 상세 팝업을 연다
 * @param {Contact} contact
 */
function openContactDetailPopup(contact) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-contact-detail';

    // 아바타
    const avatar = document.createElement('div');
    avatar.className = 'slm-contact-detail-avatar';
    if (contact.avatar) {
        const img = document.createElement('img');
        img.src = contact.avatar;
        img.alt = contact.name;
        img.onerror = () => { avatar.textContent = contact.name[0] || '?'; };
        avatar.appendChild(img);
    } else {
        avatar.textContent = contact.name[0] || '?';
    }
    wrapper.appendChild(avatar);

    // 이름
    const nameEl = document.createElement('div');
    nameEl.className = 'slm-contact-detail-name';
    nameEl.textContent = contact.name;
    wrapper.appendChild(nameEl);

    // 상세 필드들
    const fields = document.createElement('div');
    fields.className = 'slm-contact-detail-fields';

    const fieldDefs = [
        { label: '관계', value: contact.relationToUser },
        { label: '{{char}}과의 관계', value: contact.relationToChar },
        { label: '성격/말투', value: contact.personality },
    ];

    fieldDefs.forEach(({ label, value }) => {
        if (!value) return;
        const row = document.createElement('div');
        row.className = 'slm-contact-field-row';
        row.innerHTML = `
            <span class="slm-contact-field-label">${escapeHtml(label)}</span>
            <span class="slm-contact-field-value">${escapeHtml(value)}</span>
        `;
        fields.appendChild(row);
    });

    wrapper.appendChild(fields);

    createPopup({
        id: 'contact-detail',
        title: `👤 ${contact.name}`,
        content: wrapper,
        className: 'slm-sub-panel',
        onBack: () => openContactsPopup(),
    });
}

/**
 * 연락처 등록/편집 서브창을 연다
 * @param {Contact|null} existing
 * @param {'chat'|'character'} binding
 * @param {Function} onSave
 */
function openContactDialog(existing, binding, onSave) {
    const isEdit = !!existing;
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';

    const fields = {
        name: createFormField(wrapper, '이름 *', 'text', existing?.name || ''),
        avatar: createFormField(wrapper, '프로필 이미지 URL', 'url', existing?.avatar || ''),
        description: createFormField(wrapper, '설명', 'text', existing?.description || ''),
        relationToUser: createFormField(wrapper, '{{user}}와의 관계 *', 'text', existing?.relationToUser || ''),
        relationToChar: createFormField(wrapper, '{{char}}와의 관계', 'text', existing?.relationToChar || ''),
        personality: createFormField(wrapper, '성격/말투', 'text', existing?.personality || ''),
    };

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
        id: 'contact-edit',
        title: isEdit ? '연락처 편집' : '연락처 등록',
        content: wrapper,
        footer,
        className: 'slm-sub-panel',
        onBack: () => openContactsPopup(),
    });

    cancelBtn.onclick = () => close();

    saveBtn.onclick = () => {
        const name = fields.name.value.trim();
        const relationToUser = fields.relationToUser.value.trim();
        if (!name || !relationToUser) {
            showToast('이름과 관계는 필수입니다.', 'warn');
            return;
        }

        const contacts = loadContacts(binding);
        const data = {
            id: existing?.id || crypto.randomUUID(),
            name,
            avatar: fields.avatar.value.trim(),
            description: fields.description.value.trim(),
            relationToUser,
            relationToChar: fields.relationToChar.value.trim(),
            personality: fields.personality.value.trim(),
            phone: '',
            tags: existing?.tags || [],
            binding,
        };

        if (isEdit) {
            const idx = contacts.findIndex(c => c.id === existing.id);
            if (idx !== -1) contacts[idx] = data;
        } else {
            contacts.push(data);
        }

        saveContacts(contacts, binding);
        close();
        onSave();
        showToast(isEdit ? '연락처 수정 완료' : '연락처 추가 완료', 'success');
    };
}

/**
 * 폼 필드를 생성한다
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

/**
 * 등록된 연락처 목록을 반환한다 (다른 모듈에서 참조용)
 * @param {'chat'|'character'} binding
 * @returns {Contact[]}
 */
export function getContacts(binding = 'chat') {
    return loadContacts(binding);
}

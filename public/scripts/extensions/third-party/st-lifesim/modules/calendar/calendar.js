/**
 * calendar.js
 * 일정 캘린더 모듈
 * - 1~30일 순환 달력 (롤플레이용, 현실 날짜 미사용)
 * - 오늘 날짜 수동 설정 및 앞뒤 이동
 * - 일정 추가/편집/삭제
 * - 컨텍스트에 오늘/예정 일정 주입
 */

import { loadData, saveData, getDefaultBinding } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast, escapeHtml } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';

const MODULE_KEY = 'calendar';

/**
 * 기본 캘린더 데이터
 */
const DEFAULT_CALENDAR = {
    today: 1,
    events: [],
};

/**
 * 캘린더 데이터 불러오기
 * @returns {Object}
 */
function loadCalendar() {
    return loadData(MODULE_KEY, { ...DEFAULT_CALENDAR }, getDefaultBinding());
}

/**
 * 캘린더 데이터 저장
 * @param {Object} cal
 */
function saveCalendar(cal) {
    saveData(MODULE_KEY, cal, getDefaultBinding());
}

/**
 * 일수를 30일 범위로 정규화한다 (1~30)
 * 음수 입력도 정상 처리한다
 * @param {number} day
 * @returns {number}
 */
function normalizeDay(day) {
    return ((day - 1) % 30 + 30) % 30 + 1;
}

/**
 * 캘린더 모듈을 초기화한다
 */
export function initCalendar() {
    // 컨텍스트 빌더 등록
    registerContextBuilder('calendar', () => {
        const cal = loadCalendar();
        if (!cal.events || cal.events.length === 0) return null;

        const today = cal.today;
        const upcoming = cal.events
            .filter(e => !e.done)
            .map(e => {
                // 오늘과의 차이 계산 (30일 순환)
                const diff = (e.day - today + 30) % 30;
                return { ...e, diff };
            })
            .filter(e => e.diff <= 7) // 7일 이내
            .sort((a, b) => a.diff - b.diff);

        if (upcoming.length === 0) return null;

        const lines = upcoming.map(e => {
            const label = e.diff === 0
                ? `Today (Day ${today})`
                : `D+${e.diff} (Day ${e.day})`;
            return `${label}: ${e.title}${e.time ? ` (${e.time})` : ''}${e.description ? `, ${e.description}` : ''}`;
        });

        return `=== Schedule ===\n${lines.join('\n')}`;
    });
}

/**
 * 캘린더 팝업을 연다
 */
export function openCalendarPopup(onBack) {
    const content = buildCalendarContent();
    createPopup({
        id: 'calendar',
        title: '📅 캘린더',
        content,
        className: 'slm-calendar-panel',
        onBack,
    });
}

/**
 * 캘린더 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildCalendarContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-calendar-wrapper';

    let cal = loadCalendar();

    // 오늘 날짜 헤더
    const todayRow = document.createElement('div');
    todayRow.className = 'slm-today-row';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
    prevBtn.textContent = '◀';
    prevBtn.onclick = () => {
        cal = loadCalendar();
        cal.today = normalizeDay(cal.today - 1);
        saveCalendar(cal);
        renderAll();
    };

    const todayLabel = document.createElement('span');
    todayLabel.className = 'slm-today-label';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
    nextBtn.textContent = '▶';
    nextBtn.onclick = () => {
        cal = loadCalendar();
        cal.today = normalizeDay(cal.today + 1);
        saveCalendar(cal);
        renderAll();
    };

    todayRow.appendChild(prevBtn);
    todayRow.appendChild(todayLabel);
    todayRow.appendChild(nextBtn);
    wrapper.appendChild(todayRow);

    // 달력 그리드 (7열)
    const calGrid = document.createElement('div');
    calGrid.className = 'slm-cal-grid';
    wrapper.appendChild(calGrid);

    // 일정 목록
    const addBtn = document.createElement('button');
    addBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    addBtn.textContent = '+ 일정 추가';
    addBtn.onclick = () => openEventDialog(null, renderAll);

    const clearAllBtn = document.createElement('button');
    clearAllBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
    clearAllBtn.textContent = '🗑️ 전체 삭제';
    clearAllBtn.onclick = () => {
        if (!confirm('모든 일정을 삭제하시겠습니까?')) return;
        const c = loadCalendar();
        c.events = [];
        saveCalendar(c);
        renderAll();
        showToast('모든 일정이 삭제되었습니다.', 'success', 1500);
    };

    const btnRow = document.createElement('div');
    btnRow.className = 'slm-btn-row';
    btnRow.appendChild(addBtn);
    btnRow.appendChild(clearAllBtn);
    wrapper.appendChild(btnRow);

    const eventList = document.createElement('div');
    eventList.className = 'slm-event-list';
    wrapper.appendChild(eventList);

    function renderAll() {
        cal = loadCalendar();
        todayLabel.textContent = `오늘: ${cal.today}일`;
        renderCalGrid();
        renderEvents();
    }

    // 달력 그리드 렌더링 (1~30일 7열 배치)
    function renderCalGrid() {
        calGrid.innerHTML = '';

        // 요일 헤더
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        days.forEach(d => {
            const cell = document.createElement('div');
            cell.className = 'slm-cal-header';
            cell.textContent = d;
            calGrid.appendChild(cell);
        });

        // 1일이 일요일이 되도록 빈 셀 채우기 (고정 레이아웃)
        // 실제 롤플레이 캘린더이므로 1일부터 순서대로 표시
        for (let day = 1; day <= 30; day++) {
            const cell = document.createElement('div');
            cell.className = 'slm-cal-day';

            if (day === cal.today) cell.classList.add('today');

            const hasEvent = cal.events.some(e => e.day === day && !e.done);
            if (hasEvent) cell.classList.add('has-event');

            cell.textContent = String(day);
            cell.onclick = () => openEventDialog({ day }, renderAll);
            calGrid.appendChild(cell);
        }
    }

    // 일정 목록 렌더링
    function renderEvents() {
        eventList.innerHTML = '';
        const events = [...cal.events].sort((a, b) => {
            const da = (a.day - cal.today + 30) % 30;
            const db = (b.day - cal.today + 30) % 30;
            return da - db;
        });

        if (events.length === 0) {
            eventList.innerHTML = '<div class="slm-empty">일정이 없습니다.</div>';
            return;
        }

        events.forEach(ev => {
            const row = document.createElement('div');
            row.className = `slm-event-row${ev.done ? ' done' : ''}`;

            const diff = (ev.day - cal.today + 30) % 30;
            const label = diff === 0 ? '오늘' : `D+${diff}`;

            row.innerHTML = `
                <span class="slm-event-label">${escapeHtml(label)}(${ev.day}일)</span>
                <span class="slm-event-time">${escapeHtml(ev.time || '')}</span>
                <span class="slm-event-title">${escapeHtml(ev.title)}</span>
            `;

            const btnRow = document.createElement('div');
            btnRow.className = 'slm-event-btns';

            const editBtn = document.createElement('button');
            editBtn.className = 'slm-btn slm-btn-ghost slm-btn-xs';
            editBtn.textContent = '편집';
            editBtn.onclick = () => openEventDialog(ev, renderAll);

            const doneBtn = document.createElement('button');
            doneBtn.className = 'slm-btn slm-btn-secondary slm-btn-xs';
            doneBtn.textContent = ev.done ? '완료 취소' : '완료';
            doneBtn.onclick = () => {
                const c = loadCalendar();
                const e = c.events.find(e => e.id === ev.id);
                if (e) { e.done = !e.done; saveCalendar(c); renderAll(); }
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'slm-btn slm-btn-danger slm-btn-xs';
            delBtn.textContent = '삭제';
            delBtn.onclick = () => {
                const c = loadCalendar();
                c.events = c.events.filter(e => e.id !== ev.id);
                saveCalendar(c);
                renderAll();
                showToast('일정 삭제', 'success', 1500);
            };

            btnRow.appendChild(editBtn);
            btnRow.appendChild(doneBtn);
            btnRow.appendChild(delBtn);
            row.appendChild(btnRow);
            eventList.appendChild(row);
        });
    }

    renderAll();
    return wrapper;
}

/**
 * 일정 추가/편집 서브창을 연다
 * @param {Object|null} existing - 편집할 일정 또는 { day } 형태의 기본값
 * @param {Function} onSave - 저장 후 콜백
 */
function openEventDialog(existing, onSave) {
    const isEdit = !!(existing?.id);
    const cal = loadCalendar();

    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';

    // 날짜 입력
    const dayRow = document.createElement('div');
    dayRow.className = 'slm-input-row';

    const dayLabel = document.createElement('label');
    dayLabel.className = 'slm-label';
    dayLabel.textContent = '날짜';

    const dayInput = document.createElement('input');
    dayInput.className = 'slm-input slm-input-sm';
    dayInput.type = 'number';
    dayInput.min = '1';
    dayInput.max = '30';
    dayInput.value = String(existing?.day || cal.today);

    const dayUnit = document.createElement('span');
    dayUnit.className = 'slm-label';
    dayUnit.textContent = '일';

    dayRow.appendChild(dayLabel);
    dayRow.appendChild(dayInput);
    dayRow.appendChild(dayUnit);
    wrapper.appendChild(dayRow);

    // 시간 입력
    const timeInput = createFormField(wrapper, '시간', 'time', existing?.time || '');

    // 제목 입력
    const titleInput = createFormField(wrapper, '제목 *', 'text', existing?.title || '');

    // 내용 입력
    const descInput = createFormField(wrapper, '내용', 'text', existing?.description || '');

    // 관련 인물 선택
    const contactLabel = document.createElement('label');
    contactLabel.className = 'slm-label';
    contactLabel.textContent = '관련 인물';

    const contactSelect = document.createElement('select');
    contactSelect.className = 'slm-select';

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '없음';
    contactSelect.appendChild(noneOpt);

    getContacts('chat').forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (existing?.relatedContactId === c.id) opt.selected = true;
        contactSelect.appendChild(opt);
    });

    wrapper.appendChild(contactLabel);
    wrapper.appendChild(contactSelect);

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
        id: 'event-edit',
        title: isEdit ? '일정 편집' : '일정 추가',
        content: wrapper,
        footer,
        className: 'slm-sub-panel',
    });

    cancelBtn.onclick = () => close();

    saveBtn.onclick = () => {
        const title = titleInput.value.trim();
        if (!title) { showToast('제목을 입력해주세요.', 'warn'); return; }

        const day = parseInt(dayInput.value) || 1;

        const c = loadCalendar();
        const eventData = {
            id: existing?.id || crypto.randomUUID(),
            day: normalizeDay(day),
            time: timeInput.value,
            title,
            description: descInput.value.trim(),
            relatedContactId: contactSelect.value,
            done: existing?.done || false,
        };

        if (isEdit) {
            const idx = c.events.findIndex(e => e.id === existing.id);
            if (idx !== -1) c.events[idx] = eventData;
        } else {
            c.events.push(eventData);
        }

        saveCalendar(c);
        close();
        onSave();
        showToast(isEdit ? '일정 수정 완료' : '일정 추가 완료', 'success');
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

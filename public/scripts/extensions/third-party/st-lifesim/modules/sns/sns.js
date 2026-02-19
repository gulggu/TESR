/**
 * sns.js
 * SNS 피드 모듈
 * - 유저 직접 게시물 올리기
 * - AI가 {{char}} 또는 NPC 이름으로 랜덤 포스팅 (20% 확률 자동, 수동 버튼)
 * - 댓글/답글 기능
 * - 컨텍스트에 최근 피드 주입
 */

import { getContext } from '../../../../../st-context.js';
import { slashSend, slashGen, slashEcho } from '../../utils/slash.js';
import { loadData, saveData } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast, escapeHtml } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';

const MODULE_KEY = 'sns-feed';

/**
 * SNS 피드 데이터 불러오기
 * @returns {Object[]}
 */
function loadFeed() {
    return loadData(MODULE_KEY, [], 'chat');
}

/**
 * SNS 피드 저장
 * @param {Object[]} feed
 */
function saveFeed(feed) {
    saveData(MODULE_KEY, feed, 'chat');
}

/**
 * SNS 모듈을 초기화한다
 */
export function initSns() {
    const ctx = getContext();

    // 컨텍스트 빌더 등록
    registerContextBuilder('sns', () => {
        const feed = loadFeed();
        const contextPosts = feed.filter(p => p.includeInContext).slice(-5);
        if (contextPosts.length === 0) return null;
        const lines = contextPosts.map(p => {
            const d = new Date(p.date);
            return `• ${p.authorName}: "${p.content}" (${d.toLocaleDateString('ko-KR')})`;
        });
        return `=== 최근 SNS ===\n${lines.join('\n')}`;
    });

    // AI 응답 후 20% 확률로 NPC 포스팅 자동 발동
    if (ctx?.eventSource && ctx?.event_types) {
        ctx.eventSource.on(ctx.event_types.CHARACTER_MESSAGE_RENDERED, () => {
            if (Math.random() < 0.20) {
                triggerNpcPosting().catch(e => console.error('[ST-LifeSim] SNS 자동 포스팅 오류:', e));
            }
        });
    }
}

/**
 * NPC 또는 {{char}} 랜덤 포스팅을 트리거한다
 */
export async function triggerNpcPosting() {
    const ctx = getContext();
    const charName = ctx?.name2 || '{{char}}';

    // 포스팅 후보: {{char}} + 연락처 NPC
    const contacts = getContacts('chat');
    const candidates = [
        { name: charName, personality: '', isChar: true },
        ...contacts.map(c => ({ name: c.name, personality: c.personality, isChar: false })),
    ];

    if (candidates.length === 0) return;

    // 무작위 선택
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const prompt = pick.isChar
        ? `${charName}이 SNS에 게시물을 올렸다. 현재 상황과 성격에 어울리는 짧은 포스팅 텍스트와 해시태그를 작성하라. 이미지 묘사도 한 줄 추가하라.`
        : `${pick.name}이 SNS에 게시물을 올렸다. 성격: ${pick.personality || '보통'}. 짧은 포스팅 텍스트와 해시태그를 작성하라. 이미지 묘사도 한 줄 추가하라.`;

    try {
        // AI 생성 후 캐릭터 이름으로 채팅에 삽입
        // 생성 전 채팅 메시지 수를 기록하여 새로 추가된 메시지를 특정한다
        const freshCtx = getContext();
        const chatLengthBefore = freshCtx?.chat?.length ?? 0;

        await slashGen(prompt, pick.name);

        // 생성 후 채팅에서 새로 추가된 메시지를 가져온다
        const afterCtx = getContext();
        let postContent = '(게시물)';
        if (afterCtx?.chat && afterCtx.chat.length > chatLengthBefore) {
            // 새로 추가된 마지막 AI 메시지를 피드 내용으로 사용
            const newMsg = afterCtx.chat[afterCtx.chat.length - 1];
            if (newMsg && !newMsg.is_user) {
                postContent = newMsg.mes || postContent;
            }
        }

        const feed = loadFeed();
        feed.push({
            id: crypto.randomUUID(),
            authorName: pick.name,
            authorIsUser: false,
            date: new Date().toISOString(),
            content: postContent,
            imageUrl: '',
            likes: Math.floor(Math.random() * 20),
            likedByUser: false,
            comments: [],
            isStory: false,
            includeInContext: true,
        });
        saveFeed(feed);

        // /echo로 알림
        await slashEcho(`📸 ${pick.name}님이 새 게시물을 올렸습니다.`);
    } catch (e) {
        console.error('[ST-LifeSim] NPC 포스팅 생성 오류:', e);
    }
}

/**
 * SNS 팝업을 연다
 */
export function openSnsPopup() {
    const content = buildSnsContent();
    createPopup({
        id: 'sns',
        title: '📸 SNS',
        content,
        className: 'slm-sns-panel',
    });
}

/**
 * SNS 팝업 내용을 빌드한다
 * @returns {HTMLElement}
 */
function buildSnsContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-sns-wrapper';

    // 버튼 행
    const btnRow = document.createElement('div');
    btnRow.className = 'slm-btn-row';

    const writeBtn = document.createElement('button');
    writeBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    writeBtn.textContent = '✏️ 직접 올리기';
    writeBtn.onclick = () => openWritePostDialog(renderFeed);

    const npcPostBtn = document.createElement('button');
    npcPostBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    npcPostBtn.textContent = '🎲 NPC 포스팅';
    npcPostBtn.onclick = async () => {
        npcPostBtn.disabled = true;
        try {
            await triggerNpcPosting();
            renderFeed();
        } finally {
            npcPostBtn.disabled = false;
        }
    };

    btnRow.appendChild(writeBtn);
    btnRow.appendChild(npcPostBtn);
    wrapper.appendChild(btnRow);

    // 피드 목록
    const feedList = document.createElement('div');
    feedList.className = 'slm-feed-list';
    wrapper.appendChild(feedList);

    function renderFeed() {
        feedList.innerHTML = '';
        const feed = loadFeed();

        if (feed.length === 0) {
            feedList.innerHTML = '<div class="slm-empty">게시물이 없습니다.</div>';
            return;
        }

        feed.slice().reverse().forEach(post => {
            const card = document.createElement('div');
            card.className = 'slm-post-card';

            const d = new Date(post.date);

            card.innerHTML = `
                <div class="slm-post-header">
                    <span class="slm-post-author">${escapeHtml(post.authorName)}</span>
                    <span class="slm-post-date">· ${d.toLocaleDateString('ko-KR')}</span>
                </div>
                <div class="slm-post-content">${escapeHtml(post.content)}</div>
                ${post.imageUrl ? `<img class="slm-post-img" src="${escapeHtml(post.imageUrl)}" alt="게시물 이미지">` : ''}
                <div class="slm-post-actions">
                    <button class="slm-like-btn ${post.likedByUser ? 'liked' : ''}" data-id="${escapeHtml(post.id)}">
                        ❤️ ${post.likes}
                    </button>
                    <button class="slm-comment-toggle-btn" data-id="${escapeHtml(post.id)}">
                        💬 댓글 ${post.comments.length}개
                    </button>
                    <label class="slm-context-toggle">
                        <input type="checkbox" ${post.includeInContext ? 'checked' : ''} data-id="${escapeHtml(post.id)}">
                        컨텍스트 포함
                    </label>
                </div>
            `;

            // 댓글 영역
            const commentSection = document.createElement('div');
            commentSection.className = 'slm-comment-section';
            commentSection.style.display = 'none';
            renderComments(commentSection, post, renderFeed);
            card.appendChild(commentSection);

            // 좋아요 버튼
            card.querySelector('.slm-like-btn').onclick = () => {
                const f = loadFeed();
                const p = f.find(p => p.id === post.id);
                if (p) {
                    p.likedByUser = !p.likedByUser;
                    p.likes += p.likedByUser ? 1 : -1;
                    saveFeed(f);
                    renderFeed();
                }
            };

            // 댓글 토글
            card.querySelector('.slm-comment-toggle-btn').onclick = () => {
                const isHidden = commentSection.style.display === 'none';
                commentSection.style.display = isHidden ? 'block' : 'none';
            };

            // 컨텍스트 포함 체크박스
            card.querySelector('input[type="checkbox"]').onchange = (e) => {
                const f = loadFeed();
                const p = f.find(p => p.id === post.id);
                if (p) { p.includeInContext = e.target.checked; saveFeed(f); }
            };

            feedList.appendChild(card);
        });
    }

    renderFeed();
    return wrapper;
}

/**
 * 댓글 영역을 렌더링한다
 * @param {HTMLElement} container
 * @param {Object} post
 * @param {Function} onUpdate
 */
function renderComments(container, post, onUpdate) {
    container.innerHTML = '';

    // 기존 댓글 표시
    post.comments.forEach(c => {
        const commentDiv = document.createElement('div');
        commentDiv.className = 'slm-comment';
        commentDiv.innerHTML = `
            <span class="slm-comment-author">${escapeHtml(c.author)}</span>
            <span class="slm-comment-text">${escapeHtml(c.text)}</span>
        `;

        // 답글 표시
        if (c.replies && c.replies.length > 0) {
            c.replies.forEach(r => {
                const replyDiv = document.createElement('div');
                replyDiv.className = 'slm-reply';
                replyDiv.innerHTML = `
                    <span class="slm-comment-author">└ ${escapeHtml(r.author)}</span>
                    <span class="slm-comment-text">${escapeHtml(r.text)}</span>
                `;
                commentDiv.appendChild(replyDiv);
            });
        }

        container.appendChild(commentDiv);
    });

    // 댓글 입력
    const inputRow = document.createElement('div');
    inputRow.className = 'slm-input-row';

    const input = document.createElement('input');
    input.className = 'slm-input';
    input.type = 'text';
    input.placeholder = '댓글 달기...';

    const submitBtn = document.createElement('button');
    submitBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    submitBtn.textContent = '달기';
    submitBtn.onclick = async () => {
        const text = input.value.trim();
        if (!text) return;

        submitBtn.disabled = true;
        try {
            await postComment(post, text, onUpdate);
            input.value = '';
        } finally {
            submitBtn.disabled = false;
        }
    };

    inputRow.appendChild(input);
    inputRow.appendChild(submitBtn);
    container.appendChild(inputRow);
}

/**
 * 댓글을 달고 NPC가 답글을 생성한다
 * @param {Object} post
 * @param {string} text
 * @param {Function} onUpdate
 */
async function postComment(post, text, onUpdate) {
    // 1. 유저 댓글 채팅에 삽입
    await slashSend(text);

    // 2. NPC 답글 생성
    try {
        // 생성 전 채팅 길이를 기록한다
        const beforeCtx = getContext();
        const chatLengthBefore = beforeCtx?.chat?.length ?? 0;

        await slashGen(
            `${post.authorName}의 SNS 게시물에 {{user}}가 댓글을 달았다: ${text}. ${post.authorName}이 짧게 답글을 달아라.`,
            post.authorName
        );

        // 생성 후 새로 추가된 AI 메시지를 답글로 사용한다
        const afterCtx = getContext();
        let replyText = '(답글)';
        if (afterCtx?.chat && afterCtx.chat.length > chatLengthBefore) {
            const newMsg = afterCtx.chat[afterCtx.chat.length - 1];
            if (newMsg && !newMsg.is_user) {
                replyText = newMsg.mes || replyText;
            }
        }

        const feed = loadFeed();
        const p = feed.find(p => p.id === post.id);
        if (p) {
            const commentId = crypto.randomUUID();
            p.comments.push({
                id: commentId,
                author: 'user',
                text,
                date: new Date().toISOString(),
                replies: [{
                    author: post.authorName,
                    text: replyText,
                    date: new Date().toISOString(),
                }],
            });
            saveFeed(feed);
        }
    } catch (e) {
        // 생성 실패 시 댓글만 저장
        const feed = loadFeed();
        const p = feed.find(p => p.id === post.id);
        if (p) {
            p.comments.push({
                id: crypto.randomUUID(),
                author: 'user',
                text,
                date: new Date().toISOString(),
                replies: [],
            });
            saveFeed(feed);
        }
    }

    onUpdate();
}

/**
 * 직접 게시물 작성 다이얼로그를 연다
 * @param {Function} onSave
 */
function openWritePostDialog(onSave) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';

    const contentLabel = document.createElement('label');
    contentLabel.className = 'slm-label';
    contentLabel.textContent = '글 내용';

    const contentInput = document.createElement('textarea');
    contentInput.className = 'slm-textarea';
    contentInput.rows = 4;
    contentInput.placeholder = '내용을 입력하세요...';

    const imgLabel = document.createElement('label');
    imgLabel.className = 'slm-label';
    imgLabel.textContent = '이미지 URL (선택)';

    const imgInput = document.createElement('input');
    imgInput.className = 'slm-input';
    imgInput.type = 'url';
    imgInput.placeholder = 'https://...';

    wrapper.appendChild(contentLabel);
    wrapper.appendChild(contentInput);
    wrapper.appendChild(imgLabel);
    wrapper.appendChild(imgInput);

    // footer 버튼 생성 후 createPopup에 전달
    const footer = document.createElement('div');
    footer.className = 'slm-panel-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'slm-btn slm-btn-secondary';
    cancelBtn.textContent = '취소';

    const postBtn = document.createElement('button');
    postBtn.className = 'slm-btn slm-btn-primary';
    postBtn.textContent = '올리기';

    footer.appendChild(cancelBtn);
    footer.appendChild(postBtn);

    const { close } = createPopup({
        id: 'write-post',
        title: '✏️ 게시물 작성',
        content: wrapper,
        footer,
        className: 'slm-sub-panel',
    });

    cancelBtn.onclick = () => close();

    postBtn.onclick = async () => {
        const text = contentInput.value.trim();
        if (!text) { showToast('내용을 입력해주세요.', 'warn'); return; }

        // 작성 시점에 신선한 컨텍스트를 가져온다
        const freshCtx = getContext();
        const feed = loadFeed();
        feed.push({
            id: crypto.randomUUID(),
            authorName: freshCtx?.name1 || 'user',
            authorIsUser: true,
            date: new Date().toISOString(),
            content: text,
            imageUrl: imgInput.value.trim(),
            likes: 0,
            likedByUser: false,
            comments: [],
            isStory: false,
            includeInContext: false,
        });
        saveFeed(feed);

        close();
        onSave();
        showToast('게시물 올리기 완료', 'success');
    };
}

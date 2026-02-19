/**
 * sns.js
 * SNS 피드 모듈 (인스타그램 스타일)
 * - 유저 직접 게시물 올리기 + 편집
 * - AI가 {{char}} 또는 NPC 이름으로 랜덤 포스팅 (유저 메시지 시 10% — index.js에서 트리거)
 * - 댓글/답글 기능
 * - SNS 활동은 채팅창에 노출되지 않음
 * - 컨텍스트에 최근 피드 주입
 */

import { getContext } from '../../../../../st-context.js';
import { loadData, saveData, getDefaultBinding } from '../../utils/storage.js';
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
    return loadData(MODULE_KEY, [], getDefaultBinding());
}

/**
 * SNS 피드 저장
 * @param {Object[]} feed
 */
function saveFeed(feed) {
    saveData(MODULE_KEY, feed, getDefaultBinding());
}

/**
 * SNS 모듈을 초기화한다
 */
export function initSns() {
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
    // 자동 포스팅 트리거는 index.js의 MESSAGE_SENT 이벤트에서 처리
}

/**
 * NPC 또는 {{char}} 랜덤 포스팅을 트리거한다
 * generateQuietPrompt를 사용하여 채팅창에 노출되지 않고 피드에만 저장한다
 */
export async function triggerNpcPosting() {
    const ctx = getContext();
    const charName = ctx?.name2 || '{{char}}';

    const contacts = getContacts(getDefaultBinding());
    const candidates = [
        { name: charName, personality: '', isChar: true },
        ...contacts.map(c => ({ name: c.name, personality: c.personality, isChar: false })),
    ];

    if (candidates.length === 0) return;

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const prompt = pick.isChar
        ? `${charName}이 SNS에 일상적인 게시물을 올렸다. 현재 상황과 ${charName}의 성격에 맞게 자연스럽고 솔직한 짧은 글을 작성하라. 해시태그는 달지 않는다.`
        : `${pick.name}이 SNS에 게시물을 올렸다. 성격: ${pick.personality || '보통'}. 그 캐릭터답게 자연스러운 짧은 글을 작성하라. 해시태그는 달지 않는다.`;

    try {
        const freshCtx = getContext();
        let postContent;
        try {
            postContent = await freshCtx.generateQuietPrompt({ quietPrompt: prompt, quietName: pick.name }) || '(게시물)';
        } catch (genErr) {
            console.error('[ST-LifeSim] NPC 포스팅 텍스트 생성 오류:', genErr);
            showToast('NPC 포스팅 생성 실패: ' + genErr.message, 'error');
            return;
        }

        const feed = loadFeed();
        feed.push({
            id: crypto.randomUUID(),
            authorName: pick.name,
            authorIsUser: false,
            date: new Date().toISOString(),
            content: postContent,
            imageUrl: '',
            likes: Math.floor(Math.random() * 30),
            likedByUser: false,
            comments: [],
            isStory: false,
            includeInContext: true,
        });
        saveFeed(feed);

        showToast(`📸 ${pick.name}님이 새 게시물을 올렸습니다.`, 'info', 2500);
    } catch (e) {
        console.error('[ST-LifeSim] NPC 포스팅 생성 오류:', e);
    }
}

/**
 * SNS 팝업을 연다
 */
export function openSnsPopup(onBack) {
    const content = buildSnsContent();
    createPopup({
        id: 'sns',
        title: '📸 SNS',
        content,
        className: 'slm-sns-panel',
        onBack,
    });
}

/**
 * SNS 팝업 내용을 빌드한다 (인스타그램 스타일)
 * @returns {HTMLElement}
 */
function buildSnsContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-sns-wrapper';

    // 인스타그램 스타일 헤더
    const header = document.createElement('div');
    header.className = 'slm-sns-header';

    const logo = document.createElement('span');
    logo.className = 'slm-sns-logo';
    logo.textContent = 'SNS';

    const headerBtns = document.createElement('div');
    headerBtns.style.cssText = 'display:flex;gap:6px';

    const writeBtn = document.createElement('button');
    writeBtn.className = 'slm-btn slm-btn-sm';
    writeBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:8px';
    writeBtn.textContent = '✏️ 작성';
    writeBtn.onclick = () => openWritePostDialog(renderFeed);

    const npcPostBtn = document.createElement('button');
    npcPostBtn.className = 'slm-btn slm-btn-sm';
    npcPostBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:8px';
    npcPostBtn.textContent = '🎲 NPC';
    npcPostBtn.onclick = async () => {
        npcPostBtn.disabled = true;
        try {
            await triggerNpcPosting();
            renderFeed();
        } finally {
            npcPostBtn.disabled = false;
        }
    };

    headerBtns.appendChild(writeBtn);
    headerBtns.appendChild(npcPostBtn);
    header.appendChild(logo);
    header.appendChild(headerBtns);
    wrapper.appendChild(header);

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
            const card = buildPostCard(post, renderFeed);
            feedList.appendChild(card);
        });
    }

    renderFeed();
    return wrapper;
}

/**
 * 인스타그램 스타일 게시물 카드를 빌드한다
 * @param {Object} post
 * @param {Function} onUpdate
 * @returns {HTMLElement}
 */
function buildPostCard(post, onUpdate) {
    const card = document.createElement('div');
    card.className = 'slm-post-card';

    const d = new Date(post.date);

    // 헤더 (아바타 + 이름 + 메뉴)
    const header = document.createElement('div');
    header.className = 'slm-post-header';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'slm-post-avatar';
    const avatarInner = document.createElement('div');
    avatarInner.className = 'slm-post-avatar-inner';
    avatarInner.textContent = ((post.authorName || '?')[0] || '?').toUpperCase();
    avatarWrap.appendChild(avatarInner);

    const authorEl = document.createElement('span');
    authorEl.className = 'slm-post-author';
    authorEl.textContent = post.authorName;

    const dateEl = document.createElement('span');
    dateEl.className = 'slm-post-date';
    dateEl.textContent = d.toLocaleDateString('ko-KR');

    const moreBtn = document.createElement('button');
    moreBtn.className = 'slm-post-more-btn';
    moreBtn.textContent = '···';
    moreBtn.onclick = (e) => showPostContextMenu(e, post, onUpdate);

    header.appendChild(avatarWrap);
    header.appendChild(authorEl);
    header.appendChild(dateEl);
    header.appendChild(moreBtn);
    card.appendChild(header);

    // 이미지
    if (post.imageUrl) {
        const img = document.createElement('img');
        img.className = 'slm-post-img';
        img.src = post.imageUrl;
        img.alt = '게시물 이미지';
        img.onerror = () => img.style.display = 'none';
        card.appendChild(img);
    }

    // 액션 버튼 행
    const actions = document.createElement('div');
    actions.className = 'slm-post-actions';

    const likeBtn = document.createElement('button');
    likeBtn.className = 'slm-post-action-btn' + (post.likedByUser ? ' liked' : '');
    likeBtn.textContent = post.likedByUser ? '❤️' : '🤍';
    likeBtn.onclick = () => {
        const f = loadFeed();
        const p = f.find(p => p.id === post.id);
        if (p) {
            p.likedByUser = !p.likedByUser;
            p.likes += p.likedByUser ? 1 : -1;
            saveFeed(f);
            onUpdate();
        }
    };

    const commentBtn = document.createElement('button');
    commentBtn.className = 'slm-post-action-btn';
    commentBtn.textContent = '💬';
    commentBtn.onclick = () => {
        const isHidden = commentSection.style.display === 'none';
        commentSection.style.display = isHidden ? 'block' : 'none';
    };

    const contextLabel = document.createElement('label');
    contextLabel.className = 'slm-context-toggle';
    const ctxCheck = document.createElement('input');
    ctxCheck.type = 'checkbox';
    ctxCheck.checked = post.includeInContext;
    ctxCheck.onchange = () => {
        const f = loadFeed();
        const p = f.find(p => p.id === post.id);
        if (p) { p.includeInContext = ctxCheck.checked; saveFeed(f); }
    };
    contextLabel.appendChild(ctxCheck);
    contextLabel.appendChild(document.createTextNode(' 컨텍스트'));

    actions.appendChild(likeBtn);
    actions.appendChild(commentBtn);
    actions.appendChild(contextLabel);
    card.appendChild(actions);

    // 좋아요 수
    if (post.likes > 0) {
        const likesEl = document.createElement('div');
        likesEl.className = 'slm-post-likes';
        likesEl.textContent = `좋아요 ${post.likes}개`;
        card.appendChild(likesEl);
    }

    // 본문
    const contentEl = document.createElement('div');
    contentEl.className = 'slm-post-content';
    const authorSpan = document.createElement('span');
    authorSpan.className = 'slm-post-content-author';
    authorSpan.textContent = post.authorName;
    contentEl.appendChild(authorSpan);
    contentEl.appendChild(document.createTextNode(post.content));
    card.appendChild(contentEl);

    // 댓글 수 표시
    if (post.comments.length > 0) {
        const commentsLink = document.createElement('button');
        commentsLink.className = 'slm-post-comments-link';
        commentsLink.textContent = `댓글 ${post.comments.length}개 모두 보기`;
        commentsLink.onclick = () => {
            commentSection.style.display = commentSection.style.display === 'none' ? 'block' : 'none';
        };
        card.appendChild(commentsLink);
    }

    // 댓글 섹션 (기본 닫힘)
    const commentSection = document.createElement('div');
    commentSection.className = 'slm-comment-section';
    commentSection.style.display = 'none';
    renderComments(commentSection, post, onUpdate);
    card.appendChild(commentSection);

    return card;
}

/**
 * 게시물 우클릭/더보기 메뉴
 */
function showPostContextMenu(e, post, onUpdate) {
    document.querySelectorAll('.slm-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'slm-context-menu';
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 160)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 100)}px`;

    const editItem = document.createElement('button');
    editItem.className = 'slm-context-item';
    editItem.textContent = '✏️ 편집';
    editItem.onclick = () => { menu.remove(); openEditPostDialog(post, onUpdate); };

    const delItem = document.createElement('button');
    delItem.className = 'slm-context-item slm-context-danger';
    delItem.textContent = '🗑️ 삭제';
    delItem.onclick = () => {
        const f = loadFeed().filter(p => p.id !== post.id);
        saveFeed(f);
        menu.remove();
        onUpdate();
        showToast('게시물 삭제', 'success', 1500);
    };

    menu.appendChild(editItem);
    menu.appendChild(delItem);
    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
}

/**
 * 게시물 편집 다이얼로그를 연다
 */
function openEditPostDialog(post, onUpdate) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';

    const contentLabel = document.createElement('label');
    contentLabel.className = 'slm-label';
    contentLabel.textContent = '글 내용';

    const contentInput = document.createElement('textarea');
    contentInput.className = 'slm-textarea';
    contentInput.rows = 4;
    contentInput.value = post.content;

    const imgLabel = document.createElement('label');
    imgLabel.className = 'slm-label';
    imgLabel.textContent = '이미지 URL (선택)';

    const imgInput = document.createElement('input');
    imgInput.className = 'slm-input';
    imgInput.type = 'url';
    imgInput.value = post.imageUrl || '';

    wrapper.appendChild(contentLabel);
    wrapper.appendChild(contentInput);
    wrapper.appendChild(imgLabel);
    wrapper.appendChild(imgInput);

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
        id: 'edit-post',
        title: '✏️ 게시물 편집',
        content: wrapper,
        footer,
        className: 'slm-sub-panel',
        onBack: () => openSnsPopup(),
    });

    cancelBtn.onclick = () => close();

    saveBtn.onclick = () => {
        const text = contentInput.value.trim();
        if (!text) { showToast('내용을 입력해주세요.', 'warn'); return; }

        const f = loadFeed();
        const p = f.find(p => p.id === post.id);
        if (p) {
            p.content = text;
            p.imageUrl = imgInput.value.trim();
            saveFeed(f);
        }
        close();
        onUpdate();
        showToast('게시물 편집 완료', 'success');
    };
}

/**
 * 댓글 영역을 렌더링한다
 */
function renderComments(container, post, onUpdate) {
    container.innerHTML = '';

    post.comments.forEach(c => {
        const commentDiv = document.createElement('div');
        commentDiv.className = 'slm-comment';
        const authorSpan = document.createElement('span');
        authorSpan.className = 'slm-comment-author';
        authorSpan.textContent = c.author;
        const textSpan = document.createElement('span');
        textSpan.className = 'slm-comment-text';
        textSpan.textContent = c.text;
        commentDiv.appendChild(authorSpan);
        commentDiv.appendChild(textSpan);

        if (c.replies && c.replies.length > 0) {
            c.replies.forEach(r => {
                const replyDiv = document.createElement('div');
                replyDiv.className = 'slm-reply';
                const replyAuthor = document.createElement('span');
                replyAuthor.className = 'slm-comment-author';
                replyAuthor.textContent = `└ ${r.author}`;
                const replyText = document.createElement('span');
                replyText.className = 'slm-comment-text';
                replyText.textContent = ` ${r.text}`;
                replyDiv.appendChild(replyAuthor);
                replyDiv.appendChild(replyText);
                commentDiv.appendChild(replyDiv);
            });
        }

        container.appendChild(commentDiv);
    });

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
 * 댓글을 달고 NPC가 답글을 생성한다 (채팅창에 노출 안 됨)
 */
async function postComment(post, text, onUpdate) {
    try {
        const ctx = getContext();
        const replyPrompt = `${post.authorName}의 SNS 게시물: "${post.content}". 이 게시물에 누군가 댓글을 달았다: "${text}". ${post.authorName}이 짧고 자연스럽게 답글을 달아라.`;
        let replyText = '';
        try {
            replyText = await ctx.generateQuietPrompt({ quietPrompt: replyPrompt, quietName: post.authorName }) || '';
        } catch (genErr) {
            console.error('[ST-LifeSim] 댓글 답글 생성 오류:', genErr);
            showToast('답글 생성 실패 (댓글만 저장됩니다)', 'warn', 2500);
        }

        const feed = loadFeed();
        const p = feed.find(p => p.id === post.id);
        if (p) {
            p.comments.push({
                id: crypto.randomUUID(),
                author: 'user',
                text,
                date: new Date().toISOString(),
                replies: replyText ? [{
                    author: post.authorName,
                    text: replyText,
                    date: new Date().toISOString(),
                }] : [],
            });
            saveFeed(feed);
        }
    } catch (e) {
        console.error('[ST-LifeSim] 댓글 저장 오류:', e);
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
        onBack: () => openSnsPopup(),
    });

    cancelBtn.onclick = () => close();

    postBtn.onclick = async () => {
        const text = contentInput.value.trim();
        if (!text) { showToast('내용을 입력해주세요.', 'warn'); return; }

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

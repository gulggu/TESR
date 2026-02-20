/**
 * sns.js
 * SNS 피드 모듈 (인스타그램 스타일)
 * - 유저 직접 게시물 올리기 + 편집
 * - AI가 {{char}} 또는 NPC 이름으로 랜덤 포스팅 (유저 메시지 시 10% — index.js에서 트리거)
 * - 댓글/답글 기능
 * - SNS 활동은 채팅창에 노출되지 않음
 * - 컨텍스트에 최근 피드 주입
 */

import { getContext } from '../../utils/st-context.js';
import { loadData, saveData, getDefaultBinding, getExtensionSettings } from '../../utils/storage.js';
import { registerContextBuilder } from '../../utils/context-inject.js';
import { showToast, generateId } from '../../utils/ui.js';
import { createPopup } from '../../utils/popup.js';
import { getContacts } from '../contacts/contacts.js';

const MODULE_KEY = 'sns-feed';
const AVATARS_KEY = 'sns-avatars';
const USER_IDS_KEY = 'sns-user-ids';      // { authorName: '@handle' }
const CONTACT_LINK_KEY = 'sns-contact-link'; // boolean: link avatars to contacts

/**
 * SNS 기본 이미지 URL을 가져온다
 * @returns {string}
 */
function getDefaultImageUrl() {
    const ext = getExtensionSettings();
    return ext?.['st-lifesim']?.defaultSnsImageUrl || '';
}

/**
 * SNS 유저 아이디(핸들) 목록을 불러온다
 * @returns {Object}
 */
function loadUserIds() {
    return loadData(USER_IDS_KEY, {}, getDefaultBinding());
}

/**
 * SNS 유저 아이디 목록을 저장한다
 * @param {Object} ids
 */
function saveUserIds(ids) {
    saveData(USER_IDS_KEY, ids, getDefaultBinding());
}

/**
 * 연락처 프로필 연동 토글 상태를 불러온다
 * @returns {boolean}
 */
function loadContactLink() {
    const val = loadData(CONTACT_LINK_KEY, true, getDefaultBinding());
    return val !== false;
}

/**
 * 연락처 프로필 연동 토글 상태를 저장한다
 * @param {boolean} val
 */
function saveContactLink(val) {
    saveData(CONTACT_LINK_KEY, val, getDefaultBinding());
}

/**
 * 저자 이름에 대한 아바타 URL을 해결한다 (연락처 연동 고려)
 * @param {string} authorName
 * @param {Object} avatars - 수동 아바타 맵
 * @returns {string}
 */
function resolveAvatar(authorName, avatars) {
    if (avatars[authorName]) return avatars[authorName];
    if (loadContactLink()) {
        const contacts = getContacts('chat');
        const contact = contacts.find(c => c.name === authorName);
        if (contact?.avatar) return contact.avatar;
    }
    return '';
}

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
 * SNS 작성자별 아바타(프로필 사진) 저장소 불러오기
 * @returns {Object} { [authorName]: avatarUrl }
 */
function loadAvatars() {
    return loadData(AVATARS_KEY, {}, getDefaultBinding());
}

/**
 * SNS 작성자별 아바타 저장
 * @param {Object} avatars
 */
function saveAvatars(avatars) {
    saveData(AVATARS_KEY, avatars, getDefaultBinding());
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
            return `• ${p.authorName}: "${p.content}" (${d.toLocaleDateString('en-US')})`;
        });
        return `=== Recent SNS Posts ===\n${lines.join('\n')}`;
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
        ? `${charName} is posting on social media. Write a short, natural, and authentic post that fits the current situation and ${charName}'s personality. Do not include hashtags.`
        : `${pick.name} is posting on social media. Personality: ${pick.personality || 'ordinary'}. Write a short, natural post that fits this character's personality. Do not include hashtags.`;

    try {
        const freshCtx = getContext();
        if (!freshCtx) return;
        let postContent;
        try {
            if (typeof freshCtx.generateQuietPrompt === 'function') {
                postContent = await freshCtx.generateQuietPrompt({ quietPrompt: prompt, quietName: pick.name }) || '(게시물)';
            } else {
                postContent = '(게시물)';
            }
        } catch (genErr) {
            console.error('[ST-LifeSim] NPC 포스팅 텍스트 생성 오류:', genErr);
            showToast('NPC 포스팅 생성 실패: ' + genErr.message, 'error');
            return;
        }

        const feed = loadFeed();
        const defaultImg = getDefaultImageUrl();
        feed.push({
            id: generateId(),
            authorName: pick.name,
            authorIsUser: false,
            date: new Date().toISOString(),
            content: postContent,
            imageUrl: defaultImg,
            imageDescription: '',
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

    const avatarBtn = document.createElement('button');
    avatarBtn.className = 'slm-btn slm-btn-sm';
    avatarBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:8px';
    avatarBtn.textContent = '⚙️ 프로필 설정';
    avatarBtn.onclick = () => openAvatarSettingsDialog(renderFeed);

    headerBtns.appendChild(writeBtn);
    headerBtns.appendChild(npcPostBtn);
    headerBtns.appendChild(avatarBtn);
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

    const avatars = loadAvatars();
    const avatarUrl = resolveAvatar(post.authorName, avatars);
    const userIds = loadUserIds();
    const displayId = userIds[post.authorName] ? userIds[post.authorName] : `@${post.authorName}`;

    // 헤더 (아바타 + 이름 + 메뉴) — 시간 제거
    const header = document.createElement('div');
    header.className = 'slm-post-header';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'slm-post-avatar';
    const avatarInner = document.createElement('div');
    avatarInner.className = 'slm-post-avatar-inner';
    if (avatarUrl) {
        const avatarImg = document.createElement('img');
        avatarImg.src = avatarUrl;
        avatarImg.alt = post.authorName;
        avatarImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
        avatarImg.onerror = () => {
            avatarInner.removeChild(avatarImg);
            avatarInner.textContent = ((post.authorName || '?')[0] || '?').toUpperCase();
        };
        avatarInner.appendChild(avatarImg);
    } else {
        avatarInner.textContent = ((post.authorName || '?')[0] || '?').toUpperCase();
    }
    avatarWrap.appendChild(avatarInner);

    const authorEl = document.createElement('span');
    authorEl.className = 'slm-post-author';
    authorEl.textContent = displayId;

    const moreBtn = document.createElement('button');
    moreBtn.className = 'slm-post-more-btn';
    moreBtn.textContent = '···';
    moreBtn.onclick = (e) => showPostContextMenu(e, post, onUpdate);

    header.appendChild(avatarWrap);
    header.appendChild(authorEl);
    header.appendChild(moreBtn);
    card.appendChild(header);

    // 이미지 (설명을 hover 툴팁으로)
    if (post.imageUrl) {
        const imgWrap = document.createElement('div');
        imgWrap.className = 'slm-post-img-wrap';

        const img = document.createElement('img');
        img.className = 'slm-post-img';
        img.src = post.imageUrl;
        img.alt = post.imageDescription || '게시물 이미지';
        img.onerror = () => imgWrap.style.display = 'none';
        imgWrap.appendChild(img);

        // 이미지 설명: hover 말풍선
        if (post.imageDescription) {
            const tooltip = document.createElement('div');
            tooltip.className = 'slm-img-tooltip';
            tooltip.textContent = post.imageDescription;
            imgWrap.appendChild(tooltip);
        }
        card.appendChild(imgWrap);
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
    authorSpan.textContent = displayId;
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

    const defaultImg = getDefaultImageUrl();
    const useDefaultLabel = document.createElement('label');
    useDefaultLabel.className = 'slm-toggle-label';
    useDefaultLabel.style.marginBottom = '4px';
    const useDefaultCheck = document.createElement('input');
    useDefaultCheck.type = 'checkbox';
    useDefaultCheck.checked = !post.imageUrl && !!defaultImg;
    useDefaultLabel.appendChild(useDefaultCheck);
    useDefaultLabel.appendChild(document.createTextNode(' 기본 이미지 사용'));

    const imgInput = document.createElement('input');
    imgInput.className = 'slm-input';
    imgInput.type = 'url';
    imgInput.value = post.imageUrl || '';
    imgInput.style.display = useDefaultCheck.checked ? 'none' : '';

    useDefaultCheck.onchange = () => {
        imgInput.style.display = useDefaultCheck.checked ? 'none' : '';
    };

    const imgDescLabel = document.createElement('label');
    imgDescLabel.className = 'slm-label';
    imgDescLabel.textContent = '사진 설명 (선택, 이미지 위에 마우스 호버 시 표시)';

    const imgDescInput = document.createElement('input');
    imgDescInput.className = 'slm-input';
    imgDescInput.type = 'text';
    imgDescInput.value = post.imageDescription || '';
    imgDescInput.placeholder = '이미지 설명...';

    wrapper.appendChild(contentLabel);
    wrapper.appendChild(contentInput);
    wrapper.appendChild(imgLabel);
    if (defaultImg) wrapper.appendChild(useDefaultLabel);
    wrapper.appendChild(imgInput);
    wrapper.appendChild(imgDescLabel);
    wrapper.appendChild(imgDescInput);

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
            p.imageUrl = useDefaultCheck.checked ? (getDefaultImageUrl() || '') : imgInput.value.trim();
            p.imageDescription = imgDescInput.value.trim();
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
        const replyPrompt = `${post.authorName}'s social media post: "${post.content}". Someone commented on this post: "${text}". Write a short, natural reply from ${post.authorName}.`;
        let replyText = '';
        try {
            if (ctx && typeof ctx.generateQuietPrompt === 'function') {
                replyText = await ctx.generateQuietPrompt({ quietPrompt: replyPrompt, quietName: post.authorName }) || '';
            }
        } catch (genErr) {
            console.error('[ST-LifeSim] 댓글 답글 생성 오류:', genErr);
            showToast('답글 생성 실패 (댓글만 저장됩니다)', 'warn', 2500);
        }

        const feed = loadFeed();
        const p = feed.find(p => p.id === post.id);
        if (p) {
            p.comments.push({
                id: generateId(),
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
                id: generateId(),
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

    const defaultImg = getDefaultImageUrl();
    const useDefaultLabel = document.createElement('label');
    useDefaultLabel.className = 'slm-toggle-label';
    useDefaultLabel.style.marginBottom = '4px';
    const useDefaultCheck = document.createElement('input');
    useDefaultCheck.type = 'checkbox';
    useDefaultCheck.checked = !!defaultImg;
    useDefaultLabel.appendChild(useDefaultCheck);
    useDefaultLabel.appendChild(document.createTextNode(' 기본 이미지 사용'));

    const imgInput = document.createElement('input');
    imgInput.className = 'slm-input';
    imgInput.type = 'url';
    imgInput.placeholder = 'https://...';
    imgInput.style.display = useDefaultCheck.checked ? 'none' : '';

    useDefaultCheck.onchange = () => {
        imgInput.style.display = useDefaultCheck.checked ? 'none' : '';
    };

    const imgDescLabel = document.createElement('label');
    imgDescLabel.className = 'slm-label';
    imgDescLabel.textContent = '사진 설명 (선택, 이미지 위에 마우스 호버 시 표시)';

    const imgDescInput = document.createElement('input');
    imgDescInput.className = 'slm-input';
    imgDescInput.type = 'text';
    imgDescInput.placeholder = '이미지 설명...';

    wrapper.appendChild(contentLabel);
    wrapper.appendChild(contentInput);
    wrapper.appendChild(imgLabel);
    if (defaultImg) wrapper.appendChild(useDefaultLabel);
    wrapper.appendChild(imgInput);
    wrapper.appendChild(imgDescLabel);
    wrapper.appendChild(imgDescInput);

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
        const finalImageUrl = useDefaultCheck.checked
            ? (getDefaultImageUrl() || '')
            : imgInput.value.trim();

        const feed = loadFeed();
        feed.push({
            id: generateId(),
            authorName: freshCtx?.name1 || 'user',
            authorIsUser: true,
            date: new Date().toISOString(),
            content: text,
            imageUrl: finalImageUrl,
            imageDescription: imgDescInput.value.trim(),
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

/**
 * SNS 프로필 설정 다이얼로그를 연다 (아바타 + 아이디 + 연락처 연동)
 * @param {Function} onUpdate
 */
function openAvatarSettingsDialog(onUpdate) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';

    // ─ 연락처 프로필 연동 토글 ─
    const linkRow = document.createElement('div');
    linkRow.className = 'slm-settings-row';
    const linkLabel = document.createElement('label');
    linkLabel.className = 'slm-toggle-label';
    const linkCheck = document.createElement('input');
    linkCheck.type = 'checkbox';
    linkCheck.checked = loadContactLink();
    linkCheck.onchange = () => {
        saveContactLink(linkCheck.checked);
        onUpdate();
    };
    linkLabel.appendChild(linkCheck);
    linkLabel.appendChild(document.createTextNode(' 연락처 프로필과 자동 연동'));
    linkRow.appendChild(linkLabel);
    wrapper.appendChild(linkRow);

    wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

    // ─ 아이디 설정 섹션 ─
    const idTitle = Object.assign(document.createElement('div'), { className: 'slm-label', textContent: '📛 아이디(@핸들) 설정' });
    idTitle.style.fontWeight = '600';
    wrapper.appendChild(idTitle);

    const userIds = loadUserIds();
    const avatars = loadAvatars();

    const idListDiv = document.createElement('div');
    wrapper.appendChild(idListDiv);

    function renderIdList() {
        idListDiv.innerHTML = '';
        const entries = Object.entries(userIds);
        if (entries.length === 0) {
            const empty = Object.assign(document.createElement('div'), { className: 'slm-empty', textContent: '등록된 아이디가 없습니다.' });
            empty.style.padding = '8px 0';
            idListDiv.appendChild(empty);
        }
        entries.forEach(([name, handle]) => {
            const row = document.createElement('div');
            row.className = 'slm-input-row';
            row.style.gap = '6px';
            const nameSpan = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: name });
            nameSpan.style.minWidth = '70px';
            const handleSpan = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: handle });
            handleSpan.style.cssText = 'flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            const delBtn = document.createElement('button');
            delBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
            delBtn.textContent = '삭제';
            delBtn.onclick = () => { delete userIds[name]; saveUserIds(userIds); renderIdList(); onUpdate(); };
            row.append(nameSpan, handleSpan, delBtn);
            idListDiv.appendChild(row);
        });
    }
    renderIdList();

    // 아이디 추가 폼
    const idAddRow = document.createElement('div');
    idAddRow.className = 'slm-input-row';
    idAddRow.style.marginTop = '6px';
    const idNameInput = Object.assign(document.createElement('input'), { className: 'slm-input', type: 'text', placeholder: '작성자 이름' });
    idNameInput.style.flex = '1';
    const idHandleInput = Object.assign(document.createElement('input'), { className: 'slm-input', type: 'text', placeholder: '@아이디' });
    idHandleInput.style.flex = '1';
    const idAddBtn = document.createElement('button');
    idAddBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    idAddBtn.textContent = '추가';
    idAddBtn.onclick = () => {
        const n = idNameInput.value.trim();
        let h = idHandleInput.value.trim();
        if (!n || !h) { showToast('이름과 아이디를 입력해주세요.', 'warn'); return; }
        if (!h.startsWith('@')) h = '@' + h;
        userIds[n] = h;
        saveUserIds(userIds);
        idNameInput.value = '';
        idHandleInput.value = '';
        renderIdList();
        onUpdate();
        showToast(`${n} 아이디 설정됨`, 'success', 1500);
    };
    idAddRow.append(idNameInput, idHandleInput, idAddBtn);
    wrapper.appendChild(idAddRow);

    wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));

    // ─ 프로필 사진 섹션 ─
    const avatarTitle = Object.assign(document.createElement('div'), { className: 'slm-label', textContent: '🖼️ 프로필 사진 URL 설정' });
    avatarTitle.style.fontWeight = '600';
    wrapper.appendChild(avatarTitle);

    // 연락처에서 자동 가져오기 버튼
    const syncBtn = document.createElement('button');
    syncBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    syncBtn.textContent = '🔄 연락처에서 자동 가져오기';
    syncBtn.style.marginBottom = '6px';
    syncBtn.onclick = () => {
        const contacts = getContacts('chat');
        let added = 0;
        contacts.forEach(c => {
            if (c.avatar && !avatars[c.name]) {
                avatars[c.name] = c.avatar;
                added++;
            }
        });
        saveAvatars(avatars);
        renderAvatarList();
        onUpdate();
        showToast(added > 0 ? `${added}명 프로필 사진 연동됨` : '새로 가져올 프로필 사진이 없습니다.', added > 0 ? 'success' : 'info', 2000);
    };
    wrapper.appendChild(syncBtn);

    const listDiv = document.createElement('div');
    wrapper.appendChild(listDiv);

    function renderAvatarList() {
        listDiv.innerHTML = '';
        const entries = Object.entries(avatars);
        if (entries.length === 0) {
            const empty = Object.assign(document.createElement('div'), { className: 'slm-empty', textContent: '등록된 프로필 사진이 없습니다.' });
            empty.style.padding = '8px 0';
            listDiv.appendChild(empty);
        }
        entries.forEach(([name, url]) => {
            const row = document.createElement('div');
            row.className = 'slm-input-row';
            row.style.gap = '6px';
            const nameSpan = Object.assign(document.createElement('span'), { className: 'slm-label', textContent: name });
            nameSpan.style.minWidth = '70px';
            const urlSpan = Object.assign(document.createElement('span'), { className: 'slm-label' });
            urlSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px';
            urlSpan.textContent = url;
            const delBtn = document.createElement('button');
            delBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
            delBtn.textContent = '삭제';
            delBtn.onclick = () => { delete avatars[name]; saveAvatars(avatars); renderAvatarList(); onUpdate(); };
            row.append(nameSpan, urlSpan, delBtn);
            listDiv.appendChild(row);
        });
    }
    renderAvatarList();

    // 추가 폼
    const addRow = document.createElement('div');
    addRow.className = 'slm-input-row';
    addRow.style.marginTop = '8px';
    const nameInput = Object.assign(document.createElement('input'), { className: 'slm-input', type: 'text', placeholder: '작성자 이름' });
    nameInput.style.flex = '1';
    const urlInput = Object.assign(document.createElement('input'), { className: 'slm-input', type: 'url', placeholder: '프로필 이미지 URL' });
    urlInput.style.flex = '2';
    const addBtn = document.createElement('button');
    addBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    addBtn.textContent = '추가';
    addBtn.onclick = () => {
        const n = nameInput.value.trim();
        const u = urlInput.value.trim();
        if (!n || !u) { showToast('이름과 URL을 모두 입력해주세요.', 'warn'); return; }
        avatars[n] = u;
        saveAvatars(avatars);
        nameInput.value = '';
        urlInput.value = '';
        renderAvatarList();
        onUpdate();
        showToast(`${n} 프로필 사진 설정됨`, 'success', 1500);
    };
    addRow.append(nameInput, urlInput, addBtn);
    wrapper.appendChild(addRow);

    createPopup({
        id: 'sns-avatars',
        title: '⚙️ SNS 프로필 설정',
        content: wrapper,
        className: 'slm-sub-panel',
        onBack: () => openSnsPopup(),
    });
}

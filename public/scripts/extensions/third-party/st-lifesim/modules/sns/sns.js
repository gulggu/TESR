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
const AUTHOR_DEFAULT_IMAGE_KEY = 'sns-author-default-images'; // { authorName: imageUrl }
const IMAGE_PRESETS_KEY = 'sns-image-presets'; // {id,name,url}[]
const POSTING_ENABLED_KEY = 'sns-posting-enabled'; // { authorName: boolean }

/**
 * 관리형 이미지 프리셋 목록을 불러온다
 * @returns {string[]}
 */
function loadImagePresets() {
    const raw = loadData(IMAGE_PRESETS_KEY, [], getDefaultBinding());
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item, i) => {
            if (typeof item === 'string') {
                return { id: `legacy-${i}`, name: `프리셋 ${i + 1}`, url: item };
            }
            if (item && typeof item === 'object' && typeof item.url === 'string') {
                return {
                    id: item.id || `preset-${i}`,
                    name: item.name || `프리셋 ${i + 1}`,
                    url: item.url,
                };
            }
            return null;
        })
        .filter(Boolean);
}

/**
 * 관리형 이미지 프리셋 목록을 저장한다
 * @param {string[]} presets
 */
function saveImagePresets(presets) {
    saveData(IMAGE_PRESETS_KEY, presets, getDefaultBinding());
}

function loadPostingEnabledMap() {
    return loadData(POSTING_ENABLED_KEY, {}, getDefaultBinding());
}

function savePostingEnabledMap(map) {
    saveData(POSTING_ENABLED_KEY, map, getDefaultBinding());
}

/**
 * SNS 기본 이미지 URL을 가져온다 (하위 호환용)
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

function loadAuthorDefaultImages() {
    return loadData(AUTHOR_DEFAULT_IMAGE_KEY, {}, getDefaultBinding());
}

function saveAuthorDefaultImages(map) {
    saveData(AUTHOR_DEFAULT_IMAGE_KEY, map, getDefaultBinding());
}

function getAuthorDefaultImageUrl(authorName) {
    const map = loadAuthorDefaultImages();
    return map[authorName] || getDefaultImageUrl();
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
    const userName = ctx?.name1 || 'user';
    const postingEnabled = loadPostingEnabledMap();

    const contacts = getContacts(getDefaultBinding());
    const candidates = [
        { name: charName, personality: '', isChar: true },
        ...contacts.map(c => ({ name: c.name, personality: c.personality, isChar: false })),
    ].filter(c => c.name !== userName && postingEnabled[c.name] !== false);

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
        const defaultImg = getAuthorDefaultImageUrl(pick.name);
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

    const defaultImg = getAuthorDefaultImageUrl(post.authorName);
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
            p.imageUrl = useDefaultCheck.checked ? (getAuthorDefaultImageUrl(post.authorName) || '') : imgInput.value.trim();
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

    const useDefaultLabel = document.createElement('label');
    useDefaultLabel.className = 'slm-toggle-label';
    useDefaultLabel.style.marginBottom = '4px';
    const useDefaultCheck = document.createElement('input');
    useDefaultCheck.type = 'checkbox';
    useDefaultCheck.checked = true;
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
    wrapper.appendChild(useDefaultLabel);
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
        const authorName = freshCtx?.name1 || 'user';
        const finalImageUrl = useDefaultCheck.checked
            ? (getAuthorDefaultImageUrl(authorName) || '')
            : imgInput.value.trim();

        const feed = loadFeed();
        feed.push({
            id: generateId(),
            authorName,
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

function openImagePresetManager(onChanged) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slm-form';
    const list = document.createElement('div');
    list.className = 'slm-form';
    wrapper.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.className = 'slm-btn slm-btn-primary slm-btn-sm';
    addBtn.textContent = '+ 프리셋 추가';
    addBtn.onclick = () => openPresetEditor(null, render);
    wrapper.appendChild(addBtn);

    function render() {
        list.innerHTML = '';
        const presets = loadImagePresets();
        if (presets.length === 0) {
            list.appendChild(Object.assign(document.createElement('div'), { className: 'slm-empty', textContent: '등록된 프리셋이 없습니다.' }));
            return;
        }
        presets.forEach((preset, i) => {
            const row = document.createElement('div');
            row.className = 'slm-input-row';
            const thumb = document.createElement('img');
            thumb.src = preset.url;
            thumb.alt = preset.name;
            thumb.className = 'slm-preview-img';
            const name = document.createElement('span');
            name.className = 'slm-label';
            name.textContent = preset.name;
            name.style.flex = '1';
            const editBtn = document.createElement('button');
            editBtn.className = 'slm-btn slm-btn-ghost slm-btn-sm';
            editBtn.textContent = '수정';
            editBtn.onclick = () => openPresetEditor({ ...preset, index: i }, render);
            const delBtn = document.createElement('button');
            delBtn.className = 'slm-btn slm-btn-danger slm-btn-sm';
            delBtn.textContent = '삭제';
            delBtn.onclick = () => {
                const all = loadImagePresets();
                all.splice(i, 1);
                saveImagePresets(all);
                render();
                onChanged?.();
            };
            row.append(thumb, name, editBtn, delBtn);
            list.appendChild(row);
        });
    }

    function openPresetEditor(preset, onDone) {
        const form = document.createElement('div');
        form.className = 'slm-form';
        const nameInput = document.createElement('input');
        nameInput.className = 'slm-input';
        nameInput.placeholder = '이름';
        nameInput.value = preset?.name || '';
        const urlInput = document.createElement('input');
        urlInput.className = 'slm-input';
        urlInput.type = 'url';
        urlInput.placeholder = '이미지 URL';
        urlInput.value = preset?.url || '';
        form.append(nameInput, urlInput);

        const footer = document.createElement('div');
        footer.className = 'slm-panel-footer';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'slm-btn slm-btn-primary';
        saveBtn.textContent = '저장';
        footer.appendChild(saveBtn);

        const { close } = createPopup({
            id: 'sns-preset-edit',
            title: preset ? '🛠️ 프리셋 수정' : '➕ 프리셋 추가',
            content: form,
            footer,
            className: 'slm-sub-panel',
        });
        saveBtn.onclick = () => {
            const name = nameInput.value.trim();
            const url = urlInput.value.trim();
            if (!name || !url) return;
            const all = loadImagePresets();
            const next = { id: preset?.id || generateId(), name, url };
            if (typeof preset?.index === 'number') all[preset.index] = next;
            else all.push(next);
            saveImagePresets(all);
            close();
            onDone();
            onChanged?.();
        };
    }

    render();
    createPopup({
        id: 'sns-preset-manager',
        title: '🖼️ SNS 이미지 프리셋',
        content: wrapper,
        className: 'slm-sub-panel',
    });
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

    // ─ 이미지 URL 프리셋 관리 ─
    const presetTitle = Object.assign(document.createElement('div'), {
        className: 'slm-label',
        textContent: '📎 기본 이미지 URL 프리셋',
    });
    presetTitle.style.fontWeight = '700';
    wrapper.appendChild(presetTitle);

    const presetDesc = Object.assign(document.createElement('div'), {
        className: 'slm-label',
        textContent: '등록된 URL을 각 캐릭터의 게시글 기본 이미지로 바인딩할 수 있습니다.',
    });
    presetDesc.style.fontSize = '12px';
    presetDesc.style.marginBottom = '6px';
    wrapper.appendChild(presetDesc);

    const presetManageBtn = document.createElement('button');
    presetManageBtn.className = 'slm-btn slm-btn-secondary slm-btn-sm';
    presetManageBtn.textContent = '🖼️ 프리셋 관리 열기';
    presetManageBtn.onclick = () => openImagePresetManager(() => renderContactList());
    wrapper.appendChild(presetManageBtn);

    wrapper.appendChild(Object.assign(document.createElement('hr'), { className: 'slm-hr' }));
    const desc = document.createElement('div');
    desc.className = 'slm-label';
    desc.textContent = '연락처에 등록된 인물을 SNS 프로필로 자동 동기화합니다. 이름을 눌러 세부 옵션을 설정하세요.';
    wrapper.appendChild(desc);

    const userIds = loadUserIds();
    const avatars = loadAvatars();
    const defaultImages = loadAuthorDefaultImages();
    const postingEnabled = loadPostingEnabledMap();
    const contacts = getContacts('chat');
    const userName = getContext()?.name1 || 'user';
    const allProfiles = [{ name: userName, avatar: avatars[userName] || '', personality: 'user' }, ...contacts]
        .filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i);

    allProfiles.forEach(c => {
        if (!userIds[c.name]) userIds[c.name] = '@' + c.name.replace(/\s+/g, '').toLowerCase();
        if (c.avatar && !avatars[c.name]) avatars[c.name] = c.avatar;
        if (c.name !== userName && postingEnabled[c.name] == null) postingEnabled[c.name] = true;
    });
    saveUserIds(userIds);
    saveAvatars(avatars);
    savePostingEnabledMap(postingEnabled);

    const contactList = document.createElement('div');
    contactList.className = 'slm-form';
    wrapper.appendChild(contactList);

    function renderContactList() {
        contactList.innerHTML = '';
        const presets = loadImagePresets();

        allProfiles.forEach(c => {
            const item = document.createElement('details');
            item.className = 'slm-settings-row slm-sns-profile-item';
            const summary = document.createElement('summary');
            summary.className = 'slm-sns-profile-summary';
            const avatarSpan = document.createElement('span');
            avatarSpan.className = 'slm-sns-profile-avatar';
            if (avatars[c.name]) {
                const img = document.createElement('img');
                img.src = avatars[c.name];
                img.alt = c.name;
                avatarSpan.appendChild(img);
            } else {
                avatarSpan.textContent = ((c.name || '?')[0] || '?').toUpperCase();
            }
            const nameSpan = document.createElement('span');
            nameSpan.textContent = c.name;
            summary.append(avatarSpan, nameSpan);
            item.appendChild(summary);

            const handleInput = document.createElement('input');
            handleInput.className = 'slm-input';
            handleInput.type = 'text';
            handleInput.placeholder = '@핸들';
            handleInput.value = userIds[c.name] || '';
            handleInput.onchange = () => {
                let val = handleInput.value.trim();
                if (val && !val.startsWith('@')) val = '@' + val;
                userIds[c.name] = val;
                saveUserIds(userIds);
                onUpdate();
            };

            const avatarInput = document.createElement('input');
            avatarInput.className = 'slm-input';
            avatarInput.type = 'url';
            avatarInput.placeholder = '프로필 이미지 URL';
            avatarInput.value = avatars[c.name] || '';
            avatarInput.onchange = () => {
                avatars[c.name] = avatarInput.value.trim();
                saveAvatars(avatars);
                onUpdate();
            };

            const presetSelect = document.createElement('select');
            presetSelect.className = 'slm-select';
            const noneOpt = document.createElement('option');
            noneOpt.value = '';
            noneOpt.textContent = '기본 이미지 미사용';
            presetSelect.appendChild(noneOpt);
            presets.forEach(preset => {
                const opt = document.createElement('option');
                opt.value = preset.url;
                opt.textContent = preset.name;
                presetSelect.appendChild(opt);
            });
            presetSelect.value = defaultImages[c.name] || '';
            presetSelect.onchange = () => {
                defaultImages[c.name] = presetSelect.value;
                saveAuthorDefaultImages(defaultImages);
            };

            const postToggle = document.createElement('label');
            postToggle.className = 'slm-toggle-label';
            const postCheck = document.createElement('input');
            postCheck.type = 'checkbox';
            postCheck.checked = postingEnabled[c.name] !== false;
            postCheck.onchange = () => {
                postingEnabled[c.name] = postCheck.checked;
                savePostingEnabledMap(postingEnabled);
            };
            postToggle.appendChild(postCheck);
            postToggle.appendChild(document.createTextNode(' 게시물 활성화'));

            item.appendChild(Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '아이디(@핸들)' }));
            item.appendChild(handleInput);
            item.appendChild(Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '프로필 이미지 URL' }));
            item.appendChild(avatarInput);
            item.appendChild(Object.assign(document.createElement('label'), { className: 'slm-label', textContent: '게시글 기본 이미지 프리셋' }));
            item.appendChild(presetSelect);
            if (c.name !== userName) item.appendChild(postToggle);
            contactList.appendChild(item);
        });
    }

    renderContactList();

    createPopup({
        id: 'sns-avatars',
        title: '⚙️ SNS 프로필 설정',
        content: wrapper,
        className: 'slm-sub-panel',
        onBack: () => openSnsPopup(),
    });
}

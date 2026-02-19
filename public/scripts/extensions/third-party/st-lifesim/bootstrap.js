/**
 * ST-LifeSim bootstrap
 * Script 태그 로더에서 [object Event] 로만 실패가 보이는 경우를 막기 위해
 * 실제 엔트리(index.js)를 동적으로 로드하고 오류를 명시적으로 기록한다.
 */
import('./index.js').catch((error) => {
    console.error('[ST-LifeSim] 부트스트랩 로드 오류:', error);
});

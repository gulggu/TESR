/**
 * ST-LifeSim bootstrap
 * 확장 엔트리(index.js)를 동적 import로 로드하여
 * 개별 모듈 실패가 전체 확장 로드를 차단하지 않도록 한다.
 * GitHub 링크 설치 시에도 안정적으로 동작한다.
 */
try {
    await import('./index.js');
} catch (e) {
    console.error('[ST-LifeSim] 확장 로드 실패:', e);
}

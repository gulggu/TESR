/**
 * ST-LifeSim bootstrap
 * 확장 엔트리(index.js)를 정적 import로 로드하여
 * SillyTavern 확장 로더가 의존 그래프를 올바르게 인식하도록 한다.
 * 정적 import를 사용하면 모듈 로드 실패 시 SillyTavern에 적절한 오류가 전달된다.
 */
import './index.js';

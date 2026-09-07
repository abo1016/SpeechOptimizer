/** 兼容旧测试/引用的薄适配层；新业务代码统一从 storage/index.js 进入。 */
export { assertAudioDeclaration, audioObjectKey } from "./storage/common.js";
export { R2AudioStorage } from "./storage/r2.js";

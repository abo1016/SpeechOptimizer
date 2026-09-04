/** 首屏无 Cookie 时先初始化匿名会话，再重试会话读取。 */
export async function loadSessionWithAnonymousFallback(resources) {
  try {
    return await resources.session();
  } catch (error) {
    if (error?.status !== 401 && error?.code !== "AUTHENTICATION_REQUIRED") throw error;
    await resources.ensureAnonymous();
    return resources.session();
  }
}

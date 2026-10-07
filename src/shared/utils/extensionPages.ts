/** 扩展内页面入口与 manifest 保持一致，避免各组件拼出不存在的路径。 */
export function getOptionsUrl(tab?: string): string {
  const url = chrome.runtime.getURL('src/options/index.html');
  return tab ? `${url}?tab=${encodeURIComponent(tab)}` : url;
}

export const HELP_URL = 'https://github.com/davisjiahao/notOnlyTranslator#readme';

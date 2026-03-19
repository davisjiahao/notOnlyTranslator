/**
 * CMP-83 内容脚本诊断脚本
 * 在浏览器控制台运行以检查扩展加载状态
 */

(function diagnose() {
  console.log('=== NotOnlyTranslator 诊断报告 ===');
  console.log('时间:', new Date().toISOString());
  console.log('URL:', location.href);
  console.log('UserAgent:', navigator.userAgent);
  
  // 检查1: data-extension-loaded 属性
  const hasDataAttr = document.body?.hasAttribute('data-extension-loaded');
  console.log('\n1. data-extension-loaded 属性:', hasDataAttr ? '✅ 已设置' : '❌ 未设置');
  
  // 检查2: window.__EXTENSION_LOADED__
  const hasWindowFlag = window.__EXTENSION_LOADED__ === true;
  console.log('2. window.__EXTENSION_LOADED__:', hasWindowFlag ? '✅ true' : '❌ 未设置');
  
  // 检查3: window.__NOT_ONLY_TRANSLATOR__
  const hasInstance = !!window.__NOT_ONLY_TRANSLATOR__;
  console.log('3. window.__NOT_ONLY_TRANSLATOR__:', hasInstance ? '✅ 存在' : '❌ 不存在');
  
  // 检查4: Chrome runtime
  const hasChromeRuntime = typeof chrome !== 'undefined' && !!chrome.runtime;
  console.log('4. Chrome Runtime:', hasChromeRuntime ? '✅ 可用' : '❌ 不可用');
  
  // 检查5: 内容脚本 loader 是否注入
  const scripts = Array.from(document.querySelectorAll('script'));
  const extensionScripts = scripts.filter(s => s.src.includes('chrome-extension://'));
  console.log('\n5. 扩展脚本数量:', extensionScripts.length);
  extensionScripts.forEach((s, i) => {
    console.log(`   [${i}] ${s.src.split('/').pop()}`);
  });
  
  // 检查6: 所有 script 标签
  console.log('\n6. 所有脚本来源:');
  scripts.slice(0, 10).forEach((s, i) => {
    const src = s.src || '(inline)';
    console.log(`   [${i}] ${src.substring(0, 80)}`);
  });
  
  // 综合诊断
  console.log('\n=== 诊断结论 ===');
  if (!hasDataAttr && !hasWindowFlag && extensionScripts.length === 0) {
    console.log('❌ 内容脚本未注入 - 检查 manifest 和 background script');
  } else if (extensionScripts.length > 0 && !hasDataAttr) {
    console.log('⚠️ 脚本已注入但初始化失败 - 检查控制台错误');
  } else if (hasDataAttr) {
    console.log('✅ 扩展已正确加载');
  }
  
  return {
    hasDataAttr,
    hasWindowFlag,
    hasInstance,
    hasChromeRuntime,
    extensionScripts: extensionScripts.map(s => s.src)
  };
})();

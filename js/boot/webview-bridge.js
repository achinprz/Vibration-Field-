/* VibeMon — html2app Flutter WebView detection (loaded as ES module) */

/* html2app Flutter WebView detection — sets window._h2a_isApp and window._h2a_InAppBrowser.
   Only active when running inside the html2app Android/iOS app.
   Has zero effect in normal desktop or mobile browsers. */
(async function(){
  try {
    const { WebView } = await import('https://cdn.jsdelivr.net/npm/@yandeu/js-bridge@latest/lib/index.js');
    const { InAppBrowser } = await import('https://cdn.jsdelivr.net/npm/@yandeu/js-bridge@latest/lib/plugins/inAppBrowser.js');
    const platform = await WebView.getPlatform();
    if (platform === 'android' || platform === 'ios') {
      window._h2a_isApp = true;
      window._h2a_InAppBrowser = InAppBrowser;
    }
  } catch(e) { /* not in WebView, or no internet — silently ignore */ }
})();

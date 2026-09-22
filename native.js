/* Native-shell glue: hides the launch splash once the page has painted.
   No-op on web (window.Capacitor is only present inside the Capacitor
   WebView). The native-app class itself is set synchronously in <head>,
   before this file loads, so CSS gated on it never flashes unstyled. */
(function () {
  'use strict';
  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  if (!isNative()) return;

  function hideSplash() {
    var SplashScreen = window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen;
    if (SplashScreen && SplashScreen.hide) SplashScreen.hide();
  }
  if (document.readyState === 'complete') hideSplash();
  else window.addEventListener('load', hideSplash);
})();

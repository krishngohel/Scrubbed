import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.getscrubbed.app',
  appName: 'Scrubbed',
  webDir: 'www',
  // Unlike a bundled SPA that only talks to an external API host, Scrubbed's
  // frontend calls its own same-origin backend (relative fetch('/auth/...')
  // etc). Bundling assets locally with a spoofed hostname (the Necto
  // approach) only renames the origin for the local asset handler — it
  // doesn't proxy same-origin fetches to the real network, so those calls
  // get intercepted locally and fail with "Unable to connect". Loading the
  // live URL directly means every request, assets and API alike, is a real
  // network round-trip to production.
  server: {
    url: 'https://getscrubbed.netlify.app',
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      // Not a timed splash: the shell keeps the launch image up until the
      // page has painted (native.js hides it), covering the black WebView
      // frame before first paint instead of a fixed delay.
      launchAutoHide: false,
      backgroundColor: '#F6F1E8',
      launchFadeOutDuration: 250,
    },
  },
};

export default config;

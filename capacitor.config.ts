import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.getscrubbed.app',
  appName: 'Scrubbed',
  webDir: 'www',
  // The WebView origin becomes https://getscrubbed.netlify.app so every
  // relative fetch('/auth/...'), Stripe checkout return URL, and Supabase
  // redirect matches production exactly. Assets still load from the bundle;
  // only the origin string changes.
  server: {
    hostname: 'getscrubbed.netlify.app',
    iosScheme: 'https',
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;

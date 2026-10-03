import type { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT: change appId to your own reverse-domain bundle ID before
// registering the app in App Store Connect. It must match exactly.
const config: CapacitorConfig = {
  appId: 'com.lasthaven.game',
  appName: 'Last Haven',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0d0f0c',
    scrollEnabled: false,
  },
  plugins: {
    StatusBar: { overlaysWebView: true, style: 'DARK' },
  },
};

export default config;

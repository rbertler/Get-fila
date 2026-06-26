import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'health.fila.app',
  appName: 'Fila',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;

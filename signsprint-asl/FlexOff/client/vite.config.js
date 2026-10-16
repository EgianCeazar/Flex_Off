import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', open: true, allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com', '.loca.lt'] }
});

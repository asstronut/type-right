import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  imports: false,
  manifest: {
    name: 'Type Right',
    description: 'As-you-type English error checker',
    host_permissions: ['https://api.languagetool.org/*'],
  },
});

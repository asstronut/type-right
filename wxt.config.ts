import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  imports: false,
  manifest: {
    name: 'Type Right',
    description: 'As-you-type English error checker',
    permissions: ['storage'],
    host_permissions: ['https://api.languagetool.org/*', 'https://api.z.ai/*'],
    // Granted at runtime when the user points Type Right at another LanguageTool server.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});

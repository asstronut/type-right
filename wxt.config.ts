import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  imports: false,
  manifest: {
    name: 'Type Right',
    description: 'As-you-type English error checker',
    permissions: ['storage', 'scripting'],
    // The content script runs everywhere anyway; this lets it be injected into tabs open at install and reach any LanguageTool server.
    host_permissions: ['<all_urls>'],
  },
});

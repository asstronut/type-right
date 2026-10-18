// PROTOTYPE (#57), throwaway. Lets the page import the real lib/slip-tracker.ts from the repo root,
// without the root tsconfig (it extends .wxt/tsconfig.json, which only exists after `wxt prepare`).
export default { server: { fs: { allow: ['../..'] } }, esbuild: { tsconfigRaw: '{}' } };

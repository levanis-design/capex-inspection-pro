const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  eslintConfigPrettier,
  {
    // supabase/functions/** is Deno code (Supabase Edge Functions), a
    // separate runtime from this Expo/RN project -- it uses Deno's
    // globals and remote https:// imports that this project's
    // TypeScript/ESLint config has no business understanding. See
    // tsconfig.json's matching exclude.
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'android/*', 'ios/*', 'supabase/functions/**'],
  },
]);

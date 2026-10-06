import globals from 'globals';
const rules={
 'no-dupe-args':'error','no-dupe-keys':'error','no-dupe-class-members':'error',
 'no-unreachable':'error','no-global-assign':'error','no-undef':'error',
};
export default [
 {ignores:['node_modules/**','dist/**','public/vendor/**','public/vendor-*.js']},
 {files:['public/**/*.js'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.worker}},rules},
 {files:['scripts/**/*.mjs','eslint.config.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.node},rules},
 {files:['scripts/probe-*.mjs','scripts/check-layout.mjs','scripts/smoke-*.mjs','scripts/verify-login-coffee.mjs','scripts/verify-local-first-browser.mjs'],languageOptions:{globals:{...globals.node,...globals.browser}},rules},
];

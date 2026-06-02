export default {
  plugins: ['prettier-plugin-svelte'],
  printWidth: 100,
  singleQuote: true,
  semi: true,
  trailingComma: 'none',
  overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }]
};

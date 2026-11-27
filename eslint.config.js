// @ts-check
/**
 * ESLint do front-end (doc 01 §15): typescript-eslint strict com tipos + angular-eslint (TS e templates, com a11y).
 * O que o código existente ainda não cumpre está congelado em `eslint-suppressions.json` (supressões em massa do
 * ESLint): código novo segue as regras inteiras; a dívida só pode diminuir (`npm run lint:prune` ao corrigir).
 */
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '.angular/**', 'server/**', 'scripts/**', 'eslint.config.js'] },
  {
    files: ['src/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.strictTypeChecked, ...angular.configs.tsRecommended],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: __dirname } },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
      // console.log proibido (doc 01 §14); erros que não têm a quem avisar ainda vão ao console (issue F14)
      'no-console': ['error', { allow: ['error', 'warn'] }],
      // Falso positivo com as configs do Material (MatSnackBarConfig/MatDialogConfig recebem objetos literais)
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      // Números e booleanos em template string são legíveis e seguros
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      // `() => signal.set(x)` em callbacks é o estilo do projeto
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true, ignoreVoidOperator: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);

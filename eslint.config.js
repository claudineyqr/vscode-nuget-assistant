import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { configs as _configs, createProcessor } from 'angular-eslint';
import { configs as __configs } from 'typescript-eslint';

const { configs } = eslint;

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [configs.recommended, ...__configs.recommended, ..._configs.tsRecommended],
    processor: createProcessor(),
    rules: {
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-inject': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [..._configs.templateRecommended],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'off',
    },
  }
);

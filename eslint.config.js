import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'simulator/**/*', 'firmware/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];

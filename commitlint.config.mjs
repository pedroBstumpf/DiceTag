/**
 * Conventional Commits (doc 05 §5). Descrição em pt-BR, começando em minúscula: `feat(mesa): adicionar portas`.
 * Começar com nome próprio ou tecla (`OnPush`, `Ctrl+Z`) é permitido: por isso a regra de caixa só avisa.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [1, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 120],
  },
};

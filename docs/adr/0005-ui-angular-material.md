# ADR-0005: Angular Material + CDK como biblioteca de UI; budgets maiores

- **Status:** Aceito
- **Data:** 2026-11-27
- **Decisores:** @pedroBstumpf

## Contexto

O doc 01 §9 pede uma única biblioteca de UI registrada em ADR e recomenda headless + Tailwind. As diretrizes do dono
(`CLAUDE.md` §2) fixam **Angular + Tailwind + Angular Material**. O doc 01 §1 pede budgets de 400kB/600kB.

## Decisão

- **Angular Material 21 (tema M3 escuro) + CDK** é a biblioteca de UI. Nenhuma outra biblioteca completa entra.
  Tailwind cuida de layout e tokens; Material dos controles (diálogos, menus, tooltips, campos).
- **Budgets:** inicial 850kB aviso / 1.5MB erro. Hoje o inicial está em ~676kB (Material + Tiptap + mapa em SVG/canvas).
  Meta: baixar o aviso para 750kB depois do upgrade para o Angular 22 e de servir as fontes localmente.

## Consequências

- Componentes acessíveis prontos (foco, teclado, ARIA) com tema "grimório" por overrides em `styles.scss`.
- Bundle maior que o de referência; qualquer import pesado fora de rota lazy é recusado no review.

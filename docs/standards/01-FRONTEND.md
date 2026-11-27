# 01 · Boas Práticas de Front-end — Angular + Tailwind

> Padrão de arquitetura, código e UI para aplicações Angular modernas (standalone, signals, zoneless) estilizadas com Tailwind CSS v4.
> Relacionados: [Segurança/Testes](./04-SECURITY-TESTING-QA.md) · [Versionamento](./05-VERSIONING-WORKFLOW.md) · [Back-end](./02-BACKEND.md)

---

## 1. Setup inicial

Node LTS ativo (22+) fixado em `.nvmrc`; Tailwind v4 configurado em CSS (sem `tailwind.config.js`).

### Configurações obrigatórias

**`tsconfig.json`** — DEVE conter:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "@core/*": ["src/app/core/*"],
      "@shared/*": ["src/app/shared/*"],
      "@features/*": ["src/app/features/*"],
      "@env": ["src/environments/environment"]
    }
  },
  "angularCompilerOptions": {
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true,
    "extendedDiagnostics": { "defaultCategory": "error" }
  }
}
```

**`angular.json`** — budgets de bundle DEVEM existir e quebrar o build:

```jsonc
"budgets": [
  { "type": "initial", "maximumWarning": "400kB", "maximumError": "600kB" },
  { "type": "anyComponentStyle", "maximumWarning": "4kB", "maximumError": "8kB" }
]
```

**`app.config.ts`** — base recomendada: `provideBrowserGlobalErrorListeners()`, `provideZonelessChangeDetection()`,
`provideRouter(routes, withComponentInputBinding(), withViewTransitions(), withInMemoryScrolling(...))`,
`provideHttpClient(withFetch(), withInterceptors([...]))` e `{ provide: ErrorHandler, useClass: GlobalErrorHandler }`.

---

## 2. Arquitetura e estrutura de pastas

Arquitetura **feature-based** (vertical slices) com camadas internas leves.

```
src/app/
├── core/       # singleton, sem UI de feature: auth, http, error-handling, layout, config, services
├── shared/     # reutilizável e "burro": ui, directives, pipes, utils, validators, models
├── features/<feature>/
│   ├── data-access/   # *.api.ts (HTTP), *.store.ts (estado), *.models.ts
│   ├── feature/       # páginas/containers (smart)
│   ├── ui/            # componentes de apresentação (dumb)
│   ├── utils/
│   └── <feature>.routes.ts
├── app.config.ts · app.routes.ts · app.ts
```

| Tipo | Responsabilidade | Pode injetar |
|------|------------------|--------------|
| **Page / Container** | Orquestra: lê rota, chama store, passa dados para UI | Store, Router |
| **UI / Presentational** | Só renderiza `input()` e emite `output()` | Nada (no máximo utilitários de UI) |
| **Store** | Estado da feature com signals | API service |
| **API service** | HTTP puro, mapeia DTO ↔ modelo | `HttpClient` |
| **Core service** | Transversal (auth, logger, theme) | Qualquer core |

---

## 3. Regras de dependência entre camadas

```
features/*  ──►  shared/*  ──►  (nada de app)
     └──────►  core/*
core/*      ──►  shared/*
shared/*    ✗   NÃO importa core nem features
features/a  ✗   NÃO importa features/b diretamente
```

- Imports DEVEM usar os aliases (`@core/...`, `@shared/...`), nunca `../../../`.
- As regras DEVERIAM ser verificadas automaticamente (`eslint-plugin-boundaries`, ou Nx).
- Código comum a duas features sobe para `shared/` (genérico) ou `core/` (transversal com estado).

---

## 4. Componentes

- DEVEM ser **standalone** (não declare `standalone: true`).
- DEVEM usar `ChangeDetectionStrategy.OnPush`.
- DEVEM usar `input()`, `input.required()`, `output()`, `model()`, `viewChild()`, `contentChildren()`.
- DEVEM usar `inject()` em vez de injeção via construtor.
- DEVEM usar control flow nativo: `@if`, `@for` (com `track` significativo), `@switch`, `@defer`, `@let`.
- NÃO DEVEM usar `ngClass`/`ngStyle` nem `@HostBinding`/`@HostListener` (use `host: {}`).
- Template > ~80 linhas ou classe > ~200 linhas → quebrar.
- Um componente = uma responsabilidade; lógica de negócio no store/service.
- Membros usados só no template DEVEM ser `protected`; imutáveis DEVEM ser `readonly`.
- Templates com mais de ~15 linhas DEVERIAM ir para `.html`. Estilos de componente DEVERIAM ser raros.

---

## 5. Signals, estado e reatividade

| Situação | Use |
|----------|-----|
| Estado local síncrono | `signal()` |
| Valor derivado | `computed()` — NUNCA `effect()` para derivar estado |
| Derivado que pode ser sobrescrito | `linkedSignal()` |
| Dados assíncronos | `resource()` / `httpResource()` / `rxResource()` |
| Efeitos colaterais | `effect()` — com moderação |
| Fluxos de eventos complexos | RxJS → `toSignal()` na borda |

- Signals DEVEM ser atualizados de forma **imutável** com `.set()`/`.update()`.
- Signals graváveis DEVEM ser privados no store e expostos com `asReadonly()`/`computed()`.
- `subscribe()` manual em componentes NÃO DEVERIA existir; se inevitável, `takeUntilDestroyed()`.
- Signals + services é o padrão; NgRx SignalStore para estado complexo; NgRx clássico só com ADR.

---

## 6. Comunicação HTTP e dados

- Todo acesso HTTP DEVE passar por uma classe `*Api`. Componentes NUNCA injetam `HttpClient`.
- URLs base DEVEM vir de token de DI/ambiente.
- **DTO ≠ Modelo**: mapear e validar respostas críticas em runtime (zod/valibot).
- Tipos de contrato DEVERIAM ser **gerados do OpenAPI**.
- Interceptors funcionais em `core/http/`: `auth` (só para a própria API), `error` (normaliza para `ApiError`
  RFC 9457, trata 401/403), `retry` (só GET idempotente, backoff), `loading` (opcional).

---

## 7. Formulários

- Projetos novos DEVERIAM usar **Signal Forms**; legado, **Reactive Forms tipados**; `ngModel` só para o trivial.
- Validação DEVE existir no front (UX) **e** no back (segurança).
- Erros ao perder o foco ou ao submeter, e somem quando corrigidos.
- Todo campo DEVE ter `<label>` visível; placeholder é só dica.
- Submit DEVE ficar desabilitado durante o envio, com estado de carregamento.
- Formulários longos DEVERIAM salvar rascunho e alertar ao sair com alterações.

---

## 8. Roteamento

- Toda feature DEVE ser **lazy loaded**; guards e resolvers DEVEM ser **funcionais**.
- Parâmetros de rota DEVEM ser lidos via `input()` com `withComponentInputBinding()`.
- Estado que sobrevive a refresh (filtros, página, aba) DEVE ficar na **URL**.
- Guards de front são **UX**, não segurança — o back DEVE validar toda requisição.
- DEVE existir rota `**` (404) e página de erro genérica.
- Títulos de página DEVEM ser definidos.

---

## 9. Tailwind CSS e design system

- Toda cor, fonte, raio, sombra e espaçamento customizado DEVE ser um **token semântico** em `@theme`.
- `@apply` APENAS para primitivas do design system (`.btn`, `.input`).
- Valores arbitrários (`w-[437px]`, `bg-[#123]`) NÃO DEVERIAM existir; valor repetido vira token.
- Componentes de UI em `shared/ui/` encapsulam variações.
- Classes DEVEM ser estáticas e completas no código, nunca concatenadas.
- Ordem de classes DEVE ser automatizada com `prettier-plugin-tailwindcss`.
- **Mobile-first**, testar de 360px a 1440px+; container queries para componentes.
- Espaçamento na escala de 4px; respeitar `motion-reduce:`; animar só `opacity` e `transform` (150–300ms).
- Escolha UMA biblioteca de componentes e registre em ADR; NÃO misture duas bibliotecas completas.

---

## 10. Acessibilidade (a11y)

Meta mínima: **WCAG 2.2 nível AA**.

- HTML semântico primeiro; NUNCA `<div (click)>`.
- Toda interação DEVE funcionar só com teclado; foco DEVE ser visível; ordem lógica.
- Modais/drawers DEVEM prender o foco e devolvê-lo ao fechar.
- Contraste 4.5:1 (texto) e 3:1 (texto grande e UI).
- `alt` descritivo; decorativas com `alt=""`. Ícones sem texto DEVEM ter `aria-label` e tooltip.
- Mudanças dinâmicas importantes anunciadas com `aria-live`.
- Alvos de toque ≥ 24×24px (ideal 44×44px).
- Ferramentas: regras a11y do `@angular-eslint/template`, `axe-core` nos E2E, Lighthouse no CI.

---

## 11. Performance

Metas (p75): LCP < 2.5s · INP < 200ms · CLS < 0.1 · bundle inicial gzip < 200kB (referência).

- Zoneless + OnPush + signals; lazy loading; `@defer (on viewport)` para blocos pesados.
- `NgOptimizedImage` (`ngSrc`) para TODAS as imagens.
- `@for` com `track` por id estável; virtual scroll para listas > 200 itens.
- Evitar métodos no template; usar `computed()` ou pipes puros.
- Debounce em buscas (300ms) e cancelamento de requisições obsoletas.
- Fontes com `font-display: swap`, subset e preload.
- Analisar bundle a cada release; evitar bibliotecas pesadas.

---

## 12. Internacionalização (i18n)

- Todo texto visível DEVE ser preparado para tradução desde o início (`@angular/localize` ou Transloco, em ADR).
- Datas, números e moedas SEMPRE via pipes/`Intl`.
- Datas trafegam em **UTC ISO-8601**; conversão só na exibição.

---

## 13. Tratamento de erros e UX de falhas

- `GlobalErrorHandler` DEVE capturar erros não tratados e enviá-los ao monitoramento **sem dados pessoais**.
- Toda tela que carrega dados DEVE tratar: **carregando**, **vazio**, **erro** (com "tentar novamente") e **sucesso**.
- Loading: nada abaixo de ~100ms; spinner até ~1s; skeleton acima.
- Mensagens humanas, sem culpar o usuário, com próximo passo; nunca stack trace.
- Ações destrutivas DEVEM pedir confirmação nomeando o item ou oferecer "desfazer".
- Atualizações otimistas DEVEM reverter em caso de erro e avisar.

---

## 14. Nomenclatura e estilo de código

Seguir o [Angular Style Guide](https://angular.dev/style-guide).

| Item | Convenção |
|------|-----------|
| Arquivos | `kebab-case` |
| Componentes | `PascalCase`, sem sufixo obrigatório |
| Seletores | prefixo do app + kebab |
| Serviços | `PascalCase` + papel (`OrdersApi`, `OrdersStore`) |
| Signals | substantivo; booleanos com `is/has/can` |
| Outputs | verbo/evento, sem prefixo `on` |
| Constantes e tokens de DI | `UPPER_SNAKE_CASE` |
| Interfaces/types | `PascalCase`, sem prefixo `I` |
| Testes | `.spec.ts` ao lado do arquivo |

- Proibido `any` (use `unknown`) e `@ts-ignore` (use `@ts-expect-error` com comentário).
- Preferir `readonly`, `const` e unions de literais a enums.
- Funções < 30 linhas, early return, aninhamento ≤ 3.
- Comentários explicam **por quê**. Código morto é apagado.
- `console.log` proibido em produção — usar `LoggerService`.

---

## 15. Tooling: lint, format, hooks

| Ferramenta | Uso |
|------------|-----|
| `angular-eslint` + `typescript-eslint` (strict-type-checked) | Lint de TS e templates |
| `eslint-plugin-boundaries` / Nx | Fronteiras de camadas |
| Prettier + `prettier-plugin-tailwindcss` | Formatação e ordem de classes |
| `husky` + `lint-staged` | Pre-commit: lint + format nos arquivos alterados |
| `commitlint` | Valida Conventional Commits |
| Vitest | Testes unitários/componente |
| Playwright | E2E e testes visuais |
| `knip` | Código, exports e dependências não usados |

Scripts mínimos: `start`, `build`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:ci`
(`--watch=false --coverage`), `e2e`, `audit` (`npm audit --audit-level=high`), `prepare` (`husky`).

**`.editorconfig`** DEVE existir (UTF-8, LF, 2 espaços, newline final).

---

## 16. Anti-padrões proibidos

| ❌ Não faça | ✅ Faça |
|------------|--------|
| `NgModule` em código novo | Componentes standalone |
| `@Input()`/`@Output()` em código novo | `input()`, `output()`, `model()` |
| `*ngIf`, `*ngFor` | `@if`, `@for` com `track` |
| `subscribe()` sem cleanup | `toSignal`, `resource`, `async`, `takeUntilDestroyed` |
| `effect()` para copiar signal | `computed()` / `linkedSignal()` |
| `HttpClient` em componente | Classe `*Api` + store |
| `innerHTML` com conteúdo do usuário / `bypassSecurityTrust*` | Interpolação; sanitização explícita |
| Token JWT em `localStorage` | Cookie `HttpOnly; Secure; SameSite` ou BFF |
| Lógica de negócio no template | `computed()` |
| `bg-[#3b82f6]` espalhado | Token `bg-primary` |
| Classes Tailwind concatenadas | Strings completas mapeadas |
| `div` clicável | `button` |
| `setTimeout` para "esperar o Angular" | Signals, `afterNextRender` |
| `any`, `!` gratuito | Tipos corretos e narrowing |

---

## 17. Checklist de PR (front)

- [ ] Componentes OnPush, standalone, `input()/output()`, `inject()`
- [ ] Nenhum `any`, `console.log`, código comentado ou TODO sem issue vinculada
- [ ] Estados de loading/vazio/erro tratados
- [ ] Responsivo (360px → desktop) e dark mode verificados
- [ ] Navegação por teclado e foco visível; labels e `alt` presentes
- [ ] Sem valores arbitrários de Tailwind que deveriam ser tokens
- [ ] Textos prontos para i18n; datas/moedas via `Intl`/pipes
- [ ] Testes unitários das regras (store/utils) e do componente alterado
- [ ] Budgets de bundle respeitados; imagens com `ngSrc`
- [ ] Nenhum dado sensível em logs, URL, localStorage ou mensagens de erro

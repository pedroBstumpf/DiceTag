#!/usr/bin/env bash
# Configura o repositório no GitHub conforme docs/standards/05-VERSIONING-WORKFLOW.md §3 e §10.
#
# Uso (Git Bash ou WSL, com o GitHub CLI logado como dono do repositório: `gh auth login`):
#   scripts/github-setup.sh labels      # cria/atualiza as labels padrão
#   scripts/github-setup.sh repo        # squash only, apagar branch após merge, segurança
#   scripts/github-setup.sh ruleset     # protege a main (rode DEPOIS de mesclar os PRs de CI, senão os checks não existem)
#   scripts/github-setup.sh issues      # cria as issues do backlog da auditoria (docs/audit/)
#   scripts/github-setup.sh branches    # LISTA branches remotas já mescladas ou paradas há > 14 dias (não apaga)
#   scripts/github-setup.sh all         # labels + repo + issues (o ruleset fica à parte, de propósito)
#
# Idempotente: rodar de novo atualiza em vez de duplicar (exceto issues, que conferem o título antes).
set -euo pipefail

REPO="${REPO:-pedroBstumpf/DiceTag}"

label() { # nome cor descrição
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null
  echo "label: $1"
}

labels() {
  for t in feature:a2eeef bug:d73a4a chore:cfd3d7 docs:0075ca refactor:fbca04 test:bfd4f2 debt:e99695 security:b60205 perf:5319e7; do
    label "type:${t%%:*}" "${t##*:}" "Tipo: ${t%%:*}"
  done
  for a in front back db infra design ci; do label "area:$a" "c5def5" "Área: $a"; done
  label "priority:P0" "b60205" "Crítico: mesa fora / perda de dados"
  label "priority:P1" "d93f0b" "Alta"
  label "priority:P2" "fbca04" "Média"
  label "priority:P3" "0e8a16" "Baixa"
  label "status:blocked" "000000" "Impedimento externo"
  label "status:needs-info" "d876e3" "Falta informação"
  label "status:needs-design" "f9d0c4" "Falta definir a interface"
  label "breaking-change" "b60205" "Quebra de compatibilidade"
  label "good-first-issue" "7057ff" "Boa para começar"
  label "dependencies" "0366d6" "Atualização de dependências"
  label "scope:standards" "5319e7" "Mudança nos padrões base"
}

repo() {
  gh api -X PATCH "repos/$REPO" \
    -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
    -F delete_branch_on_merge=true -F allow_update_branch=true -F has_wiki=false >/dev/null
  echo "repo: squash only, apagar branch após merge, wiki desligada"
  gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null && echo "segurança: Dependabot alerts"
  gh api -X PUT "repos/$REPO/automated-security-fixes" >/dev/null && echo "segurança: Dependabot security updates"
  gh api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null && echo "segurança: private vulnerability reporting"
  gh api -X PATCH "repos/$REPO" --input - >/dev/null <<'JSON' && echo "segurança: secret scanning + push protection"
{ "security_and_analysis": { "secret_scanning": { "status": "enabled" }, "secret_scanning_push_protection": { "status": "enabled" } } }
JSON
  gh api -X PUT "repos/$REPO/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
  echo "actions: GITHUB_TOKEN somente leitura por padrão"
}

ruleset() {
  # Projeto solo: a aprovação obrigatória fica em 0 (o autor não pode aprovar o próprio PR), mas o PR continua
  # obrigatório, com checks verdes, conversas resolvidas e histórico linear. Com um segundo mantenedor, suba para 1.
  local id
  id=$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="main") | .id' || true)
  local method=POST path="repos/$REPO/rulesets"
  [[ -n "$id" ]] && method=PUT path="repos/$REPO/rulesets/$id"
  gh api -X "$method" "$path" --input - >/dev/null <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Front-end (build e testes)" },
          { "context": "Servidor (tipos, testes e audit)" },
          { "context": "Qualidade (lint)" },
          { "context": "CodeQL" },
          { "context": "Gitleaks" },
          { "context": "Título do PR" } ] } }
  ]
}
JSON
  echo "ruleset: main protegida"
  gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null 2>&1 <<'JSON' && echo "ruleset: tags v* protegidas" || echo "ruleset: tags v* já existem"
{ "name": "tags", "target": "tag", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ] }
JSON
}

issue() { # título labels corpo
  if gh issue list --repo "$REPO" --state all --search "in:title \"$1\"" --json title --jq '.[].title' | grep -Fxq "$1"; then
    echo "issue já existe: $1"; return
  fi
  gh issue create --repo "$REPO" --title "$1" --label "$2" --body "$3" >/dev/null
  echo "issue: $1"
}

issues() {
  local a="Item da [auditoria](docs/audit/2026-11-27-auditoria-padroes.md)"
  issue "Atualizar para Angular 22 e TypeScript 6" "type:chore,area:front,priority:P1" "$a **F1**. \`ng update\` depois de reforçar os testes; conferir budgets e o check-deps."
  issue "MFA (TOTP) para a conta do dono" "type:security,area:back,priority:P1" "$a **B11** / ADR-0004. Obrigatório com o túnel aberto. Exige modelagem de ameaças."
  issue "Senha mínima de 12 caracteres para o dono" "type:security,area:back,priority:P2" "$a **B10** / ADR-0004."
  issue "Evento de auditoria para falha de login" "type:security,area:back,priority:P2" "$a **B14**. Sem e-mail nem nome digitado no evento: só IP e motivo."
  issue "Servir as fontes localmente (sem Google Fonts)" "type:security,area:front,priority:P2" "$a **S3**. Tira o IP dos jogadores do Google e permite apertar a CSP."
  issue "CSP: remover unsafe-inline de style-src e ligar Trusted Types" "type:security,area:front,priority:P2" "$a **S3**."
  issue "Erros da API no formato RFC 9457" "type:refactor,area:back,priority:P2" "$a **B4** / ADR-0002. Manter o campo \`error\` para compatibilidade."
  issue "Especificação OpenAPI da API" "type:docs,area:back,priority:P3" "$a **B6** / ADR-0002."
  issue "Health check ready com o banco" "type:chore,area:back,priority:P3" "$a **B15**."
  issue "Página 404 no lugar do redirecionamento" "type:feature,area:front,priority:P2" "$a **F17**."
  issue "Versão do app visível na interface" "type:feature,area:front,priority:P3" "$a **F30**."
  issue "GlobalErrorHandler gravando no log do servidor" "type:feature,area:front,priority:P2" "$a **F14**. Sem dados pessoais."
  issue "Aliases de import (@core, @shared, @features)" "type:refactor,area:front,priority:P3" "$a **F5**. 243 imports com ../../../; codemod + regra no check-deps."
  issue "Ligar noUncheckedIndexedAccess e exactOptionalPropertyTypes" "type:debt,area:front,priority:P3" "$a **F3**. Um por vez."
  issue "prettier-plugin-tailwindcss (só formatação)" "type:chore,area:front,priority:P3" "$a **F19**. PR só de formatação."
  issue "Expurgo de convites vencidos e retenção de logs" "type:chore,area:db,priority:P3" "$a **D11** e **D7**/**D5** (updated_at em game_tables, sem SELECT t.*)."
  issue "E2E no CI com Playwright e axe" "type:test,area:ci,priority:P2" "$a **S20**/**F21**."
  issue "Testes de componente (Testing Library)" "type:test,area:front,priority:P3" "$a **S19**."
  issue "OWASP ZAP baseline antes de cada release" "type:security,area:ci,priority:P3" "$a **S17**. Ver docs/runbooks/mesa-online.md."
  issue "release-please e CHANGELOG gerado" "type:chore,area:ci,priority:P3" "$a **V13** / ADR-0006."
  issue "Escolher a licença do repositório público" "type:docs,priority:P3" "$a **V14**. Sem LICENSE, ninguém pode reutilizar o código legalmente."
}

branches() {
  git fetch --prune origin >/dev/null 2>&1
  local limit; limit=$(date -d '14 days ago' +%s 2>/dev/null || date -v-14d +%s)
  echo "Branches remotas para revisar (mescladas na main ou sem commits há > 14 dias):"
  git for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/remotes/origin | while read -r ref ts; do
    [[ "$ref" == origin/main || "$ref" == origin/HEAD || "$ref" == origin ]] && continue
    local why=""
    git merge-base --is-ancestor "$ref" origin/main && why="mesclada"
    (( ts < limit )) && why="${why:+$why, }parada"
    [[ -n "$why" ]] && echo "  ${ref#origin/} ($why)  →  git push origin --delete ${ref#origin/}"
  done
}

case "${1:-}" in
  labels) labels ;;
  repo) repo ;;
  ruleset) ruleset ;;
  issues) issues ;;
  branches) branches ;;
  all) labels; repo; issues ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac

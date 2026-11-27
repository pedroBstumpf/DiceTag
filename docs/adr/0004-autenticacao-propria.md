# ADR-0004: Autenticação própria (convite + senha + cookie) no lugar de OIDC

- **Status:** Aceito
- **Data:** 2026-11-27
- **Decisores:** @pedroBstumpf

## Contexto

O doc 02 §8 diz que NÃO se deve implementar autenticação do zero e pede um provedor OIDC. O app é só por convite:
um dono (o Mestre) e convidados que entram com o nome e uma senha, de qualquer aparelho, sem e-mail.

## Opções consideradas

1. **Provedor OIDC (Auth0, Keycloak, Supabase Auth…)** — depende de serviço externo (ou de um Keycloak no Windows),
   obriga os jogadores a ter conta nele e conflita com "entrar só com o nome da mesa".
2. **Autenticação própria mínima e revisada** — já implementada no estilo BFF que o doc 04 §4 recomenda como opção 1
   (sessão no servidor, cookie `__Host-` HttpOnly/Secure/SameSite=Strict, o token nunca chega ao JavaScript). Escolhida.

## Decisão

Mantém a autenticação própria, com estes controles obrigatórios (já presentes): hash scrypt com pimenta; convites e
links com 192 bits, uso único, só o hash no banco; recuperação de senha em 30 minutos; throttle por IP e por conta;
mensagens genéricas; sessão regenerada no login; logout invalida no servidor; auditoria.

Pendências para fechar a distância do padrão:

- **MFA (TOTP) para o dono** — obrigatório pelo doc 04 §4 para administradores. Backlog B11, prioridade alta.
- Senha mínima de 8 caracteres (padrão pede 12). Manter 8 para convidados e subir o **dono** para 12 (B10).
- scrypt é aceito pela OWASP; não migrar para argon2id sem outro motivo.

## Consequências

- Sem dependência externa nem conta de terceiros para os jogadores.
- O código de autenticação é responsabilidade do projeto: toda mudança em `server/src/security/` e
  `http/plugins/auth.ts` exige revisão pelo CODEOWNERS e testes de 401/403.

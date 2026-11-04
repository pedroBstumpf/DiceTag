import type { Config } from '../config/env';

/** E-mail a enviar (sempre texto puro: nada vindo do usuário vira HTML). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Envio de e-mails (hoje, só o link de recuperação de senha). Implementações escolhidas por
 * `MAIL_PROVIDER`; os testes trocam por uma que só guarda as mensagens.
 */
export interface Mailer {
  /** false = o servidor não envia e-mails: a recuperação de senha fica por `npm run reset-link`. */
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Sem envio (padrão). */
const NO_MAIL: Mailer = { enabled: false, send: async () => undefined };

/**
 * Só desenvolvimento: escreve a mensagem no terminal do servidor. O texto leva o link de
 * recuperação, então o servidor se recusa a subir com isto em produção (`config/env.ts`).
 */
const TERMINAL_MAIL: Mailer = {
  enabled: true,
  send: async ({ to, subject, text }) => {
    console.info(`\n--- E-mail (MAIL_PROVIDER=log) ---\nPara: ${to}\nAssunto: ${subject}\n\n${text}\n---------------------------------\n`);
  },
};

/** Tempo máximo esperando o serviço de e-mail. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Envio pela API HTTP do Resend (https://resend.com/docs/api-reference/emails/send-email), com o
 * `fetch` do próprio Node, sem pacote novo. A chave fica só no servidor (`MAIL_API_KEY`).
 */
function resendMailer(apiKey: string, from: string): Mailer {
  return {
    enabled: true,
    send: async ({ to, subject, text }) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      // Só o código: a resposta poderia repetir o conteúdo da mensagem (com o link) no log
      if (!res.ok) throw new Error(`serviço de e-mail respondeu ${res.status}`);
    },
  };
}

export function createMailer(config: Config): Mailer {
  switch (config.MAIL_PROVIDER) {
    case 'log':
      return TERMINAL_MAIL;
    case 'resend':
      return resendMailer(config.MAIL_API_KEY, config.MAIL_FROM);
    default:
      return NO_MAIL;
  }
}

/** E-mail de recuperação de senha. */
export function passwordResetMail(to: string, name: string, link: string, minutes: number): MailMessage {
  return {
    to,
    subject: 'Crônicas de Zehenia: redefinir a senha',
    text: [
      `Olá, ${name}.`,
      '',
      'Recebemos um pedido para redefinir a senha da sua conta. Para criar uma senha nova, abra este link:',
      '',
      link,
      '',
      `O link vale por ${minutes} minutos e só pode ser usado uma vez.`,
      'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
    ].join('\n'),
  };
}

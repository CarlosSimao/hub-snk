/**
 * Como o hub verifica cada check, em português, a partir da propria config.
 *
 * O texto e gerado do YAML e nao escrito a mao no `description` porque a explicacao
 * precisa refletir o que o hub REALMENTE faz. Um `description` desatualizado mente em
 * silencio; aqui, mudar o `expectStatus` muda a frase junto.
 *
 * REGRA INEGOCIAVEL: nada de segredo entra nestas linhas. O texto vai para o navegador
 * pela API, entao `password`, `token` e `connectString` (que pode carregar a senha)
 * ficam de fora — o que aparece e o host, nunca a credencial.
 */
import type { CheckConfig } from '../config.ts';

/** Milissegundos em formato curto: 30000 -> "30s", 900000 -> "15min". */
function duracao(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}min`;
}

/** O que conta como resposta boa num check HTTP. */
function statusEsperado(expectStatus: number[]): string {
  if (!expectStatus.length) return 'Saudável com qualquer status 2xx ou 3xx.';
  if (expectStatus.length === 1) return `Saudável só com HTTP ${expectStatus[0]}.`;
  return `Saudável com HTTP ${expectStatus.join(' ou ')}.`;
}

/** As linhas especificas do tipo — o "o que este check faz". */
function linhasDoTipo(cfg: CheckConfig): string[] {
  switch (cfg.type) {
    case 'http':
      return [
        `Faz uma requisição ${cfg.method} em ${cfg.url}.`,
        statusEsperado(cfg.expectStatus),
        ...(cfg.expectBodyContains
          ? [`O corpo da resposta precisa conter "${cfg.expectBodyContains}".`]
          : []),
        'Segue redirecionamentos e avalia o destino final.',
      ];

    case 'tcp':
      return [
        `Abre uma conexão TCP em ${cfg.host}:${cfg.port}.`,
        'Verifica só se a porta aceita conexão — não fala nenhum protocolo em cima disso.',
        'Porta aberta não garante que a aplicação por trás esteja funcionando.',
      ];

    case 'oracle':
      return [
        cfg.connectString
          ? 'Conecta no Oracle pelo descritor configurado.'
          : `Conecta no listener Oracle em ${cfg.host}:${cfg.port} (${cfg.sid ? `SID ${cfg.sid}` : `serviço ${cfg.serviceName}`}), como "${cfg.user}".`,
        'Driver em Thin mode: protocolo TNS em JavaScript puro, sem Oracle Instant Client.',
        'Lê `v$instance` para saber se o banco está OPEN e ativo, além de sessões, uptime e versão.',
        'Instância MOUNTED (de pé, mas com o banco não aberto) fica AMARELA — um check de porta mostraria verde.',
        `Fica amarelo quando as sessões passam de ${cfg.sessionsWarnPct}% do limite.`,
        'Sem permissão nas views v$, cai para `SELECT 1 FROM dual`: perde os indicadores e continua verde.',
      ];

    case 'docker':
      return [
        `Consulta a Docker Engine API sobre o container "${cfg.container}".`,
        'Lê estado (running/exited), uptime, contagem de restarts e o healthcheck do próprio container.',
        'Sem acesso ao socket do Docker, reporta indisponível (cinza), não vermelho.',
      ];
  }
}

/** As linhas comuns a todo check — o "quando e com que tolerância". */
function linhasDeCadencia(cfg: CheckConfig): string[] {
  const linhas = [
    `Roda a cada ${duracao(cfg.intervalMs)}, com timeout de ${duracao(cfg.timeoutMs)}.`,
  ];

  linhas.push(
    cfg.failureThreshold === 1
      ? 'A primeira falha já acende o vermelho.'
      : `Uma falha isolada mostra AMARELO; só depois de ${cfg.failureThreshold} falhas seguidas fica vermelho.`,
  );

  if ('degradedAboveMs' in cfg && cfg.degradedAboveMs !== undefined) {
    linhas.push(`Resposta acima de ${cfg.degradedAboveMs}ms conta como degradada (amarelo).`);
  }

  if (cfg.muted) {
    linhas.push('Silenciado: continua sendo medido, mas não entra no semáforo do projeto.');
  }

  return linhas;
}

/**
 * Explicacao completa do check, pronta para a tela.
 *
 * Vai no snapshot da API, entao roda a cada delta do SSE — por isso e so montagem de
 * string, sem I/O.
 */
export function explicarCheck(cfg: CheckConfig): string[] {
  return [...linhasDoTipo(cfg), ...linhasDeCadencia(cfg)];
}

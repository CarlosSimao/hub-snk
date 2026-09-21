/**
 * Controle e log do WildFly — Fase 3 da migracao "sem Docker".
 *
 * Substitui os dois helpers PowerShell de uma vez: `wildfly-helper.ps1` (porta 4100,
 * start/stop/restart) e `wildfly-log-helper.ps1` (porta 4101, o `server.log` ao vivo).
 * Os dois escutavam em TODAS as interfaces da maquina, SEM autenticacao; estas rotas
 * vivem no backend, que so' atende em `127.0.0.1` quando nativo.
 *
 * O visualizador de log tambem ganha uma coisa que o helper nao tinha: la' o listener
 * era single-threaded, entao um popup aberto travava qualquer acao de iniciar/parar ate'
 * a aba fechar. Aqui cada conexao e' independente.
 */
import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Wildfly, type OperacaoWildfly } from './wildfly.ts';

const OPERACOES: OperacaoWildfly[] = ['iniciar', 'parar', 'reiniciar'];

/** Quantas linhas mandar assim que o visualizador conecta, antes de seguir o arquivo. */
const LINHAS_INICIAIS = 200;
const INTERVALO_POLL_MS = 500;

/**
 * Pagina autonoma, como a que o helper servia: o log abre numa janela propria e nao
 * depende do bundle do painel.
 */
const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>server.log — WildFly</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b1120; color: #cbd5e1; font: 12px/1.5 ui-monospace, monospace; }
  header { position: sticky; top: 0; padding: 8px 12px; background: #111827; border-bottom: 1px solid #1f2937; display: flex; align-items: center; gap: 10px; }
  header b { color: #e2e8f0; }
  #estado { font-size: 11px; color: #64748b; }
  #log { margin: 0; padding: 12px; white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>
<header><b>server.log</b><span id="estado">conectando…</span></header>
<pre id="log"></pre>
<script>
  var logEl = document.getElementById('log');
  var estadoEl = document.getElementById('estado');
  var es = new EventSource('/api/wildfly/log/stream');
  es.onopen = function () { estadoEl.textContent = 'ao vivo'; };
  es.onerror = function () { estadoEl.textContent = 'reconectando…'; };
  es.onmessage = function (event) {
    logEl.textContent += event.data + '\\n';
    window.scrollTo(0, document.body.scrollHeight);
  };
</script>
</body>
</html>`;

/** Le so' o fim do arquivo: o `server.log` de um WildFly rodando ha' dias passa de 100 MB. */
function lerUltimasLinhas(caminho: string, quantidade: number): Promise<{ texto: string; tamanho: number }> {
  const tamanho = statSync(caminho).size;
  // 400 bytes por linha e' folgado para o formato do WildFly; ler demais so' custa I/O.
  const inicio = Math.max(0, tamanho - quantidade * 400);

  return new Promise((resolve, reject) => {
    let dados = '';
    createReadStream(caminho, { start: inicio, encoding: 'utf8' })
      .on('data', (pedaco) => (dados += pedaco))
      .on('error', reject)
      .on('end', () => {
        const linhas = dados.split(/\r?\n/);
        // A primeira linha quase sempre esta' cortada ao meio pelo `start` arbitrario.
        if (inicio > 0) linhas.shift();
        resolve({ texto: linhas.slice(-quantidade).join('\n'), tamanho });
      });
  });
}

function lerTrecho(caminho: string, de: number, ate: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let dados = '';
    createReadStream(caminho, { start: de, end: ate - 1, encoding: 'utf8' })
      .on('data', (pedaco) => (dados += pedaco))
      .on('error', reject)
      .on('end', () => resolve(dados));
  });
}

export function registerRoutesWildfly(app: FastifyInstance, wildfly: Wildfly): void {
  app.get('/api/wildfly/status', async () => wildfly.status());

  app.post<{ Params: { operacao: string } }>('/api/wildfly/:operacao', async (request, reply) => {
    const { operacao } = request.params;
    if (!OPERACOES.includes(operacao as OperacaoWildfly)) {
      return reply.code(404).send({ ok: false, mensagem: `operação "${operacao}" não existe` });
    }

    const resultado = await wildfly.executar(operacao as OperacaoWildfly);
    return reply.code(resultado.ok ? 200 : 500).send(resultado);
  });

  app.get('/api/wildfly/log', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(PAGINA);
  });

  app.get('/api/wildfly/log/stream', async (request, reply) => {
    const caminho = wildfly.arquivoLog();

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const enviar = (texto: string) => {
      if (reply.raw.writableEnded) return;
      // Cada linha vira seu proprio `data:` — quebra de linha crua encerraria o evento.
      for (const linha of texto.split(/\r?\n/)) reply.raw.write(`data: ${linha}\n`);
      reply.raw.write('\n');
    };

    if (!existsSync(caminho)) {
      enviar(`(não achei o log em ${caminho} — confira a pasta do WildFly na aba Infra)`);
      reply.raw.end();
      return reply;
    }

    let posicao = 0;
    try {
      const inicial = await lerUltimasLinhas(caminho, LINHAS_INICIAIS);
      posicao = inicial.tamanho;
      enviar(inicial.texto);
    } catch (err) {
      enviar(`(falha lendo ${caminho}: ${(err as Error).message})`);
    }

    // Polling de tamanho em vez de `fs.watch`: no Windows o watch nao dispara de forma
    // confiavel para arquivo que outro processo mantem aberto em append, que e'
    // exatamente o caso do `server.log`.
    const timer = setInterval(() => {
      void (async () => {
        try {
          const { size } = statSync(caminho);
          // Encolheu: rotacao de log. Recomeca do inicio do arquivo novo.
          if (size < posicao) posicao = 0;
          if (size === posicao) return;
          const trecho = await lerTrecho(caminho, posicao, size);
          posicao = size;
          if (trecho) enviar(trecho.replace(/\r?\n$/, ''));
        } catch {
          // Arquivo sumiu no meio da rotacao: o proximo tick reencontra.
        }
      })();
    }, INTERVALO_POLL_MS);
    timer.unref();

    const encerrar = () => clearInterval(timer);
    request.raw.on('close', encerrar);
    request.raw.on('error', encerrar);

    return reply;
  });
}

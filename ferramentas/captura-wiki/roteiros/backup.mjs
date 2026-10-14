/**
 * Prints da página Backup e Google Drive da wiki (`site/wiki/backup.html`).
 *
 * Nada aqui fala com o Google nem grava backup de verdade: toda rota de `/api/drive` e
 * `/api/backup`, e o seletor de pasta do sistema, respondem pela simulação abaixo, no
 * formato das rotas reais (`src/rotas/rotasDrive.ts`, `src/rotas/rotasBackup.ts`). A tela
 * do Google, o seletor de pasta e o de arquivo são telas de fora e ficam sem print.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HORA_MS = 3_600_000;
const PASTA_DO_BACKUP = 'D:\\Backups\\HUB SNK';
const CONTA = 'ana.souza@consultoria.example';
const ERRO_DO_BACKUP = 'o disco D: não está conectado.';

/** A notificação que uma falha do backup automático deixa no sino. */
export function semear(pastaDeDados) {
  const agora = new Date().toISOString();
  writeFileSync(
    join(pastaDeDados, 'notificacoes.json'),
    JSON.stringify(
      {
        versaoDoEsquema: 1,
        notificacoes: {
          lista: [
            {
              id: '6f1c2a54-3b7d-4e8f-9a10-2c3d4e5f6a7b',
              origem: 'sistema',
              tag: 'padrão',
              chave: `backup-local-falhou:${agora.slice(0, 10)}`,
              titulo: 'O backup dos dados não foi feito',
              mensagem: ERRO_DO_BACKUP,
              criadaEm: agora,
              lida: false,
              erroDoEmail: '',
            },
          ],
          chavesEmitidas: {},
        },
      },
      null,
      2,
    ),
  );
}

function criarSimulacao() {
  const agora = Date.now();
  const desconectado = {
    configurado: true,
    cofreDisponivel: true,
    conectado: false,
    email: '',
    podeGuardarCopia: false,
    autorizando: false,
    erro: '',
  };
  const estado = {
    drive: { ...desconectado },
    backup: {
      configuracao: {
        ativo: false,
        pasta: '',
        intervaloHoras: 24,
        copiasMantidas: 10,
        espelharNoDrive: false,
      },
      local: { ultimoEm: '', arquivo: '', erro: '' },
      drive: { ultimoEm: '', erro: '', nomeDoArquivo: 'hub-snk-dados-NOTEBOOK-ANA.zip' },
      restauracaoPendente: null,
    },
  };
  const copias = [
    {
      id: '1hUbSnKnOtEbOoKaNa0001',
      nome: 'hub-snk-dados-NOTEBOOK-ANA.zip',
      tamanho: 486_312,
      modificadoEm: new Date(agora - 2 * HORA_MS).toISOString(),
    },
    {
      id: '1hUbSnKeScRiToRiO00002',
      nome: 'hub-snk-dados-ESCRITORIO.zip',
      tamanho: 471_905,
      modificadoEm: new Date(agora - 3 * 24 * HORA_MS).toISOString(),
    },
  ];

  /** Responde como a rota real responderia, sem tocar em disco, cofre ou Google. */
  function responder(metodo, caminho, corpo) {
    const agoraIso = new Date().toISOString();
    if (caminho === '/api/sistema/selecionar-pasta') return { caminho: PASTA_DO_BACKUP };
    if (caminho === '/api/drive/conectar') {
      estado.drive.autorizando = true;
      return { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=hub-snk.example' };
    }
    if (caminho === '/api/drive') {
      if (metodo === 'DELETE') estado.drive = { ...desconectado };
      return estado.drive;
    }
    if (caminho === '/api/backup/configuracao') {
      estado.backup.configuracao = { ...estado.backup.configuracao, ...corpo };
    }
    if (caminho === '/api/backup/local') {
      estado.backup.local = {
        ultimoEm: agoraIso,
        arquivo: `${PASTA_DO_BACKUP}\\hub-snk-backup.zip`,
        erro: '',
      };
    }
    if (caminho === '/api/backup/drive' && metodo === 'POST') {
      estado.backup.drive = { ...estado.backup.drive, ultimoEm: agoraIso, erro: '' };
    }
    if (caminho === '/api/backup/drive/copias') return { copias };
    if (caminho === '/api/backup/restauracao') {
      estado.backup.restauracaoPendente =
        metodo === 'POST' ? { geradoEm: copias[0].modificadoEm } : null;
    }
    if (caminho === '/api/backup/reiniciar') return { ok: true };
    return estado.backup;
  }

  return { estado, responder };
}

export async function roteiro({ painel, print }) {
  const simulacao = criarSimulacao();
  const rotasSimuladas = (endereco) =>
    /^\/api\/(drive|backup)(\/|$)|^\/api\/sistema\/selecionar-pasta$/.test(endereco.pathname);
  await painel.route(rotasSimuladas, (rota) => {
    const requisicao = rota.request();
    const caminho = new URL(requisicao.url()).pathname;
    const corpo = requisicao.postDataJSON?.() ?? null;
    rota.fulfill({ json: simulacao.responder(requisicao.method(), caminho, corpo) });
  });

  const corpoDoBackup = painel.locator('#corpo-backup');
  const cartao = (titulo) =>
    corpoDoBackup
      .locator('.cartao-credencial')
      .filter({ has: painel.getByRole('heading', { name: titulo, exact: true }) });
  const botao = (rotulo) => corpoDoBackup.getByRole('button', { name: rotulo, exact: true });
  const caixa = (texto) => corpoDoBackup.locator('label.campo-checkbox', { hasText: texto });
  const esperarAviso = (texto) => painel.locator('.aviso', { hasText: texto }).waitFor();
  const fecharAvisos = () => painel.waitForTimeout(4300);
  const abrirAbaBackup = async () => {
    await painel.click('#aba-configuracao-geral');
    await painel.click('#aba-configuracao-backup');
    await cartao('Restaurar').waitFor();
  };

  await painel.click('#btn-configuracao');
  await abrirAbaBackup();

  // Conectar ao Google Drive
  await print('conectar-01-botao', {
    destacando: ['#aba-configuracao-backup', botao('Conectar ao Google Drive')],
  });
  await botao('Conectar ao Google Drive').click();
  await botao('Copiar o link').waitFor();
  await print('conectar-02-aguardando', {
    destacando: [cartao('Google Drive').locator('.cartao-credencial-acoes')],
  });
  Object.assign(simulacao.estado.drive, {
    autorizando: false,
    conectado: true,
    email: CONTA,
    podeGuardarCopia: true,
  });
  await esperarAviso('Google Drive conectado');
  await print('conectar-03-conectado', {
    destacando: [cartao('Google Drive').locator('.selo-situacao')],
  });
  await fecharAvisos();

  // Cópia sempre atual e Enviar agora
  await caixa('Manter no Google Drive').locator('input').check();
  await esperarAviso('Cópia no Google Drive ligada.');
  await print('copia-01-ligar', { destacando: [caixa('Manter no Google Drive')] });
  await fecharAvisos();
  await botao('Enviar agora').click();
  await esperarAviso('Cópia enviada ao Google Drive.');
  await print('copia-02-enviar-agora', {
    destacando: [botao('Enviar agora'), cartao('Google Drive').locator('p.texto-auxiliar')],
  });
  await fecharAvisos();

  // Backup periódico numa pasta
  await print('periodico-01-ligar', { destacando: [caixa('Fazer backup periodicamente')] });
  await caixa('Fazer backup periodicamente').locator('input').check();
  await esperarAviso('Pasta do backup salva.');
  await print('periodico-02-pasta', {
    destacando: [
      cartao('Backup neste computador').locator('.selo-situacao'),
      '#campo-backup-pasta',
    ],
  });
  await fecharAvisos();
  await painel.fill('#campo-backup-intervalo', '12');
  await painel.locator('#campo-backup-intervalo').press('Tab');
  await esperarAviso('Intervalo do backup salvo.');
  await print('periodico-03-intervalo', {
    destacando: [
      painel.locator('label[for="campo-backup-intervalo"]'),
      painel.locator('label[for="campo-backup-copias"]'),
    ],
  });
  await fecharAvisos();

  // Fazer backup agora
  await botao('Fazer backup agora').click();
  await esperarAviso('Backup gravado.');
  await print('agora-01', {
    destacando: [
      botao('Fazer backup agora'),
      cartao('Backup neste computador').locator('.linha-do-cartao-texto'),
    ],
  });
  await fecharAvisos();

  // Restaurar do Google Drive
  await botao('Restaurar do Google Drive').click();
  await corpoDoBackup.locator('.lista-de-copias').waitFor();
  await corpoDoBackup.locator('.lista-de-copias').scrollIntoViewIfNeeded();
  await print('restaurar-drive-01-copias', { destacando: ['.lista-de-copias'] });
  await corpoDoBackup.getByRole('button', { name: 'Restaurar esta' }).first().click();
  await botao('Reiniciar o HUB SNK agora').waitFor();
  await cartao('Restaurar').scrollIntoViewIfNeeded();

  // Reiniciar ou cancelar a restauração (nunca reinicia de verdade)
  await print('reiniciar-01-pendente', {
    destacando: [botao('Reiniciar o HUB SNK agora'), botao('Cancelar a restauração')],
  });
  await botao('Cancelar a restauração').click();
  await esperarAviso('Restauração cancelada.');
  await print('reiniciar-02-cancelada');
  await fecharAvisos();

  // Restaurar de um arquivo: o seletor do sistema não aparece, a resposta já vem pronta
  await cartao('Restaurar').scrollIntoViewIfNeeded();
  await print('restaurar-arquivo-01-botao', {
    destacando: [botao('Restaurar de um arquivo de backup')],
  });
  await botao('Restaurar de um arquivo de backup').click();
  await botao('Cancelar a restauração').waitFor();
  await botao('Cancelar a restauração').click();
  await fecharAvisos();

  // Falha no backup: as duas falhas no cartão e a notificação no sino
  simulacao.estado.backup.local.erro = ERRO_DO_BACKUP;
  simulacao.estado.backup.drive.erro = 'sem conexão com o Google Drive.';
  await abrirAbaBackup();
  await print('falha-01-cartao', {
    destacando: [
      corpoDoBackup.locator('.linha-do-cartao-erro'),
      cartao('Google Drive').locator('.erro-formulario'),
    ],
  });
  simulacao.estado.backup.local.erro = '';
  simulacao.estado.backup.drive.erro = '';
  await abrirAbaBackup();

  // Desconectar
  await botao('Desconectar').click();
  await esperarAviso('Google Drive desconectado.');
  await print('desconectar-01', { destacando: [botao('Conectar ao Google Drive')] });
  await fecharAvisos();
  await painel.click('#btn-cancelar-configuracao');

  // Sem a sessão da Experience, as OS do Resumo dariam erro atrás do painel do sino.
  await painel.route('**/api/os/consultar', (rota) =>
    rota.fulfill({ json: { itens: [], buscadoEm: new Date().toISOString() } }),
  );
  await painel.click('#btn-visualizacao-resumo');
  await painel.waitForTimeout(1500);
  await painel.click('#btn-notificacoes');
  await painel.locator('.item-notificacao').first().waitFor();
  await print('falha-02-notificacao', {
    destacando: [painel.locator('.item-notificacao').first()],
  });
  await painel.keyboard.press('Escape');
}

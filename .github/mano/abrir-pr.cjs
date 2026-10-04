/**
 * Transforma o resultado do job de correção num pull request.
 *
 * O job de correção só tem leitura: ele devolve um PATCH. Quem tem permissão de escrita
 * é este script, e ele não confia no patch — confere os caminhos contra a lista de
 * protegidos e os tamanhos antes de aplicar. Tudo vai para um branch `mano/<id>`; o
 * branch principal só recebe a mudança pelo workflow de publicação, a pedido do dono.
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const PASTA = 'mano-artefato';
const MAX_ARQUIVOS = 40;
const MAX_BYTES_DO_PATCH = 600 * 1024;

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Texto vindo do modelo: sem menções e com teto. */
function limpar(texto, teto) {
  const semMencao = String(texto ?? '')
    .replace(/@/g, '@​')
    .trim();
  return semMencao.length > teto ? `${semMencao.slice(0, teto)}…` : semMencao;
}

/** Devolve o motivo da recusa, ou `null` se o conjunto de arquivos é aceitável. */
function recusa(arquivos, bytesDoPatch, config) {
  const protegidos = arquivos.filter((arquivo) =>
    config.protegidos.some((padrao) => new RegExp(padrao).test(arquivo)),
  );
  if (protegidos.length) return `Arquivos protegidos: ${protegidos.slice(0, 10).join(', ')}`;
  if (arquivos.some((arquivo) => arquivo.includes('..') || arquivo.startsWith('/')))
    return 'Caminho inválido.';
  if (arquivos.length > MAX_ARQUIVOS)
    return `${arquivos.length} arquivos alterados (máximo ${MAX_ARQUIVOS}).`;
  if (bytesDoPatch > MAX_BYTES_DO_PATCH) return 'Alteração maior que o limite.';
  return null;
}

module.exports = async ({ github, context, core }) => {
  const config = JSON.parse(fs.readFileSync('.github/mano/config.json', 'utf8'));
  const { owner, repo } = context.repo;
  const id = process.env.ID ?? '';
  const ticket = Number(process.env.TICKET) || null;
  const prExistente = Number(process.env.PR) || null;
  const branch = `mano/${id}`;
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;

  const avisar = async (corpo) => {
    const aviso = { project: config.projeto, id, ticket, runUrl, ...corpo };
    core.info(`resultado: ${JSON.stringify({ status: aviso.status, pr: aviso.pr ?? null })}`);
    if (!process.env.MANO_URL || !process.env.MANO_CALLBACK_SECRET) {
      core.warning('MANO_CALLBACK_SECRET não definido — sem aviso no Telegram');
      return;
    }
    try {
      const resposta = await fetch(`${process.env.MANO_URL}/intake/v1/fix`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.MANO_CALLBACK_SECRET}`,
        },
        body: JSON.stringify(aviso),
        signal: AbortSignal.timeout(20_000),
      });
      if (!resposta.ok) core.warning(`o Mano respondeu HTTP ${resposta.status} ao aviso`);
    } catch (erro) {
      core.warning(`não consegui avisar o Mano: ${erro.message}`);
    }
  };

  if (!/^[a-z0-9]{4,16}$/.test(id)) return core.setFailed(`id inválido: ${id}`);

  try {
    if (process.env.SITUACAO !== 'success') return await avisar({ status: 'failed' });

    let resultado = {};
    try {
      resultado = JSON.parse(process.env.RESULTADO || '{}');
    } catch {
      // Sem JSON válido, segue só com o que o patch mostrar.
    }
    const resumo = limpar(resultado.resumo, 1500);
    const observacoes = limpar(resultado.observacoes, 1500);

    const arquivos = fs.existsSync(`${PASTA}/arquivos.txt`)
      ? fs
          .readFileSync(`${PASTA}/arquivos.txt`, 'utf8')
          .split('\n')
          .map((linha) => linha.trim())
          .filter(Boolean)
      : [];
    if (!arquivos.length)
      return await avisar({ status: 'no_changes', summary: resumo, notes: observacoes });

    const patch = `${PASTA}/mano.patch`;
    const motivo = recusa(arquivos, fs.statSync(patch).size, config);
    if (motivo) return await avisar({ status: 'rejected', summary: resumo, notes: motivo });

    git('config', 'user.name', 'mano-bot');
    git('config', 'user.email', 'mano-bot@users.noreply.github.com');
    // Num ajuste, o checkout já está no branch do pull request.
    if (!prExistente) git('checkout', '-b', branch);
    git('apply', '--index', '--whitespace=nowarn', patch);

    // Confere de novo, agora pelo que ficou de fato preparado para o commit.
    const preparados = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
    const motivoFinal = recusa(preparados, 0, config);
    if (motivoFinal)
      return await avisar({ status: 'rejected', summary: resumo, notes: motivoFinal });

    const titulo = (resumo.split(/(?<=[.!?])\s/)[0] || 'alteração a pedido').slice(0, 72);
    git('commit', '-m', `mano: ${titulo}`);
    git('push', 'origin', `HEAD:refs/heads/${branch}`);

    let pr = prExistente;
    let url;
    if (pr) {
      url = (await github.rest.pulls.get({ owner, repo, pull_number: pr })).data.html_url;
    } else {
      const corpo = [
        '## Pedido',
        '',
        '```text',
        limpar(process.env.PEDIDO, 2000).replace(/```/g, "'''"),
        '```',
        '',
        '## O que mudou',
        '',
        resumo || '_sem resumo_',
        ...(observacoes ? ['', '## Observações', '', observacoes] : []),
        ...(ticket ? ['', `Ticket de origem: \`mano-tickets#${ticket}\``] : []),
        '',
        `<sub>Aberto pelo Mano a pedido do dono · [execução](${runUrl}). Publica só pelo workflow \`mano-publicar\`.</sub>`,
      ].join('\n');
      const criado = await github.rest.pulls.create({
        owner,
        repo,
        head: branch,
        base: context.payload.repository.default_branch,
        title: `mano: ${titulo}`,
        body: corpo,
      });
      pr = criado.data.number;
      url = criado.data.html_url;
    }

    // Pull request aberto com o token do workflow não dispara o CI sozinho; pede à mão.
    for (const workflow of config.ci) {
      await github.rest.actions
        .createWorkflowDispatch({ owner, repo, workflow_id: workflow, ref: branch })
        .catch((erro) => core.warning(`CI ${workflow} não disparado: ${erro.message}`));
    }

    await avisar({
      status: 'ok',
      pr,
      url,
      summary: resumo,
      notes: observacoes,
      files: preparados.slice(0, 60),
      migration: preparados.some((arquivo) =>
        (config.migracoes ?? []).some((padrao) => new RegExp(padrao).test(arquivo)),
      ),
    });
  } catch (erro) {
    core.setFailed(erro.message);
    await avisar({ status: 'failed', notes: limpar(erro.message, 500) });
  }
};

module.exports.recusa = recusa;

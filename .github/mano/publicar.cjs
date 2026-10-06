/**
 * Publica (faz o merge) ou descarta um pull request aberto pelo Mano.
 *
 * Só aceita pull request cujo branch começa com `mano/` e aponta para o branch
 * principal, e só faz o merge se TODOS os testes daquele commit terminaram bem. O
 * deploy em si são os passos seguintes do workflow, que só rodam depois do merge.
 *
 * `ETAPA` divide o trabalho para os projetos que precisam fazer algo entre a conferência
 * e o merge (preparar uma versão, por exemplo):
 *   (vazio)    confere e faz o merge de uma vez
 *   conferir   só confere (e descarta, se for o caso); não faz merge
 *   esperar    aguarda os testes do commit atual terminarem
 *   merge      confere de novo e faz o merge
 */
const CONCLUSOES_ACEITAS = new Set(['success', 'neutral', 'skipped']);
const AINDA_NAO = new Set(['nenhum', 'rodando']);

/** Situação dos testes de um commit: `ok`, `nenhum`, `rodando` ou `falhou` (com o motivo). */
function situacaoDosTestes(checks, nomeDesteWorkflow) {
  // O próprio workflow de publicação também pode aparecer como check do commit; não conta.
  const relevantes = checks.filter(
    (check) => !(check.name ?? '').toLowerCase().includes(nomeDesteWorkflow),
  );
  if (!relevantes.length)
    return { estado: 'nenhum', motivo: 'Nenhum teste rodou neste pull request ainda.' };
  if (relevantes.some((check) => check.status !== 'completed')) {
    return {
      estado: 'rodando',
      motivo: 'Os testes ainda estão rodando. Tente de novo em alguns minutos.',
    };
  }
  const falhos = relevantes.filter((check) => !CONCLUSOES_ACEITAS.has(check.conclusion));
  if (falhos.length) {
    return {
      estado: 'falhou',
      motivo: `Os testes não passaram: ${falhos
        .map((check) => check.name)
        .slice(0, 5)
        .join(', ')}.`,
    };
  }
  return { estado: 'ok', motivo: null };
}

/** `null` se pode publicar; senão, o motivo. */
function bloqueioPorTestes(checks, nomeDesteWorkflow) {
  return situacaoDosTestes(checks, nomeDesteWorkflow).motivo;
}

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const numero = Number(process.env.PR);
  const acao = process.env.ACAO;
  const etapa = process.env.ETAPA || '';
  const recusar = (motivo) => {
    core.setOutput('motivo', motivo);
    core.setFailed(motivo);
  };

  if (!Number.isInteger(numero) || numero < 1)
    return recusar(`pull request inválido: ${process.env.PR}`);
  if (acao !== 'publicar' && acao !== 'descartar') return recusar(`ação inválida: ${acao}`);

  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: numero });
  const principal = context.payload.repository.default_branch;
  if (pr.state !== 'open') return recusar('O pull request não está aberto.');
  if (!pr.head.ref.startsWith('mano/') || pr.head.repo?.full_name !== `${owner}/${repo}`) {
    return recusar('Este workflow só publica pull requests abertos pelo Mano.');
  }
  // Só pull request do dono ou do próprio Mano (workflow). Um pull request de outra
  // pessoa nunca é mesclado por aqui, mesmo que o branch se chame mano/….
  if (pr.user?.login !== owner && pr.user?.login !== 'github-actions[bot]') {
    return recusar('Este workflow só publica pull requests do dono ou do Mano.');
  }
  if (pr.base.ref !== principal)
    return recusar('O pull request não aponta para o branch principal.');

  if (acao === 'descartar') {
    await github.rest.pulls.update({ owner, repo, pull_number: numero, state: 'closed' });
    await github.rest.git.deleteRef({ owner, repo, ref: `heads/${pr.head.ref}` }).catch(() => {});
    core.setOutput('feito', 'descartado');
    return;
  }

  const lerTestes = async () =>
    situacaoDosTestes(
      await github.paginate(github.rest.checks.listForRef, {
        owner,
        repo,
        ref: pr.head.sha,
        per_page: 100,
      }),
      'publicar',
    );

  let testes = await lerTestes();
  if (etapa === 'esperar') {
    // Depois de um commit novo no branch (a versão preparada), os testes recomeçam.
    const limite = Date.now() + (Number(process.env.ESPERA_MINUTOS) || 40) * 60_000;
    while (AINDA_NAO.has(testes.estado) && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      testes = await lerTestes();
    }
  }
  if (testes.motivo) return recusar(testes.motivo);

  core.setOutput('branch', pr.head.ref);
  core.setOutput('sha', pr.head.sha);
  core.setOutput('titulo', pr.title);
  if (etapa === 'conferir' || etapa === 'esperar') return;

  // Lista de arquivos ANTES do merge: os passos de deploy decidem o que publicar por ela.
  const arquivos = await github.paginate(github.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: numero,
    per_page: 100,
  });
  core.setOutput('arquivos', arquivos.map((arquivo) => arquivo.filename).join('\n'));

  let merge;
  try {
    merge = await github.rest.pulls.merge({
      owner,
      repo,
      pull_number: numero,
      merge_method: 'squash',
      sha: pr.head.sha, // se o branch mudou depois da conferência dos testes, o merge é recusado
    });
  } catch (erro) {
    // Proteção do branch, conflito ou branch alterado: o motivo vai para o dono.
    return recusar(`O GitHub recusou o merge: ${erro.message}`);
  }
  await github.rest.git.deleteRef({ owner, repo, ref: `heads/${pr.head.ref}` }).catch(() => {});

  core.setOutput('feito', 'publicado');
  core.setOutput('sha', merge.data.sha);
};

module.exports.bloqueioPorTestes = bloqueioPorTestes;
module.exports.situacaoDosTestes = situacaoDosTestes;

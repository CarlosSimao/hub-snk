/**
 * Lembretes das anotacoes de cliente, na abertura do aplicativo.
 *
 * O hub guarda, por cliente, um campo de anotacoes e uma marca "avisar". Quem marcou
 * quer ser lembrado ao abrir o aplicativo — nao a cada ciclo, nao por e-mail (isso e' o
 * resumo diario, em `src/resumoAnotacoes.ts`), mas uma vez, quando senta para trabalhar.
 *
 * Notificacao nativa do Windows, e nao um modal dentro da janela: o aviso precisa
 * aparecer mesmo com o hub atras de outra janela, que e' o caso normal de quem abre o
 * aplicativo e vai direto para o Sankhya.
 */
import { Notification } from 'electron';
import { HUB_URL, ICONE } from './config';
import { logEvento } from './log';

/** Primeira linha da anotacao, que e' o que cabe num balao de notificacao. */
function resumir(texto: string, limite = 120): string {
  const primeira = texto.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return primeira.length > limite ? `${primeira.slice(0, limite - 1)}…` : primeira;
}

interface Lembrete {
  id: number;
  nome: string;
  anotacoes: string;
}

/**
 * Busca no backend e notifica. Best-effort: sem backend, sem suporte a notificacao ou
 * com erro de rede, nao acontece nada — lembrete que falha nao pode atrapalhar a
 * abertura do aplicativo.
 */
export async function avisarAnotacoes(): Promise<number> {
  if (!Notification.isSupported()) {
    logEvento('lembretes-sem-suporte');
    return 0;
  }

  let lembretes: Lembrete[];
  try {
    const resposta = await fetch(`${HUB_URL}/api/email/lembretes`, { signal: AbortSignal.timeout(5_000) });
    if (!resposta.ok) return 0;
    lembretes = ((await resposta.json()) as { lembretes?: Lembrete[] }).lembretes ?? [];
  } catch {
    return 0;
  }

  for (const lembrete of lembretes) {
    new Notification({
      title: `Anotação — ${lembrete.nome}`,
      body: resumir(lembrete.anotacoes),
      icon: ICONE,
      // Sem som: pode ser mais de um cliente, e uma salva de bipes ao abrir o app é
      // exatamente o tipo de coisa que faz a pessoa desligar o aviso.
      silent: true,
    }).show();
  }

  // Sem o conteúdo das anotações no log: são notas de trabalho sobre cliente.
  if (lembretes.length) logEvento('lembretes-notificados', { total: lembretes.length });
  return lembretes.length;
}

interface PendenciaServerLog {
  origin: string;
  clienteNome: string;
  detectadoEm: string;
  removerAte: string;
  demanda: string;
  modulo: string;
  botaoId: string;
}

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
}

/**
 * Lembra de tirar o módulo `serverlog` das bases cujo prazo de remoção venceu.
 *
 * O módulo é instalado na base DO CLIENTE só para a demanda — deixar lá esquecido é
 * código nosso rodando em produção de terceiro sem motivo. A notificação diz o que tirar
 * (módulo e botão), porque "remova o módulo" sem dizer qual obriga a ir procurar.
 */
export async function avisarServerLog(): Promise<number> {
  if (!Notification.isSupported()) return 0;

  let pendencias: PendenciaServerLog[];
  try {
    const resposta = await fetch(`${HUB_URL}/api/serverlog/pendencias`, { signal: AbortSignal.timeout(5_000) });
    if (!resposta.ok) return 0;
    pendencias = ((await resposta.json()) as { pendencias?: PendenciaServerLog[] }).pendencias ?? [];
  } catch {
    return 0;
  }

  for (const p of pendencias) {
    const oQue = [p.modulo ? `módulo ${p.modulo}` : 'o módulo serverlog', p.botaoId ? `botão ${p.botaoId}` : 'o botão Ler Log']
      .join(' e ');
    new Notification({
      title: `Remover monitor de log — ${p.clienteNome || p.origin}`,
      body: `Prazo venceu em ${dataCurta(p.removerAte)}${p.demanda ? ` (${p.demanda})` : ''}. Retire ${oQue} da base.`,
      icon: ICONE,
      silent: true,
    }).show();
  }

  if (pendencias.length) logEvento('serverlog-lembretes-notificados', { total: pendencias.length });
  return pendencias.length;
}

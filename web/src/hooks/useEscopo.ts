import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentoEscopo, EscopoDoCliente, EstadoTarefa, TarefaEscopo } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

/** Enquanto houver documento em análise, a tela pergunta de novo neste intervalo. */
const INTERVALO_ACOMPANHAMENTO_MS = 4_000;
/** Com arquivo compartilhado, uma IA de fora pode mover cartões a qualquer momento. */
const INTERVALO_COMPARTILHADO_MS = 5_000;

export type EntradaTarefa = Partial<
  Pick<
    TarefaEscopo,
    | 'titulo'
    | 'descricao'
    | 'grupo'
    | 'tipo'
    | 'estimativaHoras'
    | 'prioridade'
    | 'criteriosAceite'
    | 'notas'
    | 'documentoId'
  >
>;

function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('não consegui ler o arquivo'));
    // `readAsDataURL` devolve `data:<tipo>;base64,<conteúdo>` — só o conteúdo interessa.
    leitor.onload = () => resolve(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.readAsDataURL(arquivo);
  });
}

export function useEscopo(clienteId: number, toast: Avisar) {
  const [documentos, setDocumentos] = useState<DocumentoEscopo[]>([]);
  const [tarefas, setTarefas] = useState<TarefaEscopo[]>([]);
  const [pastaSugerida, setPastaSugerida] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const tarefasRef = useRef<TarefaEscopo[]>([]);
  tarefasRef.current = tarefas;
  const ultimoRef = useRef('');

  const recarregar = useCallback(async () => {
    const { ok, body } = await requisitar<EscopoDoCliente>(`/api/clientes/${clienteId}/escopo`);
    if (ok) {
      // O acompanhamento repete a leitura a cada poucos segundos; resposta igual não
      // re-renderiza o quadro (e não atrapalha um arrasto em andamento).
      const texto = JSON.stringify(body);
      if (texto !== ultimoRef.current) {
        ultimoRef.current = texto;
        setDocumentos(body.documentos ?? []);
        setTarefas(body.tarefas ?? []);
        setPastaSugerida(body.pastaSugerida ?? '');
      }
    }
    setCarregando(false);
  }, [clienteId]);

  useEffect(() => {
    ultimoRef.current = '';
    void recarregar();
  }, [recarregar]);

  // Acompanha a análise (roda em segundo plano e leva minutos) e o arquivo compartilhado.
  const analisando = documentos.some((d) => d.status === 'analisando');
  const compartilhando = documentos.some((d) => d.compartilharEm);
  const intervalo = analisando ? INTERVALO_ACOMPANHAMENTO_MS : compartilhando ? INTERVALO_COMPARTILHADO_MS : 0;
  useEffect(() => {
    if (!intervalo) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void recarregar();
    }, intervalo);
    return () => clearInterval(timer);
  }, [intervalo, recarregar]);

  const renomearDemanda = useCallback(
    async (docId: number, demanda: string) => {
      const { ok, body } = await requisitar(`/api/escopo/documentos/${docId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ demanda }),
      });
      if (!ok) {
        toast('Não consegui renomear a demanda', 'err', body.error);
        return false;
      }
      await recarregar();
      return true;
    },
    [recarregar, toast],
  );

  /** `pasta` vazia desliga o compartilhamento. */
  const compartilhar = useCallback(
    async (docId: number, pasta: string, nome = '', criarPastaTarefas = false, ignorarNoGit = true) => {
      const { ok, body } = await requisitar<{
        documento: DocumentoEscopo;
        gitignore?: { gitignore?: string; entrada?: string; adicionada?: boolean; erro?: string };
      }>(`/api/escopo/documentos/${docId}/compartilhamento`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pasta, nome, criarPastaTarefas, ignorarNoGit }),
      });
      if (!ok) {
        toast(pasta ? 'Não consegui compartilhar as tarefas' : 'Não consegui parar o compartilhamento', 'err', body.error);
        return false;
      }
      const g = body.gitignore;
      if (g?.erro) toast('Compartilhado, mas o .gitignore não foi atualizado', 'err', g.erro);
      else if (g?.adicionada) toast(`${g.entrada} adicionado ao .gitignore`, 'ok');
      else if (g && !g.gitignore) toast('A pasta não está num repositório git — nada a ignorar', 'ok');
      await recarregar();
      return true;
    },
    [recarregar, toast],
  );

  const enviarDocumento = useCallback(
    async (arquivo: File): Promise<DocumentoEscopo | null> => {
      setEnviando(true);
      try {
        const conteudoBase64 = await lerComoBase64(arquivo);
        const { ok, body } = await enviar<{ documento: DocumentoEscopo }>(
          `/api/clientes/${clienteId}/escopo/documentos`,
          { nome: arquivo.name, conteudoBase64 },
        );
        if (!ok || !body.documento) {
          toast('Não consegui enviar o documento', 'err', body.error);
          return null;
        }
        await recarregar();
        return body.documento;
      } catch (err) {
        toast('Não consegui ler o arquivo', 'err', (err as Error).message);
        return null;
      } finally {
        setEnviando(false);
      }
    },
    [clienteId, recarregar, toast],
  );

  const analisar = useCallback(
    async (docId: number) => {
      const { ok, body } = await enviar(`/api/escopo/documentos/${docId}/analisar`);
      if (!ok) {
        toast('Não consegui iniciar a análise', 'err', body.error);
        return;
      }
      toast('Análise iniciada — pode levar alguns minutos', 'ok');
      await recarregar();
    },
    [recarregar, toast],
  );

  const removerDocumento = useCallback(
    async (docId: number) => {
      const { ok, body } = await requisitar(`/api/escopo/documentos/${docId}`, { method: 'DELETE' });
      if (!ok) {
        toast('Não consegui remover o documento', 'err', body.error);
        return;
      }
      await recarregar();
    },
    [recarregar, toast],
  );

  const criarTarefa = useCallback(
    async (entrada: EntradaTarefa, estado: EstadoTarefa = 'backlog') => {
      const { ok, body } = await enviar<{ tarefa: TarefaEscopo }>(`/api/clientes/${clienteId}/escopo/tarefas`, {
        ...entrada,
        estado,
      });
      if (!ok) {
        toast('Não consegui criar a tarefa', 'err', body.error);
        return false;
      }
      await recarregar();
      return true;
    },
    [clienteId, recarregar, toast],
  );

  const atualizarTarefa = useCallback(
    async (id: number, entrada: EntradaTarefa) => {
      const { ok, body } = await requisitar<{ tarefa: TarefaEscopo }>(`/api/escopo/tarefas/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entrada),
      });
      if (!ok) {
        toast('Não consegui salvar a tarefa', 'err', body.error);
        return false;
      }
      await recarregar();
      return true;
    },
    [recarregar, toast],
  );

  /**
   * Otimista: o cartão muda de lugar na hora, e o servidor confirma depois. Arrastar e ver
   * o cartão "voltar" meio segundo até a resposta chegar é o que faz um quadro parecer
   * quebrado. Se o servidor recusar, o quadro volta ao que ele diz que é.
   */
  const mover = useCallback(
    async (id: number, estado: EstadoTarefa, indice: number) => {
      const atuais = tarefasRef.current;
      const alvo = atuais.find((t) => t.id === id);
      if (!alvo) return;

      const destino = atuais
        .filter((t) => t.estado === estado && t.id !== id)
        .sort((a, b) => a.ordem - b.ordem);
      const posicao = Math.max(0, Math.min(indice, destino.length));
      destino.splice(posicao, 0, { ...alvo, estado });
      const reordenadas = new Map(destino.map((t, i) => [t.id, { ...t, ordem: i }]));
      setTarefas(atuais.map((t) => reordenadas.get(t.id) ?? t));

      const { ok, body } = await enviar(`/api/escopo/tarefas/${id}/mover`, { estado, indice: posicao });
      if (!ok) toast('Não consegui mover a tarefa', 'err', body.error);
      // O quadro local foi mexido à mão: a próxima resposta tem de valer mesmo se for igual à anterior.
      ultimoRef.current = '';
      await recarregar();
    },
    [recarregar, toast],
  );

  const removerTarefa = useCallback(
    async (id: number) => {
      const { ok, body } = await requisitar(`/api/escopo/tarefas/${id}`, { method: 'DELETE' });
      if (!ok) {
        toast('Não consegui excluir a tarefa', 'err', body.error);
        return;
      }
      await recarregar();
    },
    [recarregar, toast],
  );

  return {
    documentos,
    tarefas,
    pastaSugerida,
    carregando,
    enviando,
    analisando,
    recarregar,
    enviarDocumento,
    analisar,
    removerDocumento,
    renomearDemanda,
    compartilhar,
    criarTarefa,
    atualizarTarefa,
    mover,
    removerTarefa,
  };
}

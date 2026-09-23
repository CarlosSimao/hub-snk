import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentoEscopo, EscopoDoCliente, EstadoTarefa, TarefaEscopo } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

/** Enquanto houver documento em análise, a tela pergunta de novo neste intervalo. */
const INTERVALO_ACOMPANHAMENTO_MS = 4_000;

export type EntradaTarefa = Partial<
  Pick<TarefaEscopo, 'titulo' | 'descricao' | 'grupo' | 'tipo' | 'estimativaHoras' | 'prioridade' | 'criteriosAceite'>
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
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const tarefasRef = useRef<TarefaEscopo[]>([]);
  tarefasRef.current = tarefas;

  const recarregar = useCallback(async () => {
    const { ok, body } = await requisitar<EscopoDoCliente>(`/api/clientes/${clienteId}/escopo`);
    if (ok) {
      setDocumentos(body.documentos ?? []);
      setTarefas(body.tarefas ?? []);
    }
    setCarregando(false);
  }, [clienteId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  // Acompanha a análise: ela roda em segundo plano no hub e leva minutos.
  const analisando = documentos.some((d) => d.status === 'analisando');
  useEffect(() => {
    if (!analisando) return;
    const timer = setInterval(() => void recarregar(), INTERVALO_ACOMPANHAMENTO_MS);
    return () => clearInterval(timer);
  }, [analisando, recarregar]);

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
    carregando,
    enviando,
    analisando,
    recarregar,
    enviarDocumento,
    analisar,
    removerDocumento,
    criarTarefa,
    atualizarTarefa,
    mover,
    removerTarefa,
  };
}

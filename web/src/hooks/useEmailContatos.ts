import { useCallback, useEffect, useState } from 'react';
import type {
  AgenteIA,
  AnexoEmail,
  ContatoEmailCliente,
  ContatoEmailClienteEntrada,
  SugestaoContatoEmail,
} from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

/** Contatos de e-mail (GP/consultor/líder) de UM cliente, e o envio para ele. */
export function useEmailContatos(clienteId: number, toast: Avisar) {
  const [contatos, setContatos] = useState<ContatoEmailCliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const { ok, body } = await requisitar<{ contatos: ContatoEmailCliente[] }>(
      `/api/clientes/${clienteId}/email/contatos`,
    );
    if (ok) setContatos(body.contatos ?? []);
    else toast('Não consegui carregar os contatos de e-mail.', 'err', body.error);
    setCarregando(false);
  }, [clienteId, toast]);

  useEffect(() => {
    setContatos([]);
    void recarregar();
  }, [recarregar]);

  const salvarContatos = useCallback(
    async (lista: ContatoEmailClienteEntrada[]) => {
      setOcupado(true);
      try {
        const { ok, body } = await requisitar<{ contatos: ContatoEmailCliente[] }>(
          `/api/clientes/${clienteId}/email/contatos`,
          { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contatos: lista }) },
        );
        if (!ok) {
          toast('Não consegui salvar os contatos.', 'err', body.error);
          return false;
        }
        setContatos(body.contatos ?? []);
        toast('Contatos salvos.', 'ok');
        return true;
      } finally {
        setOcupado(false);
      }
    },
    [clienteId, toast],
  );

  /** Melhor esforço: só nome, vindo das OS mais recentes na Experience. Nunca e-mail. */
  const sugerir = useCallback(async (): Promise<SugestaoContatoEmail[]> => {
    const { ok, body } = await requisitar<{ sugestoes: SugestaoContatoEmail[] }>(
      `/api/clientes/${clienteId}/email/sugestao`,
    );
    if (!ok) {
      toast('Não consegui buscar sugestão no Sankhya.', 'err', body.error);
      return [];
    }
    return body.sugestoes ?? [];
  }, [clienteId, toast]);

  const enviarEmail = useCallback(
    async (mensagem: { assunto: string; corpo: string; anexo?: AnexoEmail }) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar<{ destinatarios: string[] }>(
          `/api/clientes/${clienteId}/email/enviar`,
          mensagem,
        );
        if (!ok) {
          toast('Não consegui enviar o e-mail.', 'err', body.error);
          return null;
        }
        toast(`E-mail enviado para ${(body.destinatarios ?? []).join(', ')}.`, 'ok');
        return body.destinatarios ?? [];
      } finally {
        setOcupado(false);
      }
    },
    [clienteId, toast],
  );

  /**
   * Resumo por IA de commits/diff de um repositório, num período — o mesmo agente já
   * configurado na aba Git (Mensagem do commit automático), não uma segunda config.
   */
  const gerarEvidencia = useCallback(
    async (dados: { caminho: string; desde: string; ate: string; agente: AgenteIA }) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar<{ texto: string }>(
          `/api/clientes/${clienteId}/email/evidencia`,
          dados,
        );
        if (!ok || typeof body.texto !== 'string') {
          toast('Não consegui gerar o texto de evidência.', 'err', body.error);
          return null;
        }
        return body.texto;
      } finally {
        setOcupado(false);
      }
    },
    [clienteId, toast],
  );

  return { contatos, carregando, ocupado, recarregar, salvarContatos, sugerir, enviarEmail, gerarEvidencia };
}

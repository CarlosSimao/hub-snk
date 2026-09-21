import { useCallback, useEffect, useState } from 'react';
import type { ConfigEmail, ConfigEmailEntrada } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

const VAZIA: ConfigEmail = {
  smtpHost: 'smtp.gmail.com',
  smtpPorta: 465,
  smtpUsuario: '',
  smtpRemetente: '',
  temSenha: false,
  assinatura: '',
  liderImediato: { nome: '', email: '' },
  responsavelOrcamento: { nome: '', email: '' },
  resumoAnotacoes: { ativo: false, hora: '08:00' },
};

/**
 * Configuração global do e-mail interno: um SMTP e dois contatos fixos para o hub
 * inteiro, não por cliente — por isso não recebe `clienteId`.
 */
export function useEmailConfig(toast: Avisar) {
  const [config, setConfig] = useState<ConfigEmail>(VAZIA);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    const { ok, body } = await requisitar<ConfigEmail>('/api/config/email');
    if (ok) setConfig(body as ConfigEmail);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const salvar = useCallback(
    async (entrada: ConfigEmailEntrada, senha?: string) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar<ConfigEmail>('/api/config/email', {
          ...entrada,
          ...(senha === undefined ? {} : { smtpSenha: senha }),
        });
        if (!ok) {
          toast('Não consegui salvar a configuração de e-mail.', 'err', body.error);
          return false;
        }
        await recarregar();
        toast('Configuração de e-mail salva.', 'ok');
        return true;
      } finally {
        setOcupado(false);
      }
    },
    [recarregar, toast],
  );

  const testar = useCallback(async () => {
    setOcupado(true);
    try {
      const { ok, body } = await enviar<{ ok: boolean; mensagem: string }>('/api/config/email/testar');
      toast(ok ? 'Conexão SMTP ok.' : 'Falha na conexão SMTP.', ok ? 'ok' : 'err', body.mensagem ?? body.error);
      return ok;
    } finally {
      setOcupado(false);
    }
  }, [toast]);

  /** Manda o resumo das anotações agora, sem esperar o horário — botão de conferência. */
  const testarResumo = useCallback(async () => {
    setOcupado(true);
    try {
      const { ok, body } = await enviar<{ enviado: boolean; motivo: string; clientes: number }>(
        '/api/email/resumo/testar',
      );
      if (!ok) {
        toast('Não consegui enviar o resumo.', 'err', body.error);
        return false;
      }
      toast(
        body.enviado ? `Resumo enviado (${body.clientes} anotação(ões)).` : 'Nada a enviar.',
        'ok',
        body.motivo,
      );
      return body.enviado;
    } finally {
      setOcupado(false);
    }
  }, [toast]);

  return { config, carregando, ocupado, salvar, testar, testarResumo, recarregar };
}

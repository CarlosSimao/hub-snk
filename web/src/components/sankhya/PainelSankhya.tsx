import { useState } from 'react';
import { TabBar, type Aba } from '../TabBar.tsx';
import type { Avisar } from '../../hooks/useToasts.ts';
import { TelaClientes } from './TelaClientes.tsx';
import { TelaCredenciais } from './TelaCredenciais.tsx';

type SubAba = 'clientes' | 'credenciais' | 'agenda';

const ABAS: Aba<SubAba>[] = [
  { id: 'clientes', rotulo: 'Clientes', titulo: 'Cadastro dos clientes acompanhados' },
  { id: 'credenciais', rotulo: 'Credenciais', titulo: 'Login do hub no Sankhya ERP e Experience' },
  { id: 'agenda', rotulo: 'Agenda Mensal', titulo: 'Resumo consolidado do mês' },
];

export function PainelSankhya({ toast }: { toast: Avisar }) {
  const [aba, setAba] = useState<SubAba>('clientes');

  return (
    <>
      <TabBar abas={ABAS} ativa={aba} onTrocar={setAba} variante="sub" />

      {aba === 'clientes' && <TelaClientes toast={toast} />}
      {aba === 'credenciais' && <TelaCredenciais toast={toast} />}
      {aba === 'agenda' && (
        <p className="detail-empty">
          A Agenda Mensal depende da extração de tarefas da Experience e dos eventos da
          Agenda de Recursos. Cadastre os clientes e as credenciais primeiro.
        </p>
      )}
    </>
  );
}

export const CAMINHO_API = '/public/serverFunction/60689/15/execute';
export type TipoEvento = 'usuario.upsert' | 'os.upsert' | 'os.progresso' | 'horas.apontar';
export interface EventoApi { id: string; type: TipoEvento; occurredAt: string; data: Record<string, unknown> }
const id = /^[A-Za-z0-9._:@/-]{1,120}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const formatos: Record<TipoEvento, { obrigatorios: Record<string, number | string>; opcionais: Record<string, number | string> }> = {
  'usuario.upsert': { obrigatorios: { externalId: 'id', name: 180 }, opcionais: { email: 254, active: 'boolean' } },
  'os.upsert': { obrigatorios: { externalId: 'id', userExternalId: 'id', code: 120, title: 240, status: 80, progress: 'progress' }, opcionais: { description: 5000, priority: 40, dueAt: 'date', active: 'boolean' } },
  'os.progresso': { obrigatorios: { osExternalId: 'id', progress: 'progress', status: 80 }, opcionais: {} },
  'horas.apontar': { obrigatorios: { externalId: 'id', osExternalId: 'id', userExternalId: 'id', minutes: 'minutes' }, opcionais: { description: 500, startedAt: 'date', endedAt: 'date' } },
};

export function validarConfig(apiUrl: string, installationId: string): void {
  let url: URL;
  try { url = new URL(apiUrl); } catch { throw new Error('URL da API invalida'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== CAMINHO_API) {
    throw new Error(`URL HTTPS deve terminar exatamente em ${CAMINHO_API}`);
  }
  if (!uuid.test(installationId)) throw new Error('ID da instalacao deve ser UUID valido');
}

function dataValida(valor: unknown): boolean {
  return typeof valor === 'string' && valor.length <= 35 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(valor) && !Number.isNaN(Date.parse(valor)) && new Date(valor).toISOString().startsWith(valor.slice(0, 19));
}

export function validarEvento(valor: unknown): asserts valor is EventoApi {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Evento deve ser objeto');
  const e = valor as Record<string, unknown>;
  if (typeof e.id !== 'string' || !id.test(e.id)) throw new Error('event.id invalido');
  if (typeof e.type !== 'string' || !(e.type in formatos)) throw new Error('event.type invalido');
  if (!dataValida(e.occurredAt)) throw new Error('event.occurredAt deve ser ISO UTC');
  if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) throw new Error('event.data invalido');
  if (Object.keys(e).some(k => !['id', 'type', 'occurredAt', 'data'].includes(k))) throw new Error('Campo extra no evento');
  const data = e.data as Record<string, unknown>;
  const f = formatos[e.type as TipoEvento];
  if (Object.keys(data).some(k => !(k in f.obrigatorios) && !(k in f.opcionais))) throw new Error('Campo extra em event.data');
  for (const [campo, regra] of Object.entries({ ...f.obrigatorios, ...f.opcionais })) {
    const v = data[campo];
    if (v === undefined && campo in f.obrigatorios) throw new Error(`${campo} obrigatorio`);
    if (v === undefined) continue;
    const ok = regra === 'id' ? typeof v === 'string' && id.test(v)
      : regra === 'date' ? dataValida(v)
      : regra === 'boolean' ? typeof v === 'boolean'
      : regra === 'progress' ? typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
      : regra === 'minutes' ? typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10080
      : typeof regra === 'number' && typeof v === 'string' && v.length >= 1 && v.length <= regra;
    if (!ok) throw new Error(`${campo} invalido`);
  }
}

// PERFIS DE REFERÊNCIA para benchmark de viralização (editável pelo dono).
//
// Dois grupos: pares políticos (mesmo nicho) e influencers de outras áreas
// (cross-nicho — para transferir padrões de viral ao contexto político).
// Só funciona com contas BUSINESS/CREATOR (a Graph API business_discovery exige isso);
// handles que não resolverem são pulados silenciosamente. Troque à vontade.

export type Referencia = { handle: string; grupo: 'politico' | 'cross_nicho'; nota?: string }

export const REFERENCIAS: Referencia[] = [
  // ── Pares políticos / comunicação política BR (mesmo nicho) ──
  { handle: 'felipeneto', grupo: 'politico', nota: 'comunicador com forte engajamento político' },
  { handle: 'midianinja', grupo: 'politico', nota: 'mídia independente, pauta progressista viral' },

  // ── Cross-nicho: viral de outras áreas (transferir ganchos/formatos) ──
  { handle: 'whinderssonnunes', grupo: 'cross_nicho', nota: 'humor — ganchos e timing de comédia' },
  { handle: 'cazetv', grupo: 'cross_nicho', nota: 'entretenimento/jornalismo de rua viral' },
  { handle: 'nathaliaarcuri', grupo: 'cross_nicho', nota: 'educação financeira — didática que prende' },
]

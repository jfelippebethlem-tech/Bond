import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

export async function gerarResposta(
  demanda: string,
  contexto?: string
): Promise<string> {
  const anthropic = getClient()
  if (!anthropic) {
    return 'Configure a chave da API Anthropic em .env para usar o assistente de IA.'
  }

  const prompt = `Você é um assistente de um deputado estadual brasileiro.
Ajude a redigir uma resposta profissional, empática e eficiente para a seguinte demanda de cidadão:

DEMANDA: ${demanda}
${contexto ? `\nCONTEXTO ADICIONAL: ${contexto}` : ''}

Responda de forma profissional, em português, com tom respeitoso e solucionador.`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type === 'text') return content.text
  return 'Erro ao gerar resposta.'
}

export async function analisarSentimento(texto: string): Promise<string> {
  const anthropic = getClient()
  if (!anthropic) return 'neutro'

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [
      {
        role: 'user',
        content: `Classifique o sentimento deste texto como exatamente uma palavra: "positivo", "negativo" ou "neutro".\nTexto: "${texto}"\nResposta (apenas uma palavra):`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type === 'text') {
    const s = content.text.toLowerCase().trim()
    if (s.includes('positivo')) return 'positivo'
    if (s.includes('negativo')) return 'negativo'
    return 'neutro'
  }
  return 'neutro'
}

export async function gerarPostRedeSocial(
  tema: string,
  plataforma: string,
  tom: string
): Promise<string> {
  const anthropic = getClient()
  if (!anthropic) {
    return 'Configure a chave da API Anthropic em .env para usar o assistente de IA.'
  }

  const limits: Record<string, number> = {
    twitter: 280,
    instagram: 2200,
    facebook: 63206,
  }
  const limit = limits[plataforma.toLowerCase()] || 500

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Crie um post para ${plataforma} sobre: ${tema}
Tom: ${tom}
Limite de caracteres: ${limit}
Escreva apenas o texto do post, sem explicações adicionais.`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type === 'text') return content.text
  return 'Erro ao gerar post.'
}

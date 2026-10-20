/**
 * [recap] A frase que a plataforma derruba (20/10): o Nia E03 saiu com
 * "Ele achava que ia espancar uma criança indefesa." e "O homem ficou no chão
 * implorando pra ser morto." -- o Levi nao pode postar. O roteiro avisa
 * (riscoDePlataforma no validarRoteiro) e o prompt tem a regra fixa
 * (SEGURANCA_DA_PLATAFORMA, com qualquer estilo).
 *
 * Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-risco-plataforma.ts
 */
import { sistemaDoRoteiro } from '../electron/gerar/prompts'
import { riscoDePlataforma, validarRoteiro, type Evento, type Roteiro } from '../shared/roteiro'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'}  ${nome}`)
  if (!ok) falhas += 1
}

console.log('\n1. O detector')
confere(riscoDePlataforma('Ele achava que ia espancar uma criança indefesa.') === 'violencia com crianca', 'espancar uma criança')
confere(riscoDePlataforma('O cara bateu na garotinha sem dó.') === 'violencia com crianca', 'bateu na garotinha')
confere(riscoDePlataforma('O homem ficou no chão implorando pra ser morto.') === 'pedido de morte', 'implorando pra ser morto')
confere(riscoDePlataforma('Ela pensou em se matar.') === 'suicidio ou automutilacao', 'se matar')
confere(riscoDePlataforma('Mas os socos do cara nem fazem a Nia se mover.') === null, 'luta com a Nia pelo nome: ok')
confere(riscoDePlataforma('A criança sorriu para o pai.') === null, 'criança sem agressão: ok')
confere(riscoDePlataforma('O guerreiro só queria morrer lutando.') === null, 'morrer lutando (a premissa): ok')
confere(riscoDePlataforma('Ele ficou no chão, derrotado.') === null, 'o jeito certo: ok')

console.log('\n2. O aviso no roteiro')
const eventos = [{ id: 'e01', resumo: 'Anzel luta com Nia', personagens: ['Anzel', 'Nia'] }] as unknown as Evento[]
const roteiro = {
  secoes: [
    {
      id: 's1',
      papel: 'gancho',
      frases: [
        { id: 'f01', texto: 'Ele achava que ia espancar uma criança indefesa.', eventoIds: ['e01'], intencaoVisual: 'Anzel', textoDeTela: null },
        { id: 'f02', texto: 'Mas os socos do cara nem fazem a Nia se mover.', eventoIds: ['e01'], intencaoVisual: 'Nia', textoDeTela: null },
      ],
    },
  ],
} as unknown as Roteiro
const problemas = validarRoteiro(roteiro, eventos)
const riscos = problemas.filter((p) => p.codigo === 'risco-plataforma')
confere(riscos.length === 1 && riscos[0]!.fraseId === 'f01' && riscos[0]!.nivel === 'aviso', `um aviso, na f01 (${riscos.map((r) => r.fraseId).join(',')})`)
confere(/derrubar/.test(riscos[0]?.mensagem ?? ''), `a mensagem diz o risco ("${riscos[0]?.mensagem}")`)

console.log('\n3. A regra no prompt, com e sem estilo')
confere(/SEGURANÇA DA PLATAFORMA/.test(sistemaDoRoteiro(null)) && /SEGURANÇA DA PLATAFORMA/.test(sistemaDoRoteiro('ESTILO DO EDITOR: curto e direto')), 'nos dois sistemas')

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)

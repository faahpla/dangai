/**
 * (21/10) O AVISO ANTES DE SEGUIR (shared/aviso-reconhecer.ts), sem janela.
 *
 * - 'sem': reconhecimento pulado, elenco vazio/ninguem achado (0 planos com
 *   personagem), ou o corte por tras pedido sem reconhecer;
 * - 'fraco': rodou, mas menos de 10% dos planos tem alguem;
 * - nada para episodio reconhecido (e para o corte por tras com reconhecer);
 * - "Seguir assim" lembrado NAQUELE episodio e naquela forca; o "Sugerir de
 *   novo" depois de reconhecer.
 * - Os casos reais (so leitura, quando existem neste PC): Nia E01 = "pulado:
 *   0 de 432 planos"; MRM E02 = reconhecido, sem aviso.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-aviso-reconhecer.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  avisoAoSeguir,
  avisoDeReconhecimento,
  CHAVE_SEGUIR_ASSIM,
  detalheDoAviso,
  esquecerSeguirAssim,
  lembrarSeguirAssim,
  LIMIAR_FRACO,
  MAXIMO_LEMBRADOS,
  pedeSugerirDeNovo,
  seguiuAssim,
  seloDoAviso,
  TEXTO_SEM_PERSONAGENS,
  textoDoAviso,
  TITULO_SEM_PERSONAGENS,
  tituloDoAviso,
  CONSEQUENCIA,
  corpoDoAviso,
} from '../shared/aviso-reconhecer'
import type { EpisodeIndex, Plano } from '../shared/episodio'

type Indice = Pick<EpisodeIndex, 'id' | 'planos' | 'reconhecimento' | 'corte'>

function planos(total: number, comAlguem: number): Plano[] {
  return Array.from({ length: total }, (_, i) => ({
    id: String(i + 1).padStart(4, '0'),
    start: i * 2,
    end: i * 2 + 2,
    arquivo: `G:/x/shots/${i}.mp4`,
    keyframe: null,
    cueIds: [],
    falantes: [],
    personagens: i < comAlguem ? [{ nome: 'Nia Liston', conf: 0.8, fonte: 'studio' as const }] : [],
  })) as Plano[]
}

function indice(id: string, total: number, comAlguem: number, extra: Partial<Indice> = {}): Indice {
  return { id, planos: planos(total, comAlguem), reconhecimento: comAlguem > 0 ? 'feito' : 'pulado', ...extra }
}

/** O localStorage, em memoria. */
function armazem(): Storage & { dados: Map<string, string> } {
  const dados = new Map<string, string>()
  return {
    dados,
    get length() {
      return dados.size
    },
    clear: () => dados.clear(),
    getItem: (k: string) => dados.get(k) ?? null,
    key: (i: number) => [...dados.keys()][i] ?? null,
    removeItem: (k: string) => void dados.delete(k),
    setItem: (k: string, v: string) => void dados.set(k, String(v)),
  }
}

// ------------------------------------------------------------- 1. 'sem'
{
  // O Nia E01: so corte, 0 de 432.
  const a = avisoDeReconhecimento(indice('ep_nia', 432, 0))
  assert.deepEqual(a, { tipo: 'sem', comPersonagem: 0, total: 432, porque: 'pulado' })
  assert.equal(textoDoAviso(a!), TEXTO_SEM_PERSONAGENS)
  assert.equal(tituloDoAviso(a!), TITULO_SEM_PERSONAGENS)
  // O texto pedido, inteiro: a 1a frase vira o titulo da caixa, o resto o corpo.
  assert.equal(
    TEXTO_SEM_PERSONAGENS,
    "Esse episodio nao tem personagens reconhecidos. Sem isso a escolha de cenas fica pior: o recorte nao sabe quem e quem, 'a garota' nao vira a protagonista e o grid nao entra.",
  )
  assert.equal(detalheDoAviso(a!), 'Reconhecimento pulado: 0 de 432 planos')
  assert.equal(seloDoAviso(a!), 'sem personagens: escolha mais fraca')
  assert.ok(/^[\x20-\x7e]+$/.test(TEXTO_SEM_PERSONAGENS), 'o texto e ASCII')

  // Rodou, mas o elenco veio vazio (ou ninguem casou): 0 planos -> 'sem', porque 'ninguem'.
  const vazio = avisoDeReconhecimento(indice('ep_vazio', 300, 0, { reconhecimento: 'feito' }))
  assert.equal(vazio?.tipo, 'sem')
  assert.equal(vazio?.porque, 'ninguem')
  assert.equal(detalheDoAviso(vazio!), 'Ninguem reconhecido: 0 de 300 planos')

  // Biblioteca externa sem como saber, sem ninguem: tambem 'sem'.
  assert.equal(avisoDeReconhecimento(indice('ep_ext', 50, 0, { reconhecimento: 'desconhecido' }))?.tipo, 'sem')

  // Corte por tras pedido SEM reconhecer, ainda sem planos: ja da para dizer.
  const semPlanos = avisoDeReconhecimento({
    planos: [],
    reconhecimento: 'pulado',
    corte: { reconhecer: false } as EpisodeIndex['corte'],
  })
  assert.deepEqual(semPlanos, { tipo: 'sem', comPersonagem: 0, total: 0, porque: 'pulado' })
  assert.equal(detalheDoAviso(semPlanos!), 'Reconhecimento pulado')
  // Com reconhecer, espera as cenas: nada ainda.
  assert.equal(avisoDeReconhecimento({ planos: [], reconhecimento: 'desconhecido', corte: { reconhecer: true } as EpisodeIndex['corte'] }), null)
  assert.equal(avisoDeReconhecimento({ planos: [], reconhecimento: 'desconhecido' }), null)
}

// ------------------------------------------------------------- 2. 'fraco'
{
  assert.equal(LIMIAR_FRACO, 0.1)
  const fraco = avisoDeReconhecimento(indice('ep_fraco', 432, 12))
  assert.deepEqual(fraco, { tipo: 'fraco', comPersonagem: 12, total: 432, porque: 'poucos' })
  assert.equal(tituloDoAviso(fraco!), 'Poucos personagens reconhecidos (12 de 432 planos)')
  assert.equal(corpoDoAviso(fraco!), CONSEQUENCIA.replace('Sem isso', 'Com tao poucos,'))
  assert.equal(corpoDoAviso(avisoDeReconhecimento(indice('n', 10, 0))!), CONSEQUENCIA)
  assert.equal(textoDoAviso(fraco!), `Poucos personagens reconhecidos (12 de 432 planos). ${corpoDoAviso(fraco!)}`)
  assert.equal(detalheDoAviso(fraco!), null)
  assert.equal(seloDoAviso(fraco!), 'poucos personagens: escolha mais fraca')
  // A borda: 9 de 100 e fraco; 10 de 100 ja nao.
  assert.equal(avisoDeReconhecimento(indice('a', 100, 9))?.tipo, 'fraco')
  assert.equal(avisoDeReconhecimento(indice('b', 100, 10)), null)
  // 1 de 3 (curto) passa: 33%.
  assert.equal(avisoDeReconhecimento(indice('c', 3, 1)), null)
}

// ------------------------------------------------- 3. reconhecido: nada muda
{
  assert.equal(avisoDeReconhecimento(indice('ep_mrm', 375, 254)), null)
  const a = armazem()
  assert.equal(avisoAoSeguir(indice('ep_mrm', 375, 254), a), null)
  assert.equal(a.dados.size, 0, 'nada gravado')
  assert.equal(pedeSugerirDeNovo(indice('ep_mrm', 375, 254), a), false)
}

// --------------------------------------------- 4. "Seguir assim" lembrado
{
  const a = armazem()
  const nia = indice('ep_nia', 432, 0)
  const outro = indice('ep_outro', 200, 0)
  assert.equal(avisoAoSeguir(nia, a)?.tipo, 'sem')
  lembrarSeguirAssim(a, nia.id, 'sem')
  assert.equal(seguiuAssim(a, nia.id), 'sem')
  // Naquele episodio nao pergunta de novo...
  assert.equal(avisoAoSeguir(nia, a), null)
  // ...mas no outro sim.
  assert.equal(avisoAoSeguir(outro, a)?.tipo, 'sem')
  // Reconheceu e ficou fraco: o 'sem' aceito nao cala o 'fraco'.
  const niaFraco = indice('ep_nia', 432, 12)
  assert.equal(avisoAoSeguir(niaFraco, a)?.tipo, 'fraco')
  lembrarSeguirAssim(a, nia.id, 'fraco')
  assert.equal(avisoAoSeguir(niaFraco, a), null)

  // Reconhecido de verdade depois de seguir assim: o passo 4 pede "Sugerir de novo"...
  const niaBom = indice('ep_nia', 432, 300)
  assert.equal(pedeSugerirDeNovo(niaBom, a), true)
  // ...ainda sem personagens, nao (o selo fala).
  assert.equal(pedeSugerirDeNovo(niaFraco, a), false)
  // Sugeriu de novo: esquece; volta a perguntar se um dia ficar sem.
  esquecerSeguirAssim(a, nia.id)
  assert.equal(seguiuAssim(a, nia.id), null)
  assert.equal(pedeSugerirDeNovo(niaBom, a), false)
  assert.equal(avisoAoSeguir(nia, a)?.tipo, 'sem')
  esquecerSeguirAssim(a, 'ep_nunca_visto') // sem efeito, sem erro
}

// --------------------------------------- 5. armazem quebrado ou ausente
{
  // Sem armazem: pergunta sempre, nada quebra.
  lembrarSeguirAssim(null, 'ep_x', 'sem')
  assert.equal(seguiuAssim(null, 'ep_x'), null)
  assert.equal(avisoAoSeguir(indice('ep_x', 10, 0), null)?.tipo, 'sem')

  // Lixo no armazem: ignora o que nao e 'sem'/'fraco'.
  const a = armazem()
  a.setItem(CHAVE_SEGUIR_ASSIM, '{nao e json')
  assert.equal(seguiuAssim(a, 'ep_x'), null)
  a.setItem(CHAVE_SEGUIR_ASSIM, JSON.stringify({ ep_x: 'talvez', ep_y: 'sem' }))
  assert.equal(seguiuAssim(a, 'ep_x'), null)
  assert.equal(seguiuAssim(a, 'ep_y'), 'sem')
  a.setItem(CHAVE_SEGUIR_ASSIM, '[1,2]')
  assert.equal(seguiuAssim(a, 'ep_y'), null)

  // setItem que lanca (cota cheia): engole.
  const cheio = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  lembrarSeguirAssim(cheio, 'ep_z', 'sem')

  // A lista nao cresce para sempre: os mais antigos saem.
  const b = armazem()
  for (let i = 0; i < MAXIMO_LEMBRADOS + 5; i++) lembrarSeguirAssim(b, `ep_${i}`, 'sem')
  const guardados = Object.keys(JSON.parse(b.getItem(CHAVE_SEGUIR_ASSIM)!))
  assert.equal(guardados.length, MAXIMO_LEMBRADOS)
  assert.equal(seguiuAssim(b, 'ep_0'), null)
  assert.equal(seguiuAssim(b, `ep_${MAXIMO_LEMBRADOS + 4}`), 'sem')
  // Lembrar de novo um antigo o traz para o fim (nao sai no proximo corte).
  lembrarSeguirAssim(b, 'ep_5', 'fraco')
  lembrarSeguirAssim(b, 'ep_novo', 'sem')
  assert.equal(seguiuAssim(b, 'ep_5'), 'fraco')
}

// ------------------------------------- 6. os casos reais, so leitura
{
  const bib = 'G:/Dangai Recap/Biblioteca'
  const nia = `${bib}/Nia Liston The Merciless Maiden/S01E01/episodio.json`
  const mrm = `${bib}/Magic Repo Man Dumped by My Party Ill Cash In With a Cute Support Fairy to Become the Strongest/S01E02/episodio.json`
  if (existsSync(nia)) {
    const a = avisoDeReconhecimento(JSON.parse(readFileSync(nia, 'utf8')) as EpisodeIndex)
    assert.equal(detalheDoAviso(a!), 'Reconhecimento pulado: 0 de 432 planos')
  }
  if (existsSync(mrm)) assert.equal(avisoDeReconhecimento(JSON.parse(readFileSync(mrm, 'utf8')) as EpisodeIndex), null)
  console.log(`casos reais: ${existsSync(nia) ? 'Nia E01 ok' : 'Nia E01 ausente'}, ${existsSync(mrm) ? 'MRM E02 ok' : 'MRM E02 ausente'}`)
}

console.log('v-aviso-reconhecer: ok')

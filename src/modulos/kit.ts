/**
 * O KIT DE INTERFACE dos modulos: as pecas do painel do Dangai que um modulo
 * pode usar para parecer parte do app. Como a fachada (./nucleo), e o que o
 * nucleo promete manter -- importe daqui, e nao de '@/components/painel'.
 */
export { Botaozinho, Chip, Deslizante, Field, Grupo, Linha, Segmentos, type Segmento } from '@/components/painel'
/** A onda da narracao (a mesma da linha do tempo): o tocador da voz do recap. */
export { Waveform } from '@/components/Waveform'
/**
 * A chave do Gemini das Configuracoes (campo, Salvar, Testar) e o link da
 * chave gratis: a boas-vindas do recap pede a chave sem abrir as
 * Configuracoes. Fora delas, `testarAoSalvar` (so grava a que vale) e `focar`.
 */
export { ChaveDoGemini, LINK_DA_CHAVE_DO_GEMINI } from '@/components/ChaveDoGemini'

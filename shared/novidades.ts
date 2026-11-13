/**
 * O QUE MUDOU, versao por versao, do jeito que quem usa entende.
 *
 * Aparece numa janelinha na primeira vez que o Dangai abre depois de
 * atualizar (src/components/Novidades.tsx). Antes, a versao nova chegava e
 * ninguem sabia o que tinha de diferente.
 *
 * TODA VERSAO PUBLICADA TEM UMA ENTRADA AQUI, a mais nova em cima -- o teste
 * (scripts/teste/v-novidades.ts) confere que a do package.json esta na lista,
 * e o GitHub nao publica sem ele passar. Versao sem nada visivel (so conserto
 * por dentro) entra com `itens: []`: a janelinha nao abre por ela.
 *
 * Escreva para quem usa: o que muda na tela, sem nome de arquivo nem jargao.
 */

export interface Novidade {
  versao: string
  itens: readonly string[]
}

export const NOVIDADES: readonly Novidade[] = [
  {
    versao: '2.8.1',
    itens: [
      'Gerar recap, Voz: o "Cortar pausas" ganhou o modo Justo (o novo padrão), que corta pausas a partir de 0,18 s e deixa só 0,08 s. O ritmo fica de short. O Normal continua como antes.',
      'Gerar recap, Voz: dá para importar mais de um áudio de uma vez, como o gancho e o resto. Solte ou escolha os dois: o app emenda na ordem do nome ("1 gancho", "2 resto"), e o "Inverter a ordem" troca se precisar.',
      'Gerar recap, Roteiro: a imagem ao lado de cada frase agora diz MOMENTO. Ela é só o momento do episódio, não a cena final. O gancho vira 2 ou 3 cenas no passo Cenas.',
    ],
  },
  {
    versao: '2.8.0',
    itens: [
      'Thumbnail com modelos: deixe a thumb do seu jeito e clique em "Salvar modelo" (no alto do painel). Um clique aplica o mesmo visual em outra thumb: estilo, cores, fonte, contorno, sombra, tamanho, divisor e seta. O texto e as imagens ficam. Depois de aplicar aparece um "Desfazer".',
      'Sombra do texto na Thumbnail: o slider "Sombra", embaixo do Contorno. 0 tira a sombra, 100% é a do estilo e 200% é o dobro.',
      'Seta livre na Thumbnail: em Seta > Posição, escolha "Livre". Arraste a seta inteira na prévia para onde quiser (sem as bolinhas), a rodinha em cima dela muda o tamanho, e o painel tem Tamanho, Giro e Espelhar.',
      'Seletor de cor novo, no jeito do app: quadrado de cor, faixa de matiz, código, conta-gotas (pega uma cor de qualquer lugar da tela) e as cores usadas há pouco. Vale na Thumbnail e na cor da legenda.',
    ],
  },
  {
    versao: '2.7.0',
    itens: [
      'Filmes na Biblioteca: as cenas dos filmes que o AnCut cortou entram junto com as dos animes, marcadas como "Filme · 2010". Busque pelo nome do filme ou por "filme". O Dangai acha sozinho a pasta "Filmes\\Corte de Filmes" ao lado da biblioteca; para usar outra, vá em Configurações > Filmes cortados. Na primeira vez a Biblioteca demora um pouco mais, criando as miniaturas do filme.',
      'Soltar no cartão certo da tela inicial: arraste a narração em cima de Anime ou Mangá e o cartão acende, dizendo o que vai acontecer. No Vídeo pronto, soltar o vídeo abre para legendar; soltar em cima do Upscale melhora o vídeo direto, sem abrir a janela de escolher.',
    ],
  },
  {
    versao: '2.6.2',
    itens: [
      'Mudar a ordem das cenas voltou a funcionar: sem nenhum bloco escolhido (aperte Esc), arraste as cenas da fila no alto. Clicar sem arrastar abre o bloco daquela cena. Na 2.5.0, só de apertar o mouse o bloco abria e a fila sumia antes de dar para arrastar.',
      'Tela menor: com um áudio escolhido, o volume e os fades não ficam mais por cima do tempo e dos botões da linha do tempo. Quando não cabem, eles descem para uma linha própria.',
      'O preview de cima a baixo agora aparece para todo mundo. Quem já tinha arrastado alguma divisória continuava com o preview ao lado do bloco. Para voltar ao jeito antigo, use o botão de layout no alto.',
    ],
  },
  {
    versao: '2.6.1',
    itens: [
      'Thumbnail: clique com o botão direito numa sugestão para "Copiar imagem" (e dar Ctrl+V onde quiser) ou "Salvar imagem como..." (PNG ou JPG). Sai o quadro inteiro, em tamanho cheio.',
      'Thumbnail: o Rasgo com brilho ganhou o controle Brilho, no Divisor. Subindo, o brilho em volta fica maior e mais claro e o meio do rasgo menos escuro. Em 0 fica como antes.',
    ],
  },
  {
    versao: '2.6.0',
    itens: [
      'Legenda sem vírgula: no Estilo da legenda, em Pontuação, escolha "Só ? ! %". Some a vírgula, o ponto, as reticências, as aspas e o travessão do que aparece no vídeo; pergunta, exclamação e porcentagem ficam. O roteiro não muda: os cortes de cena continuam os mesmos.',
      'Legenda maior: o Tamanho agora vai até 300%. E a palavra comprida não encolhe mais à toa: ela só diminui se fosse sair pela borda da tela.',
    ],
  },
  {
    versao: '2.5.0',
    itens: [
      'Editor mais limpo: a barra de botões foi para o alto da janela, separada em grupos, e o Renderizar ficou em destaque. O play fica ao lado do tempo, na linha do tempo.',
      'Preview de cima a baixo, como no DaVinci: ele ocupa a direita inteira e a linha do tempo encolhe para caber, então o vídeo aparece bem maior. Para voltar ao jeito antigo, use o botão de layout no alto (o quadradinho ao lado do Upscale).',
      'Painéis em colunas: Enquadramento, Movimento e Ritmo do bloco ficam lado a lado, cada um no seu cartão, com sliders e gráficos menores. Na camada de ajuste, as Curvas, a Luz e a Cor e o Transform também ganharam colunas próprias.',
      'Câmera livre mais clara: o começo e o fim ficam lado a lado, e o enquadramento, que não vale com a câmera ligada, vira um recado curto.',
      'Com um bloco escolhido, a fila de miniaturas de cima some (ela repetia a linha do tempo); sem nada escolhido, ela volta. Esc solta o que está escolhido, e a coluna do bloco não aparece mais enquanto você mexe na camada de ajuste.',
      'O botão Música saiu da barra de cima. A Edição rápida continua pondo a música.',
    ],
  },
  {
    versao: '2.4.0',
    itens: [
      'Voltar ao Áudio não bagunça mais o vídeo: com as cenas já na timeline, tire o Fresh Air, mude um efeito, corte uma respiração ou mude a velocidade e dê "Pronto". Só o som troca. As transições, os ajustes de cada bloco, a seleção de cenas e as legendas ficam como você deixou, e tudo anda junto com a voz nova. Você volta direto para a timeline.',
      'Tela inicial nova, separada por nicho: Anime, Mangá, Vídeo pronto e Módulos, cada um com o que é dele. Soltar a narração continua sendo o começo de tudo, e o formato (Short ou Long form) fica no alto.',
      'Mangá no caminho de sempre: solte a narração, edite o áudio e, na etapa do Roteiro, solte o .txt do resumo (o botão "Salvar .txt" do Resumo de mangá). Os quadrinhos de cada frase vêm junto e a Biblioteca abre direto no capítulo. Os roteiros que o Resumo escreveu também aparecem ali para usar com um clique.',
      'Roteiro de mangá escrito fora do Dangai: na etapa do Roteiro, marque os capítulos antes de soltar o texto, e a IA escolhe os quadrinhos de cada frase enquanto a legenda sincroniza.',
      'Curvas na animação: na camada de ajuste (e nos clipes da faixa de vídeo), o "Ritmo" ganhou "Curva", com o gráfico para desenhar à mão e curvas prontas, inclusive as que passam do ponto e voltam. A curva vale para todas as passagens ou só para a passagem entre duas chaves onde a agulha está.',
      'Som do Pan: ao pôr a transição Pan, o som agora entra numa faixa de áudio e toca no preview e no vídeo. Antes ele ia para um lugar que não tocava. Dois Pans perto um do outro ganham um som cada.',
    ],
  },
  {
    versao: '2.3.0',
    itens: [
      'Resumo de mangá: na tela inicial (ou no Ctrl+K), escolha os capítulos da sua pasta de mangás. A IA lê as páginas e escreve o roteiro no seu jeito, e cada frase já vem com os quadrinhos que mostram o que ela conta. A primeira leitura de um capítulo leva 1 ou 2 minutos; depois fica guardada.',
      'Você corrige o roteiro ali mesmo: muda o texto, apaga ou cria frases (Enter abre a próxima) e troca os quadrinhos de cada frase no "+", que mostra o capítulo inteiro em ordem. "Copiar" leva o roteiro para gravar. Dá para fechar o Dangai no meio: o rascunho fica guardado.',
      'Gravou? Solte a narração na mesma tela. O projeto nasce com o título como nome, e depois de Áudio e Roteiro as cenas de cada trecho já chegam marcadas com os quadrinhos. A Biblioteca abre no capítulo, para trocar o que quiser, e é só montar.',
      'Os roteiros que você grava ficam como exemplo, e os próximos resumos saem mais parecidos com o que você aprovou.',
    ],
  },
  {
    versao: '2.2.1',
    itens: [
      'Cenas atrasadas depois de refazer o áudio: se você deu "Pronto" no Áudio, voltou, acelerou (ou cortou) e deu "Pronto" de novo, as frases eram sincronizadas com os tempos da narração anterior, e as cenas iam ficando cada vez mais atrasadas em relação à voz. Agora cada narração nova é ouvida de novo.',
      'Projeto que já ficou assim: ao abrir, o Dangai avisa e oferece "Acertar os tempos". Ele ouve a narração de agora e leva as frases, as cenas, as legendas e os sons para o tempo certo, sem trocar nenhuma cena escolhida. Também tem o comando "Acertar os tempos das cenas com a narração" no Ctrl+K.',
    ],
  },
  {
    versao: '2.2.0',
    itens: [
      'Efeitos do trecho funcionando: escolher Bip, Voz fina, Robô e os outros agora já muda o som do play. Antes, o play continuava tocando o som de antes até você cortar alguma coisa.',
      'Som automático no Pan: pôs a transição Pan numa emenda, o Flash Swoosh entra sozinho na faixa de SFX, com o ponto mais forte dele bem no corte. Trocar o Pan de lado não duplica, e tirar o Pan tira o som. O arquivo fica em Configurações > Som da transição Pan, onde dá para trocar ou desligar.',
    ],
  },
  {
    versao: '2.1.0',
    itens: [
      'Fresh Air ao vivo: com a janela do plugin aberta, o que você mexe (os presets, o Mid Air, o High Air) já vale no play, um ou dois segundos depois. Antes, só valia depois de fechar a janela. Na primeira vez, o Dangai baixa de novo o leitor de plugins (23 MB).',
      'O plugin fica: adicionou o Fresh Air uma vez, ele fica no seu padrão, com o preset que você deixou. As próximas gravações já começam com ele.',
      'Solte um áudio na faixa que quiser: ele entra na faixa e no instante onde você soltou, sem cortar nada. Se o lugar estiver ocupado, vai para a próxima faixa livre.',
      'Tecla B, como no DaVinci: corta na agulha e junta no último corte, tirando o pedaço entre os dois. Também tem o botão "Juntar".',
      'Efeitos de piada e de censura: escolha um trecho e, em "Efeito", ponha Bip, Silêncio, Voz fina, Voz grossa, Robô, Eco, Rádio ou Ao contrário. O trecho fica rosa e não muda de tamanho.',
      'Exportar áudio: o botão em cima grava o áudio editado (cortes, efeitos e velocidade) onde você escolher, em WAV ou MP3, sem sair da etapa.',
      'A linha do tempo do Áudio ficou lisa: o zoom não trava nem pisca mais, e com bastante zoom a régua mostra os décimos de segundo.',
      'Thumbnail direto do editor: o botão "Thumbnail" na barra do editor abre a tela da thumbnail já com o projeto aberto. Depois do render, ele fica aceso.',
    ],
  },
  {
    versao: '2.0.1',
    itens: [
      'Áudio: a agulha não pula mais para o começo. Depois de cortar ou mexer num trecho, o som é refeito, e dar play (ou estar tocando) nesse momento levava a agulha para o zero. Agora ela continua de onde estava.',
    ],
  },
  {
    versao: '2.0.0',
    itens: [
      'Faixas de áudio, como no DaVinci: a etapa de Áudio agora tem A1, A2 e mais. Arraste um trecho para mudar de lugar ou de faixa, puxe a borda para aparar, e o que está em faixas diferentes no mesmo instante toca junto. Os efeitos valem para tudo. O ímã (N) gruda o trecho na ponta dos outros e na agulha.',
      'Apagar: Delete tira o trecho e fecha o vão (o que vem depois anda para trás, em todas as faixas); Backspace tira e deixa o vão. Ctrl+clique escolhe mais de um trecho, e eles andam juntos. Seus projetos de antes abrem com tudo na A1, do jeito que estavam.',
      'Velocidade na linha do tempo: escolher 115% encolhe tudo na hora, e a régua e o relógio mostram o tempo final do vídeo. A velocidade agora fica em cima das faixas.',
      'Fresh Air: a janela do plugin abre no meio da tela, por cima do Dangai, e fecha pelo X dela ou pelo botão "Fechar" do Dangai. Ela também fecha sozinha ao sair da etapa ou fechar o Dangai. Na primeira vez, o Dangai baixa de novo o leitor de plugins (23 MB).',
      'A etapa de Áudio ficou mais leve: a agulha anda sem travar a tela, o espaço não toca e pausa ao mesmo tempo quando um botão está selecionado, e a onda mostra as palavras e as pausas.',
      'O vídeo renderizado sai sem assinatura de programa: os metadados não dizem mais "Made with Remotion", nem o nome das ferramentas usadas para montar o arquivo. A imagem e o som continuam exatamente iguais. Os vídeos renderizados antes desta versão ainda têm essa marca: renderize de novo os que for publicar.',
    ],
  },
  {
    versao: '1.100.0',
    itens: [
      'Velocidade do Áudio sem voz robótica: na 1.99, a narração acelerada saía com um som sintético depois do "Pronto". Agora ela é acelerada do mesmo jeito que o preview toca, e o que você ouve na etapa de Áudio é o que vai para a timeline. O tom continua o mesmo.',
      'Já acelerou uma narração na 1.99? Volte na etapa de Áudio e clique em "Pronto" de novo para gravar a versão sem o efeito.',
    ],
  },
  {
    versao: '1.99.0',
    itens: [
      'Velocidade no Áudio, sem mudar o tom: no painel dos efeitos, escolha 110%, 115% ou 120% (ou digite outro número, de 50% a 200%). É como o Change Clip Speed do DaVinci com o Pitch Correction ligado: a fala fica mais rápida e a sua voz continua com o mesmo tom, sem a vozinha fina.',
      'O preview já toca na velocidade escolhida, e o "Pronto" grava a narração acelerada. O "Salvar como meu padrão" guarda a velocidade também. Na primeira vez, o Dangai baixa de novo o leitor de plugins (23 MB), que agora faz a aceleração.',
    ],
  },
  {
    versao: '1.98.0',
    itens: [
      'Pasta dos projetos: soltou a narração, o Dangai pergunta o nome do projeto e já salva em Documentos > Dangai > Projetos. Nome repetido vira "nome (2)", nunca por cima de outro. A pasta muda nas Configurações, com um botão para abri-la.',
      'Salvar sozinho: com o projeto criado, cada mudança é gravada no próprio arquivo um segundo depois de você parar de mexer. O Ctrl+S continua funcionando. Se você disser "Agora não" ao nome, vale a cópia de segurança de antes ("Continuar de onde parou").',
      'Limpeza depois do render: o projeto é salvo e os arquivos de trabalho da etapa de Áudio são apagados (a gravação e a narração pronta ficam). As cópias das cenas preparadas para o vídeo saem quando você fecha o Dangai; as que sobraram de versões antigas saem sozinhas na abertura. Voltar ao Áudio refaz o que precisar.',
    ],
  },
  {
    versao: '1.97.0',
    itens: [
      'Correções no Áudio: regravou um pedaço? Selecione o trecho ruim e clique em "Importar correção" (ou solte o arquivo na tela): a correção entra no lugar dele, em azul, e passa pelos mesmos efeitos. Sem seleção, ela entra na agulha. O que sobrar dela, corte com C e Delete.',
      'Navegar no Áudio como na linha do tempo do editor: arraste a agulha pela régua de cima, Ctrl ou Alt + roda para dar zoom onde o mouse está, e o botão do meio (a rodinha pressionada) arrasta a vista.',
    ],
  },
  {
    versao: '1.96.0',
    itens: [
      'Barra de etapas no topo: Áudio → Roteiro → Cenas → Edição. A etapa feita ganha um ✓ e dá para ir a qualquer uma. Na barra do editor, os botões "Roteiro" e "Seleção" viraram as etapas "Roteiro" e "Cenas".',
      'Etapa do Roteiro: depois do áudio, solte o .txt (ou cole, ou siga sem roteiro) e a sincronia das legendas começa sozinha. Bateu com a voz, ela segue sozinha para as cenas; não bateu, ela para e avisa.',
      'As músicas no preview tocam exatamente o que a onda mostra. Antes, em MP3 de taxa variável, o preview pulava para o lugar errado (até 3 s antes); o vídeo final sempre esteve certo.',
    ],
  },
  {
    versao: '1.95.0',
    itens: [
      'Etapa de Áudio: solte a gravação crua e ela abre numa linha do tempo antes de tudo. Espaço toca, C corta, arrastar seleciona, Delete apaga fechando o buraco, Ctrl+Z desfaz, e cada trecho tem o próprio volume. "Cortar silêncios" encolhe todas as pausas longas de uma vez.',
      'Os efeitos da voz, na ordem: Isolar a voz (IA, como o Voice Isolation do DaVinci), Nivelar a voz (como o Dialogue Leveler), EQ, Compressor, plugins VST3 — o Fresh Air entra com a janela dele — e Normalizar. "Com efeitos / Sem efeitos" compara, e "Salvar como meu padrão" faz toda gravação nova já começar assim.',
      '"Pronto" grava a narração final ao lado da gravação ("nome (editado).wav") e abre a Biblioteca. Para voltar e mexer depois: o botão "Áudio" na barra de baixo. A IA de limpeza (27 MB) e o leitor de plugins (23 MB) são baixados na primeira vez.',
    ],
  },
  {
    versao: '1.94.1',
    itens: [
      'Vídeos de B-roll do AnCut HUB (trailer, gameplay, teaser baixado por link) aparecem na Biblioteca com o nome do vídeo, depois dos episódios do anime. Dá pra buscar e escolher na mão, mas a montagem automática não usa mais cena de trailer como se fosse de um episódio.',
    ],
  },
  {
    versao: '1.94.0',
    itens: [
      'Thumbnail: "Cor das imagens". Puxe a cor da camada de ajuste do projeto ("Do projeto"), use o Anime vivo ou um preset de cor seu, e ajuste exposição, contraste, saturação, vibrance, temperatura e nitidez. A cor vale só nas imagens: texto, seta e divisor ficam como estão.',
      'Thumbnail: cole uma imagem com Ctrl+V (ou no botão "Colar"). Vale print, "Copiar imagem" do navegador ou um arquivo copiado no Explorer.',
      'Thumbnail: no botão "Pasta..." você escolhe onde as thumbs são salvas. A pasta fica lembrada, e o "Salvar PNG" grava direto nela. Em "Padrão" volta ao lugar de sempre.',
    ],
  },
  {
    versao: '1.93.1',
    itens: [
      'IA do Gemini no automático: quando a cota grátis acaba e ele troca de modelo, não cai mais num modelo que só transcreve áudio (o "transcribe"). Antes ele ficava preso nele e tudo dava "Developer instruction is not enabled for this model" até fechar o app; agora pula para o próximo.',
    ],
  },
  {
    versao: '1.93.0',
    itens: [
      'Thumbnail: o texto ganhou "Estilo", com três presets: Kizuni (o de sempre), Faah (branco e roxo com o degradê dele, contorno fino, sombra curta e a seta roxa) e AJK (branco e amarelo chapados, contorno fino e a seta de pincel). Escolher um aplica tudo; depois dá para mexer em cada coisa.',
      'Contorno do texto: escolha a grossura (de 0, sem contorno, até 30) e a cor.',
      'Degradê próprio: cada linha pode ter as duas cores do degradê, a de cima e a de baixo.',
      'Fonte do PC: "Buscar fonte do PC" lista as fontes instaladas no Windows pelo nome. A Poppins Black também entrou nas fontes do app.',
      'Seta: além da vermelha, a roxa do Faah e a de pincel do AJK, sempre no formato do desenho original (só tamanho, giro e espelho).',
    ],
  },
  {
    versao: '1.92.1',
    itens: [
      'Thumbnail: com o Slash (ou o Rasgo) entre as duas imagens, a imagem de baixo não aparece mais por cima dele. O Slash é torto e curvo, e a emenda das imagens agora segue o meio dele de ponta a ponta, reto ou inclinado.',
    ],
  },
  {
    versao: '1.92.0',
    itens: [
      'Legenda editável na linha do tempo: clique numa legenda para escolher, arraste para mover e puxe as pontas para mudar a duração. C corta na agulha, Delete apaga e Ctrl+Z desfaz. Bom para quando o efeito na voz confunde o Whisper.',
      'Um "plim" quando o render termina (na fila, um só no fim). Para desligar: Configurações > Quando o render termina.',
      'Setas e emojis em .mov na faixa de vídeo: o preview não trava mais ao pular a agulha dentro deles, o que acontecia muito ao animar. Os que já estavam no projeto são preparados de novo uma vez.',
    ],
  },
  {
    versao: '1.91.1',
    itens: [
      'Legendar vídeo pronto não fica mais parado em "Distribuindo as cenas...": com o vídeo inteiro num bloco só, o app não pergunta nada à IA e vai direto do Whisper para as legendas.',
    ],
  },
  {
    versao: '1.91.0',
    itens: [
      'Soltou a narração (e o roteiro) sem nenhuma cena? A Biblioteca abre direto, na primeira frase. Se fechar sem escolher, o botão "Escolher na biblioteca" fica no lugar para voltar.',
      'Saíram o "Montar tudo", o "Montar recap" e o "Montar teoria". As cenas agora são sempre escolhidas por você na Biblioteca. O B-roll continua valendo para as sugestões.',
    ],
  },
  {
    versao: '1.90.1',
    itens: [
      'Gerar recap: o roteiro não é mais gerado sozinho ao abrir o episódio. O passo do roteiro abre com "Meu roteiro" (colar o seu) e "Gerar roteiro" (a IA escreve), e nada gasta cota até você escolher. Quem prefere o jeito antigo liga "Gerar roteiro sozinho" em Configurações > Roteiro do recap.',
    ],
  },
  {
    versao: '1.90.0',
    itens: [
      'Mangá na Biblioteca: ponha os capítulos em D:\\Mangás, uma pasta por anime e uma por capítulo, com as páginas do jeito que você baixa. O Dangai recorta os quadrinhos sozinho e mostra cada página seguida dos quadrinhos dela, em "Bleach > Mangá · Capítulo...". A sua pasta fica como está. Para usar outra pasta: Configurações > Mangás.',
      'Quadrinho deitado entra no vídeo inteiro, sobre ele mesmo desfocado, em vez de cortar dois terços dele. Câmera livre, zoom, giro e o resto continuam valendo como em qualquer cena.',
      'No bloco, "Mostrar a imagem inteira" liga e desliga isso em qualquer imagem, inclusive nos prints.',
      'Mangá nunca entra sozinho na montagem automática: só quando você escolhe.',
    ],
  },
  {
    versao: '1.89.1',
    itens: [
      'Edição rápida: os efeitos sonoros tocam inteiros, sem cortar o começo nem o fim (o sino e o impacto deixam a cauda soar). Cada um continua sincronizado no corte pelo ataque ou pelo pico. Só os golpes de um pacote com vários (o de espadas) são separados, e saem com fade.',
    ],
  },
  {
    versao: '1.89.0',
    itens: [
      'Edição rápida: a música entra no momento certo. O app acha pela onda onde cada música "entra" (o drop) e faz esse ponto cair no corte do gancho para o contexto, junto com o pico do riser. Durante o gancho toca o trecho calmo que vem antes do drop.',
      'A música muda quando o clima do roteiro muda (ação, épica, sentimental, romance, suspense, comédia, calma): entra outra música daquele clima, já no drop dela, com o riser curto e o impacto. Se a pasta de SFX tiver um "tape stop" ou "record scratch", ele entra quando o clima cai para algo calmo.',
      'O clima de cada música vem da subpasta (crie pastas como "acao", "sentimental", "romance", "epica" dentro da pasta de músicas) ou, para as soltas, de um palpite da IA pelo nome, feito uma vez por música.',
    ],
  },
  {
    versao: '1.88.2',
    itens: [
      'Edição rápida: o "Cartoon Bounce (OPPAI)" vira o som de peito balançando (quando a fala cita decote, seios, oppai...), e não abre mais o vídeo. A abertura fica com o cartoon pop.',
      'O "among us" vira o som de suspeito (suspeita, traidor, impostor, mentira), e o sino passa a contar como impacto.',
    ],
  },
  {
    versao: '1.88.1',
    itens: [
      'Edição rápida do recap: o vídeo sempre abre com um som (o cartoon pop, se a pasta de SFX tiver; senão um impacto), e a saída do gancho leva um riser com o pico no corte.',
      'No clímax entra o riser curto (com "sharp" no nome) junto do impacto.',
      'Sons de tema: quando a fala logo depois de uma virada cita espada, soco, magia, foto, sino, revelação e outros, entra o som daquele assunto no lugar do whoosh. Basta o nome do arquivo dizer o assunto (ex.: "sword slash"). Um arquivo com vários golpes é separado sozinho, e cada virada usa um golpe diferente.',
      'Cada som entra no momento certo pela onda: o pico do whoosh, do riser e do golpe cai no corte, e o ataque do impacto bate em cima dele.',
    ],
  },
  {
    versao: '1.88.0',
    itens: [
      'Montagem com B-roll: corrigido o que fazia ela pegar cenas sem nada a ver. Um B-roll com "Temporada 2 — ..." em cima dos episódios agora busca mesmo na 2ª temporada, e uma observação no fim do B-roll não puxa mais metade do vídeo para o último episódio.',
      'A montagem e as sugestões da Biblioteca só usam o anime do vídeo e os da mesma franquia (o Cyberpunk 2077 junto do Edgerunners, as aberturas junto do Bleach). Uma palavra comum como "cruel" não vira mais personagem de outro anime.',
      'O D, do Cyberpunk, agora é reconhecido no roteiro.',
    ],
  },
  {
    versao: '1.87.5',
    itens: [
      'Configurações > Voz do recap: escolha primeiro ElevenLabs ou Fish Audio, depois a voz e o modelo daquele serviço (Multilingual v2, Eleven v4, Flash v2.5, Eleven v3; S2.1 Pro, S2.1 Pro grátis, S2 Pro, S1). Cada um lembra a sua voz: trocar de um para o outro e voltar devolve a que estava.',
      'A lista de vozes carrega sozinha ao abrir, sem precisar clicar em "Testar".',
      'Saiu o "Trazer do AniRecap Studio".',
    ],
  },
  {
    versao: '1.87.4',
    itens: [
      'Gerar recap: todos os personagens ganham as fotos da galeria do MyAnimeList, e não só os 18 principais. No Black Clover, a Vanessa foi de 1 para 7 fotos e a Zora de 1 para 6. Os elencos já guardados buscam essas fotos uma vez, na próxima análise (no Black Clover, uns 2 minutos).',
      'O filtro de mangá não joga mais fora a arte colorida com fundo branco (como a imagem oficial do personagem). As que ele tinha descartado por engano voltam sozinhas. Página de mangá continua de fora.',
    ],
  },
  {
    versao: '1.87.3',
    itens: [
      'Gerar recap: o elenco e as fotos do MyAnimeList vêm direto do site dele. O Jikan, que parou de funcionar, saiu, e a análise não fica mais esperando por ele.',
      'Mais personagens reconhecidos: cada um ganha também a foto da AniList, procurada em todas as temporadas e filmes do anime, e não só no primeiro. No Black Clover, os personagens com uma foto só (abaixo do mínimo para reconhecer) caíram de 71 para 13. Os elencos já guardados ganham essas fotos sozinhos na próxima análise.',
    ],
  },
  {
    versao: '1.87.2',
    itens: [
      'Gerar recap: quem você já reconheceu no AnCut passa a ser reconhecido também nos episódios cortados pelo motor do Dangai. A cada corte, o Dangai pega do AnCut as fotos de quem ele ainda não conhecia. Quem ele já reconhecia continua igual.',
    ],
  },
  {
    versao: '1.87.1',
    itens: [
      'Gerar recap: quando o corte pelo AnCut para por falta de fotos do elenco, aparece o botão "Reconhecer na mão". O recap corta o episódio de novo na biblioteca dele, junta os rostos parecidos e você dá o nome de cada personagem. Antes o botão sumia e não tinha o que fazer.',
    ],
  },
  {
    versao: '1.87.0',
    itens: [
      'Legenda: botão "centralizar" ao lado do "voltar ao padrão" da Altura. Põe a legenda bem no meio da tela, sem precisar arrastar no olho.',
      'Thumbnail: "Rotação" do texto (de -15 a +15 graus). As duas linhas giram juntas, e a sombra continua caindo reta, como no Photoshop.',
      'Thumbnail: a seta tem sempre o formato da seta padrão (corpo grosso e ponta larga). O app só aumenta, gira ou espelha, nunca estica.',
      'Thumbnail: "Inclinação" da emenda e do divisor. A imagem de cima e a de baixo passam a se encontrar numa linha inclinada, e o divisor acompanha de ponta a ponta. O botão "= texto" usa o mesmo ângulo do texto.',
    ],
  },
  {
    versao: '1.86.0',
    itens: [
      'Thumbnail: divisor entre a imagem de cima e a de baixo (Rasgo com brilho, Rasgo, Slash ou Linha), com a cor que você quiser. Ele fica por cima das imagens e por baixo do texto.',
      'Thumbnail: "Tamanho do texto" de 70% a 150%. A linha longa cresce até o limite da largura e avisa quando chegou lá.',
      'Thumbnail: a seta fica sempre grande; quando o texto é largo, ela passa por trás da primeira letra e aponta para o rosto.',
      'Thumbnail: quadros com faixa preta de cinema perdem a faixa, e a imagem sempre cobre o espaço inteiro, sem sobrar fundo preto.',
    ],
  },
  {
    versao: '1.85.0',
    itens: [
      'Thumbnail: novo botão na tela inicial (ligue em Configurações > Módulos). Faz a capa 1080x1920 sem precisar do Gerar recap: suba as imagens do computador, ou escolha um projeto e pegue os quadros das cenas, sempre sem legenda.',
      'Na thumbnail, a barra "Quadro dentro da cena" deixa escolher qualquer quadro do mesmo clipe, quadro a quadro.',
      'Texto longo na thumbnail: a linha comprida encolhe sozinha sem passar por cima da outra, e as quatro fontes ficam alinhadas no mesmo lugar.',
    ],
  },
  {
    versao: '1.84.0',
    itens: [
      'Ler cenas do B-roll: com um B-roll aberto, o botão "Ler cenas do B-roll" (em cima, na Biblioteca) faz uma IA olhar cada cena dos episódios dele e escrever o que acontece nela. Roda no seu PC, de graça, pelo Ollama.',
      'Com as cenas lidas, as sugestões e o "Montar tudo" acham a cena certa dentro do episódio, e não só o episódio certo: "Uryu virou médico" traz a cena do consultório. Passe o mouse numa sugestão para ver o que a IA viu nela.',
      'A leitura leva uns 3 segundos por cena (um episódio, uns 25 minutos) e só é feita uma vez: o que foi lido fica guardado. O mesmo botão para a leitura, e na próxima vez ela continua de onde parou.',
    ],
  },
  {
    versao: '1.83.1',
    itens: [
      'Gerar recap: a tela "Vídeo pronto" ganhou a aba Thumbnail. Uma ou duas imagens (em cima e embaixo, com o botão ⇅ para inverter), texto em duas linhas na fonte Luckiest Guy com contorno e sombra, seta apontando o rosto, e "Salvar PNG" em 1080x1920 ao lado do vídeo.',
      'As imagens vêm das cenas do vídeo (as do gancho primeiro), de qualquer quadro do vídeo (sempre sem a legenda) ou do seu computador. Cada uma já entra enquadrada pelo rosto, fora das faixas que o TikTok cobre; dá para ajustar com zoom e arrastando.',
      'Você muda o texto, as cores, a fonte e a altura do texto. O PNG passa pelo upscale do Dangai e fica nítido. Tudo fica salvo no projeto.',
    ],
  },
  {
    versao: '1.82.0',
    itens: [
      'B-roll: solte o .txt do B-roll junto da narração e do roteiro (qualquer nome). O Dangai lê de que episódio sai cada parte do vídeo, e o "Montar tudo", o "Montar recap" e as sugestões da Biblioteca passam a preferir as cenas desses episódios.',
      'Na Biblioteca, cada frase mostra o episódio que o B-roll dá para ela, e o botão "Episódio 48 do B-roll" abre o episódio inteiro na grade. Para tirar o B-roll, clique no X ao lado dele.',
      'Se o B-roll pedir um episódio que ainda não foi cortado no AnCut, o Dangai avisa qual é.',
      'Marcar uma cena na Biblioteca não pula mais sozinho para a próxima frase. Para ir à próxima frase vazia, aperte Tab.',
    ],
  },
  {
    versao: '1.81.0',
    itens: [
      '"Do meu jeito" (barra de baixo): o Dangai aprendeu com os seus vídeos como você edita o som e a cor, e faz igual com um clique: a abertura (Illuminati / Return By Death), a música de fundo, os whooshes, stingers, shutters e risers nos cortes, e a sua camada de cor. Tudo editável, e Ctrl+Z desfaz tudo de uma vez.',
      'Ele continua aprendendo: cada vídeo que você salva entra na conta. Passe o mouse no botão para ver o que ele aprendeu.',
      '"Montar tudo": solte a narração e o roteiro e clique uma vez. Ele escolhe uma cena para cada frase e já põe os sons e a cor do seu jeito. Você só revisa.',
      'Uma cena da Biblioteca que não abre (vídeo preto ou estragado) não derruba mais a montagem: ele usa a próxima sugestão no lugar e avisa qual foi.',
    ],
  },
  {
    versao: '1.80.0',
    itens: [
      'Biblioteca por roteiro: ela já abre no anime do roteiro, mesmo quando um nome de personagem existe em dois animes (a "Lucy" de Cyberpunk e a de Mushoku Tensei). Para ver tudo, clique em "Todos".',
      'Marcou a cena que cobre a frase, o Dangai pula sozinho para a próxima frase vazia. Para pôr mais uma cena na mesma frase, é só clicar de volta nela.',
      'Primeira vez no Dangai: a tela inicial oferece baixar de uma vez o que ele usa no primeiro vídeo (transcrição, sincronizador de legendas e o navegador do render), em vez de parar no meio do trabalho.',
      'O preview não dá mais aquele erro escondido de áudio a cada play.',
    ],
  },
  {
    versao: '1.79.0',
    itens: [
      'Biblioteca: agora dá para favoritar uma cena que já está marcada. Antes, clicar na estrela de uma cena escolhida desmarcava a cena.',
    ],
  },
  {
    versao: '1.78.0',
    itens: [
      'O Dangai agora escreve com acento em todas as telas: Configurações, Seleção, Transição, vídeo, áudio, narração...',
      'O botão de avisos na barra de baixo agora diz "8 avisos", e não só "⚠ 8". Clique nele para ver o que conferir antes de renderizar.',
      'Na linha do tempo, o número do bloco não fica mais em cima do vizinho quando o bloco é estreito: ele some ali e aparece ao passar o mouse.',
    ],
  },
  {
    versao: '1.77.0',
    itens: [
      'Assistir em tela cheia: aperte F (ou o botão no canto do preview) para ver o vídeo grande, do tamanho da tela. Espaço toca e pausa; Esc sai.',
      'Copiar relatório: quando aparecer um erro em vermelho lá embaixo, clique em "Copiar relatório" do lado e cole no Discord. Vai junto o que o app anotou antes do erro, e isso ajuda a consertar bem mais rápido. Nenhuma chave de API vai junto.',
      'Esta janelinha: a cada atualização, ela conta o que mudou.',
    ],
  },
]

/** -1, 0 ou 1, comparando "1.76.0" com "1.77.0" numero a numero. */
export function compararVersoes(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** No maximo isto de versoes de uma vez: quem pulou muitas ve as ultimas. */
const MAXIMO_DE_VERSOES = 5

/**
 * O que mostrar ao abrir a `atual`, tendo visto por ultimo a `vista`.
 *
 * - `vista` e a ultima versao que ja abriu aqui; o que veio depois dela ate a
 *   atual (inclusive) aparece;
 * - `vista` null e quem nunca viu a janelinha: se ja usava o Dangai (veio de
 *   uma versao de antes dela), mostra so a atual; se e a primeira vez, nada.
 */
export function novidadesParaMostrar(
  atual: string,
  vista: string | null,
  jaUsava: boolean,
  lista: readonly Novidade[] = NOVIDADES,
): Novidade[] {
  const comItens = lista.filter((n) => n.itens.length > 0)
  if (vista === null) return jaUsava ? comItens.filter((n) => compararVersoes(n.versao, atual) === 0) : []
  return comItens
    .filter((n) => compararVersoes(n.versao, vista) > 0 && compararVersoes(n.versao, atual) <= 0)
    .sort((a, b) => compararVersoes(b.versao, a.versao))
    .slice(0, MAXIMO_DE_VERSOES)
}

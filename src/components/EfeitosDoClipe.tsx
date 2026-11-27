import { useRef } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { medidasDo } from '@shared/contract'
import {
  AREA_PADRAO,
  areaNoQuadro,
  NOME_DO_EFEITO,
  novoEfeito,
  TIPOS_DE_EFEITO,
  type AreaDoEfeito,
  type EfeitoDoClipe,
} from '@shared/efeitos'
import { useProject } from '@/store/project'
import { Botaozinho, Deslizante, Grupo, Linha, Segmentos } from './painel'

/**
 * EFEITOS DO CLIPE (27/11): "tem situacoes que preciso censurar alguma coisa e
 * nao consigo". Desfoque, mosaico e tarja, na tela toda ou so numa area -- a
 * area se arrasta no quadrinho (o canto de baixo a direita muda o tamanho) ou
 * pelos numeros.
 *
 * O mesmo grupo no bloco, no clipe da faixa de video e na camada de ajuste
 * (nessa, censura tudo o que esta embaixo). Ver shared/efeitos.ts.
 */
export function EfeitosDoClipe({
  efeitos,
  onChange,
  dica,
}: {
  efeitos: readonly EfeitoDoClipe[] | undefined
  onChange: (efeitos: EfeitoDoClipe[]) => void
  dica?: string
}) {
  const lista = efeitos ?? []
  const mudar = (id: string, patch: Partial<EfeitoDoClipe>): void =>
    onChange(lista.map((e) => (e.id === id ? { ...e, ...patch } : e)))

  return (
    <Grupo
      titulo="Efeitos"
      dica={dica ?? 'Desfoque, mosaico ou tarja para censurar: na tela toda ou só numa área.'}
    >
      <div className="flex flex-wrap gap-1">
        {TIPOS_DE_EFEITO.map((tipo) => (
          <Botaozinho key={tipo} onClick={() => onChange([...lista, novoEfeito(tipo)])} title={`Pôr ${NOME_DO_EFEITO[tipo].toLowerCase()}`}>
            <Plus size={11} strokeWidth={1.75} />
            {NOME_DO_EFEITO[tipo]}
          </Botaozinho>
        ))}
      </div>
      {lista.length === 0 && <p className="text-[11px] leading-snug text-ink-3">Nenhum efeito neste clipe.</p>}
      {lista.map((e) => (
        <UmEfeito
          key={e.id}
          efeito={e}
          onChange={(patch) => mudar(e.id, patch)}
          onApagar={() => onChange(lista.filter((x) => x.id !== e.id))}
        />
      ))}
    </Grupo>
  )
}

function UmEfeito({
  efeito: e,
  onChange,
  onApagar,
}: {
  efeito: EfeitoDoClipe
  onChange: (patch: Partial<EfeitoDoClipe>) => void
  onApagar: () => void
}) {
  const ligado = e.ligado !== false
  const area = e.area
  return (
    <div data-efeito={e.tipo} className={['flex flex-col gap-2 rounded-md border border-line p-2', ligado ? '' : 'opacity-50'].join(' ')}>
      <div className="flex items-center gap-1.5">
        <span className="flex-1 text-[12px] font-medium text-ink">{NOME_DO_EFEITO[e.tipo]}</span>
        <button
          type="button"
          onClick={() => onChange({ ligado: !ligado })}
          title={ligado ? 'Desligar (sem apagar), para comparar' : 'Ligar de novo'}
          aria-label={ligado ? 'Desligar efeito' : 'Ligar efeito'}
          className="grid size-6 place-items-center rounded-sm text-ink-3 hover:bg-elevated hover:text-ink"
        >
          {ligado ? <Eye size={12} strokeWidth={1.6} /> : <EyeOff size={12} strokeWidth={1.6} />}
        </button>
        <button
          type="button"
          onClick={onApagar}
          title="Tirar o efeito"
          aria-label="Tirar o efeito"
          className="grid size-6 place-items-center rounded-sm text-ink-3 hover:bg-elevated hover:text-danger"
        >
          <Trash2 size={12} strokeWidth={1.6} />
        </button>
      </div>

      {e.tipo === 'tarja' ? (
        <Linha label="Cor">
          <input
            type="color"
            value={e.cor ?? '#000000'}
            onChange={(ev) => onChange({ cor: ev.target.value })}
            aria-label="Cor da tarja"
            className="h-6 w-10 cursor-pointer rounded-sm border border-line bg-elevated"
          />
          <span className="text-[11px] text-ink-3">{(e.cor ?? '#000000').toUpperCase()}</span>
        </Linha>
      ) : (
        <Linha label={e.tipo === 'mosaico' ? 'Quadrados' : 'Força'}>
          <Deslizante
            valor={e.forca}
            min={0}
            max={1}
            step={0.01}
            padrao={0.5}
            texto={`${Math.round(e.forca * 100)}%`}
            onChange={(v) => onChange({ forca: v })}
          />
        </Linha>
      )}

      <Linha label="Onde">
        <Segmentos
          opcoes={[
            { valor: 'tudo' as const, rotulo: 'Tela toda' },
            { valor: 'area' as const, rotulo: 'Uma área' },
          ]}
          ativo={(v) => (v === 'area') === (area !== null)}
          onChange={(v) => onChange({ area: v === 'area' ? (area ?? AREA_PADRAO) : null })}
        />
      </Linha>

      {area && (
        <>
          <AreaArrastavel area={area} onChange={(a) => onChange({ area: a })} tipo={e.tipo} />
          {(
            [
              ['x', 'Esquerda'],
              ['y', 'Topo'],
              ['w', 'Largura'],
              ['h', 'Altura'],
            ] as const
          ).map(([k, rotulo]) => (
            <Linha key={k} label={rotulo}>
              <Deslizante
                valor={area[k]}
                min={k === 'w' || k === 'h' ? 0.02 : 0}
                max={1}
                step={0.005}
                texto={`${Math.round(area[k] * 100)}%`}
                onChange={(v) => onChange({ area: areaNoQuadro({ ...area, [k]: v }) })}
              />
            </Linha>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * O QUADRO EM MINIATURA com a area: arrastar o retangulo move, o canto de
 * baixo a direita muda o tamanho.
 */
function AreaArrastavel({
  area,
  onChange,
  tipo,
}: {
  area: AreaDoEfeito
  onChange: (a: AreaDoEfeito) => void
  tipo: EfeitoDoClipe['tipo']
}) {
  const formato = useProject((s) => s.formato)
  const { width, height } = medidasDo(formato)
  const quadro = useRef<HTMLDivElement | null>(null)
  const largura = width >= height ? 200 : 110
  const altura = (largura * height) / width

  const arrastar = (ev: React.PointerEvent, modo: 'mover' | 'tamanho'): void => {
    ev.preventDefault()
    ev.stopPropagation()
    const caixa = quadro.current?.getBoundingClientRect()
    if (!caixa) return
    const inicio = { x: ev.clientX, y: ev.clientY, area }
    const mexer = (m: PointerEvent): void => {
      const dx = (m.clientX - inicio.x) / caixa.width
      const dy = (m.clientY - inicio.y) / caixa.height
      const a = inicio.area
      onChange(
        areaNoQuadro(
          modo === 'mover'
            ? { ...a, x: a.x + dx, y: a.y + dy }
            : { ...a, w: Math.min(Math.max(a.w + dx, 0.02), 1 - a.x), h: Math.min(Math.max(a.h + dy, 0.02), 1 - a.y) },
        ),
      )
    }
    const soltar = (): void => {
      window.removeEventListener('pointermove', mexer)
      window.removeEventListener('pointerup', soltar)
    }
    window.addEventListener('pointermove', mexer)
    window.addEventListener('pointerup', soltar)
  }

  return (
    <div className="flex justify-center">
      <div
        ref={quadro}
        className="relative rounded-sm border border-line-strong bg-bg"
        style={{ width: largura, height: altura }}
        title="Arraste a área; o canto de baixo muda o tamanho"
      >
        <div
          onPointerDown={(ev) => arrastar(ev, 'mover')}
          className={[
            'absolute cursor-move rounded-[2px] border border-accent',
            tipo === 'tarja' ? 'bg-accent/40' : 'bg-accent/20',
          ].join(' ')}
          style={{
            left: `${area.x * 100}%`,
            top: `${area.y * 100}%`,
            width: `${area.w * 100}%`,
            height: `${area.h * 100}%`,
          }}
        >
          <span
            onPointerDown={(ev) => arrastar(ev, 'tamanho')}
            className="absolute -right-1 -bottom-1 size-2.5 cursor-nwse-resize rounded-[2px] bg-accent"
          />
        </div>
      </div>
    </div>
  )
}

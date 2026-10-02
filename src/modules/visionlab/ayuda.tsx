// Orbital Vision Lab: ayuda gráfica de la prueba de lejos (4 escenas dibujadas en SVG, sin fotos ni texto chico).
// Se muestra antes de elegir la distancia y se puede volver a abrir mientras la persona se ubica.

const tinta = 'var(--ink)', oro = 'var(--gold)', suave = 'var(--gold-soft)', linea = 'var(--line-2)'

/** Celular parado con una E en la pantalla. */
function Cel({ x, y, w, h, e = true }: { x: number; y: number; w: number; h: number; e?: boolean }) {
  const s = w * 0.42, cx = x + w / 2 - s / 2, cy = y + h / 2 - s / 2
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={w * 0.18} fill="#fff" stroke={tinta} strokeWidth="2" />
      {e && (
        <g fill={tinta}>
          <rect x={cx} y={cy} width={s} height={s / 5} />
          <rect x={cx} y={cy + (2 * s) / 5} width={s} height={s / 5} />
          <rect x={cx} y={cy + (4 * s) / 5} width={s} height={s / 5} />
          <rect x={cx} y={cy} width={s / 5} height={s} />
        </g>
      )}
    </g>
  )
}

/** Persona de frente (cabeza + hombros). */
function Persona({ cx, piso, r = 10 }: { cx: number; piso: number; r?: number }) {
  const cy = piso - r * 5.6
  return (
    <g fill="#fff" stroke={tinta} strokeWidth="2">
      <path d={`M${cx - r * 1.7} ${piso} C${cx - r * 1.7} ${cy + r * 2.4} ${cx + r * 1.7} ${cy + r * 2.4} ${cx + r * 1.7} ${piso}`} />
      <circle cx={cx} cy={cy} r={r} />
    </g>
  )
}

function Globo({ x, y, w, txt, cola }: { x: number; y: number; w: number; txt: string; cola: [number, number] }) {
  return (
    <g>
      <path d={`M${x + w * 0.3} ${y + 18} L${cola[0]} ${cola[1]} L${x + w * 0.5} ${y + 18}`} fill={suave} stroke={oro} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x={x} y={y} width={w} height={19} rx={9.5} fill={suave} stroke={oro} strokeWidth="1.5" />
      <rect x={x + w * 0.29} y={y + 16} width={w * 0.23} height={4} fill={suave} />
      <text x={x + w / 2} y={y + 13.5} textAnchor="middle" fontSize="10.5" fontWeight="800" fill={oro} fontFamily="Manrope,system-ui,sans-serif">{txt}</text>
    </g>
  )
}

const ESCENAS: { titulo: string; texto: string; svg: JSX.Element }[] = [
  {
    titulo: 'Apoyá el celular',
    texto: 'Parado, a la altura de tus ojos, contra unos libros o una taza. La pantalla mirando hacia vos.',
    svg: (
      <svg viewBox="0 0 160 110" aria-hidden="true">
        <line x1="8" y1="98" x2="152" y2="98" stroke={linea} strokeWidth="2" />
        <rect x="14" y="66" width="62" height="5" rx="1.5" fill={tinta} />
        <line x1="20" y1="71" x2="20" y2="98" stroke={tinta} strokeWidth="2.5" />
        <line x1="70" y1="71" x2="70" y2="98" stroke={tinta} strokeWidth="2.5" />
        <rect x="26" y="56" width="38" height="10" rx="1.5" fill={suave} stroke={oro} strokeWidth="1.5" />
        <rect x="29" y="46" width="32" height="10" rx="1.5" fill="#fff" stroke={oro} strokeWidth="1.5" />
        <Cel x={37} y={18} w={16} h={28} />
        <Persona cx={124} piso={98} r={10} />
        <line x1="56" y1="42" x2="112" y2="42" stroke={oro} strokeWidth="1.5" strokeDasharray="3 3" />
        <text x="84" y="37" textAnchor="middle" fontSize="8" fontWeight="700" fill={oro} fontFamily="Manrope,system-ui,sans-serif">MISMA ALTURA</text>
      </svg>
    ),
  },
  {
    titulo: 'Alejate hasta oír “¡Listo!”',
    texto: 'Caminá despacio para atrás mirando el celular. Te va diciendo “un paso más” hasta que estés a 3 metros.',
    svg: (
      <svg viewBox="0 0 160 110" aria-hidden="true">
        <defs>
          <marker id="vl-fl" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={oro} />
          </marker>
        </defs>
        <line x1="8" y1="98" x2="152" y2="98" stroke={linea} strokeWidth="2" />
        <rect x="12" y="68" width="26" height="30" rx="2" fill={suave} stroke={oro} strokeWidth="1.5" />
        <Cel x={18} y={42} w={14} h={26} />
        <Globo x={34} y={10} w={50} txt="¡Listo!" cola={[30, 40]} />
        <Persona cx={130} piso={98} r={9} />
        <line x1="44" y1="88" x2="112" y2="88" stroke={oro} strokeWidth="1.8" markerStart="url(#vl-fl)" markerEnd="url(#vl-fl)" />
        <text x="78" y="83" textAnchor="middle" fontSize="11" fontWeight="800" fill={tinta} fontFamily="Manrope,system-ui,sans-serif">3 m</text>
        <path d="M146 60 l6 5 l-6 5 M140 60 l6 5 l-6 5" fill="none" stroke={oro} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    titulo: 'Tapate un ojo',
    texto: 'Con la palma, sin apretar. Primero el izquierdo (se mide el derecho) y después al revés.',
    svg: (
      <svg viewBox="0 0 160 110" aria-hidden="true">
        <circle cx="80" cy="56" r="36" fill="#fff" stroke={tinta} strokeWidth="2" />
        <ellipse cx="66" cy="50" rx="7" ry="4.5" fill="#fff" stroke={tinta} strokeWidth="2" />
        <circle cx="66" cy="50" r="2.6" fill={tinta} />
        <path d="M72 76 Q80 81 88 76" fill="none" stroke={tinta} strokeWidth="2" strokeLinecap="round" />
        <path d="M80 54 L77 64 L82 64" fill="none" stroke={tinta} strokeWidth="1.6" strokeLinejoin="round" />
        <g transform="rotate(-12 102 52)">
          <rect x="84" y="34" width="34" height="38" rx="14" fill={suave} stroke={oro} strokeWidth="2" />
          <line x1="93" y1="38" x2="93" y2="56" stroke={oro} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="101" y1="37" x2="101" y2="56" stroke={oro} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="109" y1="38" x2="109" y2="56" stroke={oro} strokeWidth="1.4" strokeLinecap="round" />
          <rect x="94" y="70" width="16" height="30" rx="6" fill={suave} stroke={oro} strokeWidth="2" />
        </g>
      </svg>
    ),
  },
  {
    titulo: 'Decí dónde está la abertura',
    texto: '“Derecha”, “arriba a la izquierda”… el celular te escucha y pasa solo al siguiente. Si no la ves, decí “no la veo”.',
    svg: (
      <svg viewBox="0 0 160 110" aria-hidden="true">
        <Cel x={22} y={10} w={46} h={86} e={false} />
        {/* anillo de Landolt con la abertura a la derecha (diámetro 18, trazo y abertura 3,6) */}
        <path d="M53.82 40.8 A9 9 0 1 1 53.82 37.2 L50.09 37.2 A5.4 5.4 0 1 0 50.09 40.8 Z" fill={tinta} />
        <g fill="none" stroke={linea} strokeWidth="1.5">
          <rect x="39" y="58" width="12" height="9" rx="2" />
          <rect x="27" y="68" width="12" height="9" rx="2" />
          <rect x="39" y="78" width="12" height="9" rx="2" />
        </g>
        <rect x="51" y="68" width="12" height="9" rx="2" fill={suave} stroke={oro} strokeWidth="1.8" />
        <path d="M54 72.5 h6 m-2.5 -2.5 l2.5 2.5 l-2.5 2.5" fill="none" stroke={oro} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M60 108 L60 84 Q60 78 65 78 Q70 78 70 84 L70 108" fill="#fff" stroke={tinta} strokeWidth="2" />
        <Persona cx={134} piso={108} r={9} />
        <Globo x={84} y={18} w={58} txt="¡Derecha!" cola={[124, 52]} />
      </svg>
    ),
  },
]

/** Las 4 escenas en tarjetas numeradas (2 × 2 en el celular). */
export function ComoSeHace() {
  return (
    <div className="ayuda">
      <div className="ayuda-tit">Así se hace la prueba de lejos</div>
      <ol>
        {ESCENAS.map((e, i) => (
          <li key={e.titulo}>
            <div className="ilus">{e.svg}<span className="n">{i + 1}</span></div>
            <b>{e.titulo}</b>
            <span>{e.texto}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Vision Lab para colaboradores: las herramientas del Vision Lab para hacer contenido con su comunidad ──
// Destacado: el perfil visual completo (/lab?r=<codigo>: rostro + calce + chequeo en un recorrido, la venta queda a su
// nombre porque el código pasa al estudio de rostro). Abajo, atajos para ir directo a una medición: el estudio de rostro
// con el mismo código; calce, pretest y buscador de la red son públicos (no atribuyen por link).
import { Eye, Glasses, MapPin, ScanFace, Sparkles } from 'lucide-react'
import { ACENTO, BASE } from './colabUtil'
import { BotonCopiar } from './ColabAnteojos'
import { useCatalogoColab, useLinkLab } from './ColabFichas'
import { HerramientaLab } from '../catalogo/VisionLabPro'

const IDEAS = [
  'Hacé el estudio de rostro en vivo en una historia y mostrá qué forma de cara te dio.',
  'Medite dos modelos con la medición de calce y contá cuál te quedó mejor y por qué.',
  '“¿Cuánto hace que no te revisás la vista?”: compartí el pretest y mostrá tu resultado.',
  'Encuesta en historias: “¿Qué talle de anteojo sos?” y respondé con tu link del estudio.',
]

type Lab = ReturnType<typeof useLinkLab>

function PerfilCompleto({ codigo, obtener, creando, error, listo }: Lab) {
  const link = codigo ? `${BASE}/lab?r=${codigo}` : null
  return (
    <div className="rounded-2xl bg-[#0004FF] text-white p-5 mb-4 shadow-[0_10px_30px_-10px_rgba(0,4,255,.5)]">
      <div className="flex items-center gap-2">
        <span className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><Sparkles size={20} /></span>
        <div>
          <h2 className="text-[16px] font-bold tracking-wide uppercase leading-tight">Perfil visual completo</h2>
          <p className="text-[11px] text-white/70">Rostro · calce · chequeo en un solo recorrido</p>
        </div>
      </div>
      <p className="text-[12px] text-white/85 mt-3">
        Tu comunidad escanea su cara, se prueba tus anteojos y chequea su vista desde el celular. Le decimos
        <b> cuáles de tus anteojos le quedan mejor</b> y, al comprar, pasan por tu link.
      </p>
      {link ? (
        <>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-black">
            <span className="flex-1 truncate font-mono text-[11px] font-bold">{link.replace('https://', '')}</span>
            <BotonCopiar texto={link} label="Copiar" grande />
          </div>
          <a href={link.replace(BASE, '')} target="_blank" rel="noopener" className="mt-2 inline-block text-[12px] font-semibold text-white underline underline-offset-2">Probarlo yo →</a>
        </>
      ) : (
        <button onClick={obtener} disabled={creando || !listo}
          className="mt-3 w-full rounded-xl bg-white font-bold py-3 text-[14px] disabled:opacity-50" style={{ color: ACENTO }}>
          {creando ? 'Creando…' : 'Obtener mi link'}
        </button>
      )}
      {error && <p className="mt-2 text-[11px] text-red-200">{error}</p>}
    </div>
  )
}

export default function ColabVisionLab({ clave, onLink }: { clave: string; onLink?: () => void }) {
  const modelos = useCatalogoColab(clave)
  const lab = useLinkLab(clave, modelos, onLink)
  const rostro = `${BASE}/lab/rostro${lab.codigo ? `?r=${lab.codigo}` : ''}`
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase flex items-center gap-2">
          Vision Lab <span className="text-[10px] tracking-widest rounded-full bg-[#0004FF] text-white px-2 py-0.5">PRO</span>
        </h1>
        <p className="text-[12px] text-neutral-500 mt-1">Las herramientas de Orbital para elegir anteojos desde el celular. Contenido que se comparte solo: tu comunidad lo prueba y vuelve a vos.</p>
      </div>

      <PerfilCompleto {...lab} />

      <h2 className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 mb-2">Atajos · ir directo a una medición</h2>
      <div className="grid sm:grid-cols-2 gap-2">
        <HerramientaLab ic={<ScanFace size={18} />} t="Estudio de rostro" d="Forma del rostro, talle de armazón y cuáles de tus anteojos le van. Con tu link." u={rostro} />
        <HerramientaLab ic={<Glasses size={18} />} t="Medición de calce" d="Se pone el anteojo frente a la cámara y mide marco vs. rostro y dónde cae la pupila." u={`${BASE}/lab/calce`} />
        <HerramientaLab ic={<Eye size={18} />} t="Pretest visual" d="Chequeo de la vista en 5 minutos: agudeza, contraste, astigmatismo y pantallas." u={`${BASE}/lab/pretest`} />
        <HerramientaLab ic={<MapPin size={18} />} t="Red oftalmológica" d="Buscador de oftalmólogos y ópticas Orbital por zona y obra social." u={`${BASE}/lab/buscar`} />
      </div>

      <div className="rounded-xl bg-white border border-black/10 p-4 mt-4">
        <h2 className="text-[13px] font-bold uppercase tracking-wide">Ideas de contenido</h2>
        <ul className="mt-2 space-y-1.5">
          {IDEAS.map((i) => <li key={i} className="text-[12px] text-neutral-700 flex gap-2"><span style={{ color: '#0004FF' }}>✦</span>{i}</li>)}
        </ul>
        <p className="text-[11px] text-neutral-400 mt-3">El pretest es orientativo y no reemplaza la consulta con el oftalmólogo: no lo presentes como un diagnóstico.</p>
      </div>
    </div>
  )
}

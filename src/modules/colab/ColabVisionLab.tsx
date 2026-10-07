// ── Vision Lab para colaboradores: las herramientas del Vision Lab para hacer contenido con su comunidad ──
// El estudio de rostro va con su link (?r=<codigo>, la venta queda a su nombre: EstudioRostro de ColabFichas);
// pretest, medición de calce, perfil visual y buscador de la red son los públicos (no atribuyen por link).
import { Eye, Glasses, MapPin, Sparkles } from 'lucide-react'
import { BASE } from './colabUtil'
import { EstudioRostro } from './ColabFichas'
import { HerramientaLab } from '../catalogo/VisionLabPro'

const IDEAS = [
  'Hacé el estudio de rostro en vivo en una historia y mostrá qué forma de cara te dio.',
  'Medite dos modelos con la medición de calce y contá cuál te quedó mejor y por qué.',
  '“¿Cuánto hace que no te revisás la vista?”: compartí el pretest y mostrá tu resultado.',
  'Encuesta en historias: “¿Qué talle de anteojo sos?” y respondé con tu link del estudio.',
]

export default function ColabVisionLab({ clave, onLink }: { clave: string; onLink?: () => void }) {
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase flex items-center gap-2">
          Vision Lab <span className="text-[10px] tracking-widest rounded-full bg-[#0004FF] text-white px-2 py-0.5">PRO</span>
        </h1>
        <p className="text-[12px] text-neutral-500 mt-1">Las herramientas de Orbital para elegir anteojos desde el celular. Contenido que se comparte solo: tu comunidad lo prueba y vuelve a vos.</p>
      </div>

      <EstudioRostro clave={clave} onLink={onLink} />

      <div className="grid sm:grid-cols-2 gap-2">
        <HerramientaLab ic={<Glasses size={18} />} t="Medición de calce" d="Se pone el anteojo frente a la cámara y mide marco vs. rostro y dónde cae la pupila." u={`${BASE}/lab/calce`} />
        <HerramientaLab ic={<Eye size={18} />} t="Pretest visual" d="Chequeo de la vista en 5 minutos: agudeza, contraste, astigmatismo y pantallas." u={`${BASE}/lab/pretest`} />
        <HerramientaLab ic={<Sparkles size={18} />} t="Perfil visual completo" d="Las tres juntas: rostro, calce y chequeo, en un solo recorrido." u={`${BASE}/lab`} />
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

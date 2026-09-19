import Link from 'next/link';
import { ArrowRight, ChevronDown, ChartNoAxesCombined, SlidersHorizontal, BookOpen } from 'lucide-react';

type Criterion = { name: string; subtitle: string; weight: number; ideal: string; review: string; explanation: string; context: string };
const groups: { title: string; description: string; items: Criterion[] }[] = [
  { title: 'Tamaño y negociación', description: 'La escala del negocio y las acciones que circulan en el mercado.', items: [
    { name: 'Capitalización', subtitle: 'Cuánto vale la empresa en bolsa.', weight: 8, ideal: 'Desde USD 2.000 millones', review: 'Desde USD 300 millones', explanation: 'Es el precio de una acción multiplicado por el número de acciones. Ayuda a comparar el tamaño de las empresas.', context: 'Una empresa grande también puede perder valor. El tamaño no sustituye la revisión de su negocio.' },
    { name: 'Acciones en circulación pública', subtitle: 'Free float · la parte disponible para negociar.', weight: 6, ideal: '40% o más', review: '20% o más', explanation: 'Indica qué porcentaje de las acciones está disponible para comprarse y venderse en el mercado, fuera de participaciones restringidas.', context: 'Un porcentaje pequeño puede hacer que el precio sea más sensible a las operaciones. No equivale al volumen que se negocia cada día.' },
  ] },
  { title: 'Precio y expectativas', description: 'Lo que cuesta la acción frente a sus resultados y las estimaciones disponibles.', items: [
    { name: 'Precio / ganancias', subtitle: 'P/E · cuánto se paga por las ganancias de la empresa.', weight: 10, ideal: 'De 20 a 25 veces', review: 'De 10 a 40 veces', explanation: 'Un P/E de 20 significa que el precio equivale a 20 veces la ganancia anual por acción. La plataforma da la mayor puntuación al rango de 20 a 25.', context: 'Es una regla del modelo, no un rango universal de compra. Un P/E bajo puede reflejar riesgos; uno alto puede incorporar expectativas de crecimiento.' },
    { name: 'Potencial al precio objetivo', subtitle: 'La distancia al objetivo estimado por analistas.', weight: 8, ideal: '15% o más', review: '0% o más', explanation: 'Se calcula como (precio objetivo ÷ precio actual − 1) × 100. Si el precio actual es 100 y el objetivo es 115, el potencial indicado es 15%.', context: 'El precio objetivo es una estimación que puede cambiar o no cumplirse. No es una rentabilidad prometida.' },
  ] },
  { title: 'Crecimiento del negocio', description: 'Cuánto vende la empresa y cómo cambian sus resultados.', items: [
    { name: 'Ventas totales', subtitle: 'Los ingresos anuales del negocio.', weight: 7, ideal: 'Desde USD 1.000 millones', review: 'Desde USD 100 millones', explanation: 'Miden el dinero generado por las ventas antes de descontar gastos. El modelo las usa como una señal de escala comercial.', context: 'Vender mucho no significa ganar mucho. Conviene revisar también los márgenes y la caja que queda.' },
    { name: 'Crecimiento de ingresos', subtitle: 'Cómo cambian las ventas frente al año anterior.', weight: 9, ideal: '10% o más', review: '0% o más', explanation: 'Compara los ingresos con el mismo periodo del año anterior. Un crecimiento del 10% significa que las ventas aumentaron una décima parte.', context: 'Una adquisición o una base de comparación baja pueden elevar este dato. Revisa si la tendencia se mantiene en varios periodos.' },
    { name: 'Crecimiento de ganancias', subtitle: 'Cómo evolucionan las utilidades.', weight: 9, ideal: '10% o más', review: '0% o más', explanation: 'Compara las ganancias con el periodo equivalente del año anterior. Permite observar si el crecimiento del negocio llega también a sus resultados.', context: 'Ingresos extraordinarios, impuestos o recortes de gastos pueden cambiar el dato sin que aumenten las ventas.' },
  ] },
  { title: 'Rentabilidad', description: 'Qué tan bien convierte sus recursos y ventas en beneficios.', items: [
    { name: 'Rentabilidad del patrimonio', subtitle: 'ROE · el beneficio generado con el capital de los accionistas.', weight: 7, ideal: '15% o más', review: '8% o más', explanation: 'Relaciona la utilidad con el patrimonio. Un ROE del 15% representa 15 de beneficio por cada 100 de patrimonio.', context: 'La deuda o un patrimonio muy pequeño pueden elevarlo. Compáralo con empresas del mismo sector y con su nivel de deuda.' },
    { name: 'Rentabilidad de los activos', subtitle: 'ROA · cómo utiliza la empresa sus recursos.', weight: 5, ideal: '7% o más', review: '3% o más', explanation: 'Relaciona las ganancias con los activos totales, como instalaciones, efectivo e inventarios. Ayuda a evaluar la eficiencia del negocio.', context: 'Los negocios que necesitan grandes instalaciones suelen tener ratios distintos a los de empresas con pocos activos físicos.' },
    { name: 'Margen operativo', subtitle: 'Qué parte de las ventas queda tras los gastos operativos.', weight: 7, ideal: '15% o más', review: '5% o más', explanation: 'Un margen operativo del 15% significa que quedan 15 de resultado operativo por cada 100 vendidos, antes de intereses e impuestos.', context: 'El margen depende del sector. También importa que sea estable y que no provenga de recortes difíciles de mantener.' },
  ] },
  { title: 'Deuda y efectivo', description: 'La capacidad de cumplir obligaciones y financiar el negocio.', items: [
    { name: 'Deuda / patrimonio', subtitle: 'Cuánta deuda hay en relación con el capital propio.', weight: 7, ideal: '100% o menos', review: '200% o menos', explanation: 'Un valor del 100% indica una deuda equivalente al patrimonio. El modelo favorece valores menores dentro de estos límites.', context: 'El sector, el costo de la deuda y sus vencimientos también importan. Un patrimonio negativo necesita una revisión aparte.' },
    { name: 'Razón corriente', subtitle: 'Los recursos disponibles frente a las obligaciones cercanas.', weight: 5, ideal: '1,2 veces o más', review: '0,8 veces o más', explanation: 'Divide los activos corrientes entre los pasivos corrientes. Un valor de 1,2 representa 1,20 en activos de corto plazo por cada 1 de obligaciones.', context: 'No todos esos activos son efectivo. La velocidad para cobrar ventas o vender inventarios también afecta la liquidez.' },
    { name: 'Flujo de caja libre', subtitle: 'El efectivo que queda después de invertir en el negocio.', weight: 7, ideal: 'Cero o positivo', review: 'Desde −USD 1 millón', explanation: 'Es el flujo de caja operativo menos las inversiones en activos. Esa caja puede destinarse a deuda, expansión o dividendos.', context: 'Un valor negativo puede deberse a una etapa de inversión. Para interpretarlo conviene revisar su evolución y cómo se financia.' },
  ] },
  { title: 'Comportamiento frente al mercado', description: 'Una referencia histórica para entender las variaciones del precio.', items: [
    { name: 'Beta', subtitle: 'La sensibilidad del activo a los movimientos del mercado.', weight: 5, ideal: 'De 0,7 a 1,3', review: 'De 0 a 2', explanation: 'Una beta cercana a 1 indica sensibilidad parecida a la del mercado de referencia. Por encima de 1, suele ser mayor; por debajo, menor.', context: 'Es una medida histórica. No recoge todos los riesgos ni predice exactamente cómo se moverá la acción.' },
  ] },
];

export function Criteria() {
  return <div className="space-y-8">
    <header className="page-heading"><div><p className="eyebrow">Guía de investigación</p><h1>Criterios de investigación</h1><p>Los criterios detrás de cada puntaje, explicados en palabras sencillas.</p></div><BookOpen className="hidden text-indigo-400 sm:block" size={28} /></header>

    <div className="grid items-start gap-5 md:grid-cols-2">
      <section id="score" className="card scroll-mt-6 overflow-hidden">
        <div className="p-6"><span className="icon-tile bg-indigo-50 text-indigo-600"><ChartNoAxesCombined size={20} /></span><h2 className="mt-4 text-lg font-semibold">El puntaje del activo</h2><p className="mt-2 text-sm leading-6 text-slate-600">El score resume cómo se compara una empresa con los criterios financieros de la plataforma. Va de 0 a 100.</p>
          <div className="mt-5 flex h-6 items-center gap-1.5" aria-hidden="true"><span className="h-1.5 flex-1 rounded-full bg-rose-400" /><span className="h-1.5 flex-1 rounded-full bg-amber-400" /><span className="h-1.5 flex-1 rounded-full bg-indigo-400" /><span className="h-1.5 flex-1 rounded-full bg-emerald-500" /></div>
          <p className="mt-3 text-xs leading-5 text-slate-500">Un puntaje alto indica mayor cumplimiento de los criterios. No significa que la inversión vaya a subir.</p>
        </div>
        <details className="explanation border-t border-slate-100"><summary className="flex cursor-pointer items-center justify-between gap-3 px-6 py-4 text-sm font-medium text-indigo-700">Cómo se calcula el puntaje<ChevronDown size={17} className="disclosure-arrow" /></summary>
          <div className="space-y-4 px-6 pb-6 text-sm leading-6 text-slate-600">
            <ol className="list-decimal space-y-2 pl-5"><li>Cada criterio con datos recibe <strong>100 puntos</strong> si cumple el rango preferido, <strong>55</strong> si está en revisión y <strong>15</strong> si queda fuera.</li><li>Se multiplica ese resultado por la importancia del criterio, indicada como su peso.</li><li>Se suman los resultados y se dividen entre los pesos de los criterios con datos.</li></ol>
            <div className="rounded-lg bg-slate-50 p-4"><p className="font-medium text-slate-800">Un ejemplo con solo dos datos</p><p className="mt-1">P/E: 100 puntos con peso 10. Crecimiento de ingresos: 55 puntos con peso 9.</p><p className="mt-2 font-medium tabular-nums text-indigo-700">(100 × 10 + 55 × 9) ÷ 19 = 78,7 / 100</p></div>
            <p>Los datos faltantes se excluyen y los pesos restantes se redistribuyen. Si no hay ningún dato, el resultado es 0. Revisa siempre qué información falta: un puntaje alto basado en pocos datos ofrece menos contexto.</p>
            <dl className="divide-y divide-slate-100 text-xs">{[['80–100', 'Oportunidad prioritaria'], ['65–menos de 80', 'En seguimiento'], ['50–menos de 65', 'Neutral'], ['Menos de 50', 'Precaución']].map(([range, label]) => <div key={label} className="flex justify-between gap-3 py-2"><dt>{label}</dt><dd className="font-medium tabular-nums text-slate-800">{range}</dd></div>)}</dl>
            <p className="text-xs">Las reglas están orientadas a empresas. En ETFs pueden faltar métricas del negocio; conviene revisar además las posiciones del fondo, sus costos y su estrategia.</p>
          </div>
        </details>
      </section>

      <section id="recommendations" className="card scroll-mt-6 overflow-hidden">
        <div className="p-6"><span className="icon-tile bg-violet-50 text-violet-600"><SlidersHorizontal size={20} /></span><h2 className="mt-4 text-lg font-semibold">El ajuste a tu portafolio</h2><p className="mt-2 text-sm leading-6 text-slate-600">Las recomendaciones comparan activos con lo que ya tienes y con lo que quieres lograr. El ajuste también va de 0 a 100.</p>
          <div className="mt-5 flex flex-wrap gap-2">{['Tu cartera', 'Tus objetivos', 'Tu plazo'].map(label => <span key={label} className="rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">{label}</span>)}</div>
          <p className="mt-3 text-xs leading-5 text-slate-500">Una empresa puede tener buen puntaje financiero y aportar poco a una cartera que ya concentra su sector.</p>
        </div>
        <details className="explanation border-t border-slate-100"><summary className="flex cursor-pointer items-center justify-between gap-3 px-6 py-4 text-sm font-medium text-violet-700">Cómo se eligen los activos para ti<ChevronDown size={17} className="disclosure-arrow" /></summary>
          <div className="space-y-4 px-6 pb-6 text-sm leading-6 text-slate-600">
            <ol className="list-decimal space-y-2 pl-5"><li><strong>Tus objetivos guardados:</strong> crecimiento, ingresos, preservación u otras prioridades cambian la importancia de cada factor.</li><li><strong>Tu cartera actual:</strong> se considera la concentración por sector. Los tickers que ya tienes se excluyen de la lista de nuevos candidatos.</li><li><strong>Tu riesgo y plazo:</strong> la beta ayuda a estimar el ajuste de riesgo; un horizonte corto aumenta la importancia de este factor.</li><li><strong>Los datos del activo:</strong> se combinan calidad financiera, valoración, crecimiento, dividendos y las prioridades que seleccionaste.</li></ol>
            <p>La búsqueda incluye activos de Research y del descubrimiento de mercado, aunque no estén en tu watchlist. La cobertura es parcial y se amplía conforme hay datos disponibles.</p>
            <div className="rounded-lg bg-violet-50/70 p-4"><p className="font-medium text-violet-900">Por qué el ajuste puede cambiar</p><p className="mt-1">Si cambias tus objetivos, tu cartera o los datos del mercado, cambia el orden. Aquí los datos faltantes reducen el ajuste y generan avisos para que sepas qué falta revisar.</p></div>
            <p className="text-xs">El ajuste no es una probabilidad de ganancia. No incluye impuestos, costos, exposición a divisas, disponibilidad en tu broker ni el detalle de activos repetidos dentro de ETFs.</p>
            <Link href="/?tab=portfolio" className="quiet-link">Revisar mis objetivos <ArrowRight size={14} /></Link>
          </div>
        </details>
      </section>
    </div>

    <section aria-labelledby="criteria-heading">
      <div className="mb-6 border-b border-slate-200 pb-5"><p className="eyebrow">Las 14 señales del análisis</p><h2 id="criteria-heading" className="mt-2 text-xl font-semibold">Qué evalúa cada criterio</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Selecciona cualquier criterio para conocer cómo interpretarlo. El peso indica la importancia de cada criterio cuando hay datos completos. Los rangos son referencias del modelo y se deben leer en el contexto de cada empresa.</p></div>
      <div className="space-y-8">{groups.map((group, index) => <section key={group.title} className="grid gap-4 xl:grid-cols-[220px_1fr]">
        <div className="pt-2"><span className="text-xs font-medium tabular-nums text-indigo-500">0{index + 1}</span><h3 className="mt-1 text-sm font-semibold text-slate-800">{group.title}</h3><p className="mt-1.5 text-xs leading-5 text-slate-500">{group.description}</p></div>
        <div className="card divide-y divide-slate-100 overflow-hidden">{group.items.map(item => <details key={item.name} className="explanation">
          <summary className="flex cursor-pointer items-center gap-4 px-5 py-4 transition hover:bg-slate-50"><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-slate-800">{item.name}</h4><p className="mt-1 text-xs leading-5 text-slate-500">{item.subtitle}</p></div><span className="shrink-0 text-xs tabular-nums text-slate-500">Peso {item.weight}%</span><ChevronDown size={17} className="disclosure-arrow shrink-0 text-slate-400" /></summary>
          <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-5 text-sm leading-6 text-slate-600"><p>{item.explanation}</p><dl className="my-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3"><dt className="text-xs font-medium text-emerald-800">Rango preferido · 100 puntos</dt><dd className="mt-1 font-medium text-slate-800">{item.ideal}</dd></div><div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3"><dt className="text-xs font-medium text-amber-800">En revisión · 55 puntos</dt><dd className="mt-1 font-medium text-slate-800">{item.review}</dd></div></dl><p className="mb-3 text-xs text-slate-500">El rango de revisión aplica cuando no se cumple el preferido. Fuera de ambos rangos: 15 puntos.</p><p><strong className="font-medium text-slate-800">Ponlo en contexto. </strong>{item.context}</p></div>
        </details>)}</div>
      </section>)}</div>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-5"><p className="text-sm text-slate-500">Ya conoces las señales. Puedes explorarlas en un activo.</p><Link href="/?tab=research" className="button-primary">Investigar una empresa <ArrowRight size={15} /></Link></div>
  </div>;
}

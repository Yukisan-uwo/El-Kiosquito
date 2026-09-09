import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface BarraConfig {
  clave: string
  nombre: string
  color: string
}

export interface GraficoBarrasProps {
  titulo?: string
  subtitulo?: string
  datos: Array<Record<string, unknown>>
  claveEjeX: string
  barras: BarraConfig[]
  formatearValor?: (valor: number) => string
  altura?: number
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    name: string
    value: number
    color: string
    dataKey: string
  }>
  label?: string
  formatearValor?: (valor: number) => string
}

function CustomTooltip({ active, payload, label, formatearValor }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-xl border-2 border-amber-200/90 bg-white p-3 shadow-md">
      <p className="text-body-sm font-bold text-brand-deep border-b border-amber-100 pb-1 mb-1.5">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}:
            </span>
            <span className="font-semibold text-text-primary">
              {formatearValor ? formatearValor(Number(entry.value)) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GraficoBarras({
  titulo,
  subtitulo,
  datos,
  claveEjeX,
  barras,
  formatearValor,
  altura = 260,
}: GraficoBarrasProps) {
  if (!datos || datos.length === 0) return null

  return (
    <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs">
      {(titulo || subtitulo) && (
        <div className="mb-4">
          {titulo && <h4 className="font-display text-title font-semibold text-brand-deep">{titulo}</h4>}
          {subtitulo && <p className="text-body-sm text-text-secondary mt-0.5">{subtitulo}</p>}
        </div>
      )}
      <div style={{ width: '100%', height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F4EAD8" vertical={false} />
            <XAxis
              dataKey={claveEjeX}
              tickLine={false}
              axisLine={{ stroke: '#E8DBC6' }}
              tick={{ fill: '#5C6B65', fontSize: 12, fontWeight: 500 }}
            />
            <YAxis
              tickLine={false}
              axisLine={{ stroke: '#E8DBC6' }}
              tick={{ fill: '#5C6B65', fontSize: 11 }}
              tickFormatter={(val) => (formatearValor ? formatearValor(Number(val)) : String(val))}
            />
            <Tooltip
              content={<CustomTooltip formatearValor={formatearValor} />}
              cursor={{ fill: 'rgba(245, 235, 215, 0.45)' }}
            />
            {barras.length > 1 && (
              <Legend
                wrapperStyle={{ paddingTop: 12, fontSize: 12 }}
                formatter={(value) => <span className="text-text-secondary font-medium">{value}</span>}
              />
            )}
            {barras.map((b) => (
              <Bar
                key={b.clave}
                dataKey={b.clave}
                name={b.nombre}
                fill={b.color}
                radius={[6, 6, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

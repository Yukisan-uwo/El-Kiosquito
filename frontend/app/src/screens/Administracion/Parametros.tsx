import { useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { MensajeError } from '@/components/ui/MensajeError'
import { consultarParametroVigente, registrarParametroSistema } from './api'
import type { ParametroSistema } from './tipos'

const CLAVES_CONOCIDAS = [
  { clave: 'iva', etiqueta: 'IVA (Art. 4.1)' },
  { clave: 'moneda', etiqueta: 'Moneda' },
]

interface TarjetaParametroProps {
  clave: string
  etiqueta: string
}

/**
 * OO-AD07 (Decisión 2 de `research.md` de 010-administracion):
 * `historial_parametro_sistema` es append-only — cada valor nuevo es un
 * `INSERT`, nunca un `UPDATE`. El valor "vigente" que se muestra acá es
 * siempre el que devuelve `GET /admin/parametros/{clave}` (el más
 * reciente por `vigente_desde`), nunca el que el usuario acaba de
 * escribir en el formulario hasta que el backend confirma que se guardó.
 */
function TarjetaParametro({ clave, etiqueta }: TarjetaParametroProps) {
  const [vigente, setVigente] = useState<ParametroSistema | null>(null)
  const [nuncaRegistrado, setNuncaRegistrado] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editando, setEditando] = useState(false)
  const [valorNuevo, setValorNuevo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)

  function consultar() {
    setCargando(true)
    setError(null)
    setNuncaRegistrado(false)
    consultarParametroVigente(clave)
      .then((res) => setVigente(res))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setNuncaRegistrado(true)
          return
        }
        setError(err instanceof ApiError ? err.mensajeUsuario : `No se pudo consultar "${clave}".`)
      })
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    consultar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  async function manejarGuardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setErrorGuardado(null)
    try {
      const registrado = await registrarParametroSistema({ clave, valor: valorNuevo })
      setVigente(registrado)
      setNuncaRegistrado(false)
      setEditando(false)
      setValorNuevo('')
    } catch (err) {
      setErrorGuardado(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar el nuevo valor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-surface-card p-4 shadow-[var(--shadow-elevation-1)]">
      <p className="text-title text-text-primary">{etiqueta}</p>
      {cargando && <EsqueletoCarga filas={1} alturaPx={32} />}
      {!cargando && error && <MensajeError mensaje={error} onReintentar={consultar} />}
      {!cargando && !error && (
        <>
          {nuncaRegistrado && <p className="mt-1 text-body text-text-secondary">Todavía no se registró ningún valor.</p>}
          {vigente && (
            <p className="mt-1 text-body text-text-secondary">
              Vigente: <span className="font-medium text-text-primary">{vigente.valor}</span> desde{' '}
              {new Date(vigente.vigente_desde).toLocaleString('es-EC')}
            </p>
          )}
          {!editando && (
            <Boton variante="ghost" type="button" className="mt-2" onClick={() => setEditando(true)}>
              Registrar nuevo valor
            </Boton>
          )}
          {editando && (
            <form onSubmit={manejarGuardar} className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={valorNuevo}
                onChange={(evento) => setValorNuevo(evento.target.value)}
                placeholder={clave === 'iva' ? 'p. ej. 0.15' : 'p. ej. USD'}
                required
                className="w-40 rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
              />
              <Boton type="submit" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Boton>
              <Boton variante="ghost" type="button" onClick={() => setEditando(false)}>
                Cancelar
              </Boton>
            </form>
          )}
          {errorGuardado && <MensajeError mensaje={errorGuardado} />}
        </>
      )}
    </div>
  )
}

export function Parametros() {
  return (
    <div className="space-y-4">
      <p className="text-body text-text-secondary">
        El IVA y la moneda son parámetros con historial completo (nunca se sobrescriben): cada cambio queda registrado
        con la fecha desde la que aplicó, para que una venta pasada siga mostrando la tasa que realmente le
        correspondió (CA-AD-002).
      </p>
      {CLAVES_CONOCIDAS.map(({ clave, etiqueta }) => (
        <TarjetaParametro key={clave} clave={clave} etiqueta={etiqueta} />
      ))}
    </div>
  )
}

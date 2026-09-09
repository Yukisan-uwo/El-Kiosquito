import { useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { BarraBusqueda } from '@/components/ui/BarraBusqueda'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import { consultarAuditoria, descargarAuditoriaCsv, listarSucursales } from './api'
import type { LogAuditoria, Sucursal } from './tipos'

function nombreDe(mapa: Map<number, string> | undefined, id: number | null): string {
  if (id === null) return '—'
  return mapa?.get(id) ?? `Sucursal #${id}`
}

/**
 * RF-AD-006 / RNF-AD-004 (Art. 10.5) — dueño exclusivo (`require_dueno` en
 * el backend, no `require_permission`, ver docstring de `administracion.py`).
 * La exportación CSV usa un fetch aparte de `apiFetch` porque la respuesta
 * no es JSON (ver `descargarAuditoriaCsv` en `api.ts`).
 */
export function Auditoria() {
  const [sucursales, setSucursales] = useState<Sucursal[] | null>(null)
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null)

  const [filtroSucursal, setFiltroSucursal] = useState<number | null>(null)
  const [filtroUsuarioId, setFiltroUsuarioId] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [soloAnomalias, setSoloAnomalias] = useState(false)

  const [filas, setFilas] = useState<LogAuditoria[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)
  const [errorExportacion, setErrorExportacion] = useState<string | null>(null)

  useEffect(() => {
    listarSucursales()
      .then(setSucursales)
      .catch((err: unknown) => setErrorCatalogos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar las sucursales.'))
  }, [])

  function filtroActual() {
    return {
      usuarioId: filtroUsuarioId ? Number(filtroUsuarioId) : undefined,
      sucursalId: filtroSucursal ?? undefined,
      desde: filtroDesde || undefined,
      hasta: filtroHasta || undefined,
      soloAnomalias: soloAnomalias || undefined,
    }
  }

  function consultar() {
    setCargando(true)
    setError(null)
    consultarAuditoria(filtroActual())
      .then(setFilas)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo consultar la auditoría.'))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    consultar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function manejarExportar() {
    setExportando(true)
    setErrorExportacion(null)
    try {
      await descargarAuditoriaCsv(filtroActual())
    } catch (err) {
      setErrorExportacion(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo exportar la auditoría.')
    } finally {
      setExportando(false)
    }
  }

  const sucursalesMap = sucursales ? new Map(sucursales.map((s) => [s.id, s.nombre])) : undefined

  const [busqueda, setBusqueda] = useState('')

  const filasLista = filas ?? []
  const filasFiltradas = filasLista.filter((fila) => {
    if (!busqueda.trim()) return true
    const q = busqueda.toLowerCase()
    return (
      fila.accion.toLowerCase().includes(q) ||
      fila.recurso.toLowerCase().includes(q) ||
      String(fila.usuario_id ?? '').includes(q) ||
      (fila.recurso_id !== null && String(fila.recurso_id).includes(q))
    )
  })

  const {
    datosPaginados: filasPaginadas,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(filasFiltradas, {
    itemsPorPaginaInicial: 10,
  })

  if (errorCatalogos) return <MensajeError mensaje={errorCatalogos} />
  if (!sucursales) return <EsqueletoCarga filas={4} />

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="auditoria-usuario" className="mb-1 block text-label uppercase text-text-secondary">
              ID de usuario
            </label>
            <input
              id="auditoria-usuario"
              type="number"
              value={filtroUsuarioId}
              onChange={(evento) => setFiltroUsuarioId(evento.target.value)}
              placeholder="Opcional"
              className="w-32 rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <div>
            <label htmlFor="auditoria-sucursal" className="mb-1 block text-label uppercase text-text-secondary">
              Sucursal
            </label>
            <select
              id="auditoria-sucursal"
              value={filtroSucursal ?? ''}
              onChange={(evento) => setFiltroSucursal(evento.target.value ? Number(evento.target.value) : null)}
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            >
              <option value="">Toda la cadena</option>
              {sucursales.map((sucursal) => (
                <option key={sucursal.id} value={sucursal.id}>
                  {sucursal.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="auditoria-desde" className="mb-1 block text-label uppercase text-text-secondary">
              Desde
            </label>
            <input
              id="auditoria-desde"
              type="datetime-local"
              value={filtroDesde}
              onChange={(evento) => setFiltroDesde(evento.target.value)}
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <div>
            <label htmlFor="auditoria-hasta" className="mb-1 block text-label uppercase text-text-secondary">
              Hasta
            </label>
            <input
              id="auditoria-hasta"
              type="datetime-local"
              value={filtroHasta}
              onChange={(evento) => setFiltroHasta(evento.target.value)}
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" checked={soloAnomalias} onChange={(evento) => setSoloAnomalias(evento.target.checked)} />
            Solo anomalías operativas
          </label>
          <Boton type="button" onClick={consultar}>
            Consultar
          </Boton>
          <Boton variante="secundario" type="button" disabled={exportando} onClick={manejarExportar}>
            {exportando ? 'Exportando…' : 'Exportar CSV'}
          </Boton>
        </div>
        {errorExportacion && <MensajeError mensaje={errorExportacion} />}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-amber-200/60">
          <p className="text-body-sm text-text-secondary">
            Registros de seguridad y trazabilidad operacional del sistema.
          </p>
          <BarraBusqueda
            valor={busqueda}
            onChange={setBusqueda}
            placeholder="Filtrar por acción o recurso..."
            totalCoincidencias={busqueda.trim() ? filasFiltradas.length : undefined}
            className="w-full sm:w-64"
          />
        </div>
      </div>

      {cargando && <EsqueletoCarga filas={5} alturaPx={40} />}
      {!cargando && error && <MensajeError mensaje={error} onReintentar={consultar} />}
      {!cargando && !error && filas !== null && filas.length === 0 && (
        <EstadoVacio titulo="Sin eventos" descripcion="No hay eventos de auditoría que coincidan con este filtro." />
      )}
      {!cargando && !error && filas !== null && filas.length > 0 && filasFiltradas.length === 0 && (
        <EstadoVacio
          titulo="Sin coincidencias"
          descripcion={`No se encontraron eventos que coincidan con "${busqueda}".`}
        />
      )}
      {!cargando && !error && filas !== null && filasFiltradas.length > 0 && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                  <th scope="col" className="px-4 py-3">Fecha</th>
                  <th scope="col" className="px-4 py-3">Usuario</th>
                  <th scope="col" className="px-4 py-3">Acción</th>
                  <th scope="col" className="px-4 py-3">Recurso</th>
                  <th scope="col" className="px-4 py-3">Sucursal</th>
                  <th scope="col" className="px-4 py-3">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {filasPaginadas.map((fila) => (
                  <tr key={fila.id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3 text-text-secondary">{new Date(fila.creado_en).toLocaleString('es-EC')}</td>
                    <td className="px-4 py-3 text-text-primary">{fila.usuario_id ?? '—'}</td>
                    <td className="px-4 py-3 text-text-primary">{fila.accion}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {fila.recurso}
                      {fila.recurso_id !== null ? ` #${fila.recurso_id}` : ''}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{nombreDe(sucursalesMap, fila.sucursal_id)}</td>
                    <td className="px-4 py-3">
                      <BadgeEstado texto={fila.exitoso ? 'Éxito' : 'Anomalía'} color={fila.exitoso ? 'success' : 'danger'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion
            paginaActual={paginaActual}
            totalPaginas={totalPaginas}
            totalItems={totalItems}
            itemsPorPagina={itemsPorPagina}
            onCambiarPagina={cambiarPagina}
            onCambiarItemsPorPagina={cambiarItemsPorPagina}
            opcionesItemsPorPagina={[10, 25, 50]}
            etiquetaItems="eventos"
          />
        </div>
      )}
    </div>
  )
}

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { fadeUp, toastSlideUp } from '@/motion/tokens'
import { AbrirTurno } from './AbrirTurno'
import {
  canjearCupon,
  consultarCuponesCliente,
  crearCliente,
  crearVenta,
  listarVentasTurno,
  obtenerTurnoActual,
  validarCupon,
} from './api'
import { Carrito, calcularTotales } from './Carrito'
import { BusquedaProductos } from './BusquedaProductos'
import { CerrarTurno } from './CerrarTurno'
import { ClienteVenta, DATOS_CLIENTE_NUEVO_VACIOS, type DatosClienteNuevo, type ModoCliente } from './ClienteVenta'
import { PanelPago } from './PanelPago'
import type {
  ClienteExistenteSeleccionado,
  CuponOut,
  ItemCarrito,
  ProductoBusqueda,
  TurnoCaja,
  VentaOut,
} from './tipos'
import { formatearHora } from '@/utils/fechas'

type EstadoPantalla = 'cargando-turno' | 'sin-turno' | 'abierto' | 'error-turno' | 'sin-sucursal'

function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

export function PosCajero() {
  const { sesion } = useAuth()
  const sucursalId = sesion?.claims.sucursal_ids[0] ?? null

  const [estado, setEstado] = useState<EstadoPantalla>('cargando-turno')
  const [turno, setTurno] = useState<TurnoCaja | null>(null)
  const [errorTurno, setErrorTurno] = useState<string | null>(null)
  const [mostrarCerrarTurno, setMostrarCerrarTurno] = useState(false)

  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [descuento, setDescuento] = useState(0)
  const [cuponAplicado, setCuponAplicado] = useState<CuponOut | null>(null)
  const [cuponesCliente, setCuponesCliente] = useState<CuponOut[]>([])
  const [errorCupon, setErrorCupon] = useState<string | null>(null)
  const [validandoCupon, setValidandoCupon] = useState(false)
  const [modoCliente, setModoCliente] = useState<ModoCliente>('sin_cliente')
  const [datosClienteNuevo, setDatosClienteNuevo] = useState<DatosClienteNuevo>(DATOS_CLIENTE_NUEVO_VACIOS)
  const [clienteExistente, setClienteExistente] = useState<ClienteExistenteSeleccionado | null>(null)
  const [metodoPago, setMetodoPago] = useState<string | null>(null)
  const [datafonoId, setDatafonoId] = useState<number | null>(null)
  const [procesandoVenta, setProcesandoVenta] = useState(false)
  const [errorVenta, setErrorVenta] = useState<string | null>(null)
  const [ventaConfirmada, setVentaConfirmada] = useState<VentaOut | null>(null)
  const [ultimasVentas, setUltimasVentas] = useState<VentaOut[]>([])

  const cargarTurnoActual = useCallback(() => {
    if (sucursalId === null) {
      setEstado('sin-sucursal')
      return
    }
    setEstado('cargando-turno')
    obtenerTurnoActual()
      .then((resultado) => {
        setTurno(resultado)
        setEstado('abierto')
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setEstado('sin-turno')
          return
        }
        setErrorTurno(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo consultar el turno de caja.')
        setEstado('error-turno')
      })
  }, [sucursalId])

  useEffect(() => {
    cargarTurnoActual()
  }, [cargarTurnoActual])

  const cargarUltimasVentas = useCallback((turnoId: number) => {
    if (typeof listarVentasTurno === 'function') {
      try {
        const p = listarVentasTurno(turnoId, 6)
        if (p && typeof p.then === 'function') {
          p.then((ventas) => setUltimasVentas(ventas ?? [])).catch(() => {})
        }
      } catch {
        // Ignorar si no está implementado o mockeado en tests
      }
    }
  }, [])

  useEffect(() => {
    if (turno?.id) {
      cargarUltimasVentas(turno.id)
    }
  }, [turno, ventaConfirmada, cargarUltimasVentas])

  useEffect(() => {
    if (modoCliente === 'existente' && clienteExistente?.id) {
      consultarCuponesCliente(clienteExistente.id)
        .then((cupones) => {
          const ahora = new Date()
          const activos = (cupones ?? []).filter(
            (c) => c.estado === 'activo' && (!c.fecha_expiracion || new Date(c.fecha_expiracion) > ahora),
          )
          setCuponesCliente(activos)
        })
        .catch(() => setCuponesCliente([]))
    } else {
      setCuponesCliente([])
    }
  }, [modoCliente, clienteExistente])

  const calcularDescuentoCupon = useCallback((cupon: CuponOut, subtotal: number): number => {
    if (cupon.descuento_tipo === 'porcentaje') {
      return Math.round(((subtotal * cupon.descuento_valor) / 100) * 100) / 100
    }
    return Math.round(Math.min(cupon.descuento_valor, subtotal) * 100) / 100
  }, [])

  useEffect(() => {
    if (cuponAplicado) {
      const subtotal = carrito.reduce(
        (acumulado, item) => acumulado + item.cantidad * (item.producto.precio_venta_vigente ?? 0),
        0,
      )
      setDescuento(calcularDescuentoCupon(cuponAplicado, subtotal))
    }
  }, [carrito, cuponAplicado, calcularDescuentoCupon])

  async function manejarAplicarCupon(codigo: string) {
    if (!codigo.trim()) return
    setValidandoCupon(true)
    setErrorCupon(null)
    try {
      const cupon = await validarCupon(codigo.trim())
      setCuponAplicado(cupon)
      const subtotal = carrito.reduce(
        (acumulado, item) => acumulado + item.cantidad * (item.producto.precio_venta_vigente ?? 0),
        0,
      )
      setDescuento(calcularDescuentoCupon(cupon, subtotal))
    } catch (err) {
      setErrorCupon(err instanceof ApiError ? err.mensajeUsuario : 'Cupón inválido o expirado.')
    } finally {
      setValidandoCupon(false)
    }
  }

  function manejarRemoverCupon() {
    setCuponAplicado(null)
    setDescuento(0)
    setErrorCupon(null)
  }

  function reiniciarVentaEnCurso() {
    setCarrito([])
    setDescuento(0)
    setCuponAplicado(null)
    setErrorCupon(null)
    setModoCliente('sin_cliente')
    setDatosClienteNuevo(DATOS_CLIENTE_NUEVO_VACIOS)
    setClienteExistente(null)
    setMetodoPago(null)
    setDatafonoId(null)
    setErrorVenta(null)
  }

  function agregarAlCarrito(producto: ProductoBusqueda) {
    const stockMax =
      producto.stock_actual !== undefined && producto.stock_actual !== null
        ? Number(producto.stock_actual)
        : null
    if (stockMax !== null && stockMax <= 0) return

    setCarrito((actual) => {
      const existente = actual.find((item) => item.producto.id === producto.id)
      if (existente) {
        if (stockMax !== null && existente.cantidad >= stockMax) return actual
        const nuevaCant = existente.cantidad + 1
        return actual.map((item) =>
          item.producto.id === producto.id
            ? { ...item, cantidad: stockMax !== null ? Math.min(nuevaCant, stockMax) : nuevaCant }
            : item,
        )
      }
      return [...actual, { producto, cantidad: 1 }]
    })
  }

  function cambiarCantidad(productoId: number, cantidad: number) {
    setCarrito((actual) =>
      actual.map((item) => {
        if (item.producto.id !== productoId) return item
        const stockMax =
          item.producto.stock_actual !== undefined && item.producto.stock_actual !== null
            ? Number(item.producto.stock_actual)
        : null
        const cantFinal = stockMax !== null ? Math.min(cantidad, stockMax) : cantidad
        return { ...item, cantidad: cantFinal }
      }),
    )
  }

  function quitarDelCarrito(productoId: number) {
    setCarrito((actual) => actual.filter((item) => item.producto.id !== productoId))
  }

  async function manejarCobrar() {
    if (!turno || carrito.length === 0 || !metodoPago) return
    if (modoCliente === 'nuevo' && (!datosClienteNuevo.nombre.trim() || !datosClienteNuevo.aceptoPolitica)) {
      setErrorVenta('Completá el nombre del cliente y marcá la aceptación de la política de privacidad.')
      return
    }
    if (modoCliente === 'existente' && !clienteExistente) {
      setErrorVenta('Elegí un cliente de los resultados de la búsqueda antes de cobrar.')
      return
    }

    setProcesandoVenta(true)
    setErrorVenta(null)
    try {
      let clienteId: number | null = null
      if (modoCliente === 'nuevo') {
        const cliente = await crearCliente({
          nombre: datosClienteNuevo.nombre.trim(),
          contacto: datosClienteNuevo.contacto.trim() || undefined,
          fecha_nacimiento: datosClienteNuevo.fechaNacimiento || undefined,
          acepto_politica_privacidad: datosClienteNuevo.aceptoPolitica,
        })
        clienteId = cliente.id
      } else if (modoCliente === 'existente') {
        clienteId = clienteExistente!.id
      }

      const venta = await crearVenta({
        turno_caja_id: turno.id,
        cliente_id: clienteId,
        items: carrito.map((item) => ({ producto_id: item.producto.id, cantidad_venta: item.cantidad })),
        metodo_pago: metodoPago,
        descuento_aplicado: descuento,
        datafono_id: datafonoId,
      })

      if (cuponAplicado) {
        try {
          await canjearCupon(cuponAplicado.id, venta.id)
        } catch {
          // El canje de cupón es complementario a la consolidación de la venta
        }
      }

      setVentaConfirmada(venta)
      reiniciarVentaEnCurso()
    } catch (err) {
      setErrorVenta(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar la venta.')
    } finally {
      setProcesandoVenta(false)
    }
  }

  if (estado === 'sin-sucursal') {
    return (
      <EstadoVacio
        titulo="Tu usuario no tiene sucursal asignada"
        descripcion="No podés operar el punto de venta hasta que Administración te asigne al menos una sucursal."
      />
    )
  }

  if (estado === 'cargando-turno') {
    return <EsqueletoCarga filas={4} alturaPx={56} />
  }

  if (estado === 'error-turno') {
    return <MensajeError mensaje={errorTurno ?? 'Ocurrió un error inesperado.'} onReintentar={cargarTurnoActual} />
  }

  if (estado === 'sin-turno') {
    return (
      <AbrirTurno
        sucursalId={sucursalId!}
        onTurnoAbierto={(nuevoTurno) => {
          setTurno(nuevoTurno)
          setEstado('abierto')
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('turno-caja-actualizado'))
          }
        }}
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header POS */}
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="flex flex-wrap items-center justify-between gap-4 border-b border-surface-bg pb-3">
        <div className="flex items-center gap-3">
          <span className="rounded bg-brand-deep px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            NUEVA VENTA
          </span>
          <div>
            <h1 className="font-display text-title font-bold text-brand-deep">Punto de venta</h1>
            <p className="text-body-sm text-text-secondary">
              Turno abierto desde las {formatearHora(turno!.hora_apertura)} · Fondo inicial{' '}
              {formatearMoneda(turno!.monto_inicial)}
            </p>
          </div>
        </div>
        <Boton variante="secundario" onClick={() => setMostrarCerrarTurno(true)} className="rounded-xl border-2 border-amber-200/90 hover:border-brand-primary">
          Cerrar turno
        </Boton>
      </motion.div>

      {/* Grid Principal de 2 Columnas estilo Mockup */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Columna Izquierda: Catálogo + Últimas ventas (8 cols) */}
        <div className="flex flex-col gap-6 lg:col-span-8 min-h-0">
          <div className="min-h-0 flex-1">
            <BusquedaProductos
              sucursalId={sucursalId!}
              carritoItems={carrito}
              onAgregarAlCarrito={agregarAlCarrito}
            />
          </div>

          {/* Sección Últimas ventas del turno */}
          <div className="rounded-2xl bg-white p-4 shadow-sm border-2 border-amber-200/80">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-body font-bold text-brand-deep">
                Últimas ventas del turno
              </h2>
              <span className="text-label font-semibold text-text-secondary">
                {ultimasVentas.length} transacciones en este turno
              </span>
            </div>

            {ultimasVentas.length === 0 ? (
              <p className="py-4 text-center text-body-sm text-text-secondary">
                Aún no has registrado transacciones en este turno.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-amber-100 text-left text-label uppercase text-text-secondary">
                      <th className="pb-2 font-medium">Documento</th>
                      <th className="pb-2 font-medium">Hora</th>
                      <th className="pb-2 font-medium">Método</th>
                      <th className="pb-2 font-medium text-right">Total</th>
                      <th className="pb-2 font-medium text-right">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ultimasVentas.map((v) => (
                      <tr key={v.id} className="border-b border-amber-100/60 last:border-0 hover:bg-amber-50/50 transition-colors">
                        <td className="py-2.5 font-mono font-medium text-text-primary">{v.numero_documento}</td>
                        <td className="py-2.5 text-text-secondary">
                          {formatearHora(v.hora_inicio_cobro)}
                        </td>
                        <td className="py-2.5 capitalize text-text-secondary">{v.metodo_pago}</td>
                        <td className="py-2.5 text-right font-semibold text-brand-deep">{formatearMoneda(v.total)}</td>
                        <td className="py-2.5 text-right">
                          <BadgeEstado texto={v.estado_venta} color="success" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Columna Derecha: Sidebar de Checkout Integrado (4 cols) */}
        <div className="flex flex-col gap-4 lg:col-span-4 rounded-2xl bg-white p-4 shadow-sm border-2 border-amber-200/80 overflow-y-auto">
          {/* Carrito de compra con steppers y desglose */}
          <Carrito
            items={carrito}
            descuento={descuento}
            onCambiarCantidad={cambiarCantidad}
            onQuitar={quitarDelCarrito}
            onCambiarDescuento={setDescuento}
            onLimpiar={() => {
              setCarrito([])
              manejarRemoverCupon()
            }}
            cuponAplicado={cuponAplicado}
            cuponesCliente={cuponesCliente}
            errorCupon={errorCupon}
            validandoCupon={validandoCupon}
            onAplicarCupon={manejarAplicarCupon}
            onRemoverCupon={manejarRemoverCupon}
          />

          {/* Selector de Cliente */}
          <div className="rounded-xl bg-amber-50/25 p-3.5 border-2 border-amber-200/80 shadow-2xs">
            <ClienteVenta
              modo={modoCliente}
              datos={datosClienteNuevo}
              clienteExistente={clienteExistente}
              onCambiarModo={setModoCliente}
              onCambiarDatos={setDatosClienteNuevo}
              onCambiarClienteExistente={setClienteExistente}
            />
          </div>

          {/* Panel de Método de Pago y Cobro */}
          <PanelPago
            sucursalId={sucursalId!}
            total={calcularTotales(carrito, descuento).total}
            metodoPago={metodoPago}
            datafonoId={datafonoId}
            onCambiarMetodo={setMetodoPago}
            onCambiarDatafono={setDatafonoId}
            puedeCobrar={carrito.length > 0}
            procesando={procesandoVenta}
            errorCheckout={errorVenta}
            onCobrar={manejarCobrar}
          />
        </div>
      </div>

      <AnimatePresence>
        {mostrarCerrarTurno && turno && (
          <CerrarTurno
            turno={turno}
            onCancelar={() => setMostrarCerrarTurno(false)}
            onCerrado={() => {
              setMostrarCerrarTurno(false)
              setTurno(null)
              reiniciarVentaEnCurso()
              setEstado('sin-turno')
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('turno-caja-actualizado'))
              }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {ventaConfirmada && (
          <motion.div
            variants={toastSlideUp}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed bottom-6 right-6 flex items-center gap-3 rounded-2xl border-2 border-amber-200/90 bg-white p-4 shadow-lg z-50"
          >
            <BadgeEstado texto={ventaConfirmada.estado_venta} color="success" />
            <div>
              <p className="text-body font-medium text-text-primary">Venta {ventaConfirmada.numero_documento} registrada</p>
              <p className="text-body-sm text-text-secondary">Total {formatearMoneda(ventaConfirmada.total)}</p>
            </div>
            <button
              type="button"
              onClick={() => setVentaConfirmada(null)}
              aria-label="Cerrar confirmación de venta"
              className="text-body text-text-secondary hover:text-text-primary"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


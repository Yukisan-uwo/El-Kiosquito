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
import { crearCliente, crearVenta, obtenerTurnoActual } from './api'
import { Carrito } from './Carrito'
import { BusquedaProductos } from './BusquedaProductos'
import { CerrarTurno } from './CerrarTurno'
import { ClienteVenta, DATOS_CLIENTE_NUEVO_VACIOS, type DatosClienteNuevo, type ModoCliente } from './ClienteVenta'
import { PanelPago } from './PanelPago'
import type { ClienteExistenteSeleccionado, ItemCarrito, ProductoBusqueda, TurnoCaja, VentaOut } from './tipos'

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
  const [modoCliente, setModoCliente] = useState<ModoCliente>('sin_cliente')
  const [datosClienteNuevo, setDatosClienteNuevo] = useState<DatosClienteNuevo>(DATOS_CLIENTE_NUEVO_VACIOS)
  const [clienteExistente, setClienteExistente] = useState<ClienteExistenteSeleccionado | null>(null)
  const [metodoPago, setMetodoPago] = useState<string | null>(null)
  const [datafonoId, setDatafonoId] = useState<number | null>(null)
  const [procesandoVenta, setProcesandoVenta] = useState(false)
  const [errorVenta, setErrorVenta] = useState<string | null>(null)
  const [ventaConfirmada, setVentaConfirmada] = useState<VentaOut | null>(null)

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

  function reiniciarVentaEnCurso() {
    setCarrito([])
    setDescuento(0)
    setModoCliente('sin_cliente')
    setDatosClienteNuevo(DATOS_CLIENTE_NUEVO_VACIOS)
    setClienteExistente(null)
    setMetodoPago(null)
    setDatafonoId(null)
    setErrorVenta(null)
  }

  function agregarAlCarrito(producto: ProductoBusqueda) {
    setCarrito((actual) => {
      const existente = actual.find((item) => item.producto.id === producto.id)
      if (existente) {
        return actual.map((item) => (item.producto.id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item))
      }
      return [...actual, { producto, cantidad: 1 }]
    })
  }

  function cambiarCantidad(productoId: number, cantidad: number) {
    setCarrito((actual) => actual.map((item) => (item.producto.id === productoId ? { ...item, cantidad } : item)))
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
        // RF-CF-013 (002, enmienda v1.3) — clienteExistente ya fue validado
        // arriba (no null); el id sale de GET /clientes?q=, nunca de un
        // valor que el cajero pueda escribir a mano.
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
        }}
      />
    )
  }

  // estado === 'abierto'
  return (
    <div className="flex h-full flex-col gap-4">
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="flex items-center justify-between">
        <div>
          <p className="font-display text-display-lg text-brand-deep">Punto de venta</p>
          <p className="text-body-sm text-text-secondary">
            Turno abierto desde {new Date(turno!.hora_apertura).toLocaleString('es-EC')} · Inicial{' '}
            {formatearMoneda(turno!.monto_inicial)}
          </p>
        </div>
        <Boton variante="secundario" onClick={() => setMostrarCerrarTurno(true)}>
          Cerrar turno
        </Boton>
      </motion.div>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        <div className="col-span-1 rounded-[var(--radius-card)] bg-surface-bg">
          <BusquedaProductos sucursalId={sucursalId!} onAgregarAlCarrito={agregarAlCarrito} />
        </div>
        <div className="col-span-1 rounded-[var(--radius-card)] bg-surface-bg">
          <Carrito
            items={carrito}
            descuento={descuento}
            onCambiarCantidad={cambiarCantidad}
            onQuitar={quitarDelCarrito}
            onCambiarDescuento={setDescuento}
          />
        </div>
        <div className="col-span-1 space-y-4 overflow-y-auto rounded-[var(--radius-card)] bg-surface-bg p-1">
          <ClienteVenta
            modo={modoCliente}
            datos={datosClienteNuevo}
            clienteExistente={clienteExistente}
            onCambiarModo={setModoCliente}
            onCambiarDatos={setDatosClienteNuevo}
            onCambiarClienteExistente={setClienteExistente}
          />
          <PanelPago
            sucursalId={sucursalId!}
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
            className="fixed bottom-6 right-6 flex items-center gap-3 rounded-[var(--radius-card)] bg-surface-card p-4 shadow-[var(--shadow-elevation-2)]"
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

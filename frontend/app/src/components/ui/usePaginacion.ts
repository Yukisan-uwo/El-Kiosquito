import { useMemo, useState, useEffect } from 'react'

export interface OpcionesPaginacion {
  itemsPorPaginaInicial?: number
}

export function usePaginacion<T>(items: T[], opciones?: OpcionesPaginacion) {
  const itemsPorPaginaInicial = opciones?.itemsPorPaginaInicial ?? 10
  const [paginaActual, setPaginaActual] = useState(1)
  const [itemsPorPagina, setItemsPorPagina] = useState(itemsPorPaginaInicial)

  const totalItems = items.length
  const totalPaginas = Math.max(1, Math.ceil(totalItems / itemsPorPagina))

  // Asegurar que la página actual no sobrepase el total si los datos disminuyen
  useEffect(() => {
    if (paginaActual > totalPaginas) {
      setPaginaActual(totalPaginas)
    }
  }, [paginaActual, totalPaginas])

  const datosPaginados = useMemo(() => {
    const inicio = (paginaActual - 1) * itemsPorPagina
    return items.slice(inicio, inicio + itemsPorPagina)
  }, [items, paginaActual, itemsPorPagina])

  const cambiarPagina = (nuevaPagina: number) => {
    const paginaClamped = Math.max(1, Math.min(nuevaPagina, totalPaginas))
    setPaginaActual(paginaClamped)
  }

  const cambiarItemsPorPagina = (nuevosItems: number) => {
    setItemsPorPagina(nuevosItems)
    setPaginaActual(1)
  }

  const reiniciarPagina = () => {
    setPaginaActual(1)
  }

  return {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
    reiniciarPagina,
  }
}

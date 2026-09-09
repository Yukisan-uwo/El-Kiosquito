import { useState } from 'react'
import type { ProductoBusqueda } from './tipos'

/**
 * Mapeo curado de imágenes optimizadas para productos del catálogo de El Kiosquito.
 * Utiliza URLs de alto rendimiento con dimensiones ajustadas para POS.
 */
const IMAGENES_PRODUCTOS: Record<string, string> = {
  // Bebidas
  'coca-cola': 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=260&auto=format&fit=crop&q=80',
  'pilsener': 'https://images.unsplash.com/photo-1608270146039-44670c3c8cf3?w=260&auto=format&fit=crop&q=80',
  'manantial': 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=260&auto=format&fit=crop&q=80',
  'del valle': 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=260&auto=format&fit=crop&q=80',
  'gatorade': 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=260&auto=format&fit=crop&q=80',
  'nescafé': 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=260&auto=format&fit=crop&q=80',
  'red bull': 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=260&auto=format&fit=crop&q=80',
  'tesalia': 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=260&auto=format&fit=crop&q=80',
  'ades': 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=260&auto=format&fit=crop&q=80',

  // Snacks
  'ruffles': 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=260&auto=format&fit=crop&q=80',
  'doritos': 'https://images.unsplash.com/photo-1600952841320-db92ec4047ca?w=260&auto=format&fit=crop&q=80',
  'cheetos': 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=260&auto=format&fit=crop&q=80',
  'chifles': 'https://images.unsplash.com/photo-1621996346565-e3d5d6281682?w=260&auto=format&fit=crop&q=80',
  'maní': 'https://images.unsplash.com/photo-1569466896818-335b1bedfcce?w=260&auto=format&fit=crop&q=80',
  'tortrix': 'https://images.unsplash.com/photo-1600952841320-db92ec4047ca?w=260&auto=format&fit=crop&q=80',
  'ritz': 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=260&auto=format&fit=crop&q=80',
  'manicho': 'https://images.unsplash.com/photo-1548907040-4baa42d10919?w=260&auto=format&fit=crop&q=80',
  'chocolate': 'https://images.unsplash.com/photo-1548907040-4baa42d10919?w=260&auto=format&fit=crop&q=80',
  'trident': 'https://images.unsplash.com/photo-1582293041079-7814c2f12063?w=260&auto=format&fit=crop&q=80',
  'cereal': 'https://images.unsplash.com/photo-1600952841320-db92ec4047ca?w=260&auto=format&fit=crop&q=80',

  // Lácteos
  'leche toni': 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=260&auto=format&fit=crop&q=80',
  'leche': 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=260&auto=format&fit=crop&q=80',
  'yogurt toni': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=260&auto=format&fit=crop&q=80',
  'yogurt': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=260&auto=format&fit=crop&q=80',
  'queso': 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=260&auto=format&fit=crop&q=80',
  'mantequilla': 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=260&auto=format&fit=crop&q=80',
  'crema': 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=260&auto=format&fit=crop&q=80',

  // Abarrotes
  'arroz': 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=260&auto=format&fit=crop&q=80',
  'azúcar': 'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?w=260&auto=format&fit=crop&q=80',
  'aceite': 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=260&auto=format&fit=crop&q=80',
  'atún': 'https://images.unsplash.com/photo-1544943910-4c1dc44a055a?w=260&auto=format&fit=crop&q=80',
  'sal': 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=260&auto=format&fit=crop&q=80',
  'fideos': 'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=260&auto=format&fit=crop&q=80',
  'sardina': 'https://images.unsplash.com/photo-1544943910-4c1dc44a055a?w=260&auto=format&fit=crop&q=80',
  'salsa de tomate': 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=260&auto=format&fit=crop&q=80',
  'mayonesa': 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=260&auto=format&fit=crop&q=80',
  'huevos': 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=260&auto=format&fit=crop&q=80',
  'menestra': 'https://images.unsplash.com/photo-1515543237350-b3eea1ec8082?w=260&auto=format&fit=crop&q=80',

  // Limpieza
  'detergente': 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=260&auto=format&fit=crop&q=80',
  'cloro': 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=260&auto=format&fit=crop&q=80',
  'jabón de lavar': 'https://images.unsplash.com/photo-1607006314144-8d4e56ebfbce?w=260&auto=format&fit=crop&q=80',
  'esponja': 'https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?w=260&auto=format&fit=crop&q=80',
  'glade': 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=260&auto=format&fit=crop&q=80',
  'basura': 'https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?w=260&auto=format&fit=crop&q=80',
  'sapolio': 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=260&auto=format&fit=crop&q=80',

  // Cuidado Personal
  'palmolive': 'https://images.unsplash.com/photo-1607006314144-8d4e56ebfbce?w=260&auto=format&fit=crop&q=80',
  'shampoo': 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=260&auto=format&fit=crop&q=80',
  'sedal': 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=260&auto=format&fit=crop&q=80',
  'papel': 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a?w=260&auto=format&fit=crop&q=80',
  'colgate': 'https://images.unsplash.com/photo-1559599101-f09722fb4948?w=260&auto=format&fit=crop&q=80',
  'pasta dental': 'https://images.unsplash.com/photo-1559599101-f09722fb4948?w=260&auto=format&fit=crop&q=80',
  'rexona': 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=260&auto=format&fit=crop&q=80',
  'desodorante': 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=260&auto=format&fit=crop&q=80',
  'gillette': 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=260&auto=format&fit=crop&q=80',

  // Panadería
  'pan': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=260&auto=format&fit=crop&q=80',
  'galletas maría': 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=260&auto=format&fit=crop&q=80',
  'torta': 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=260&auto=format&fit=crop&q=80',

  // Congelados
  'helado': 'https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=260&auto=format&fit=crop&q=80',
  'pingüino': 'https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=260&auto=format&fit=crop&q=80',
  'nuggets': 'https://images.unsplash.com/photo-1562967914-608f82629710?w=260&auto=format&fit=crop&q=80',
  'papas fritas': 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=260&auto=format&fit=crop&q=80',
  'hamburguesas': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=260&auto=format&fit=crop&q=80',
  'paleta': 'https://images.unsplash.com/photo-1505394033641-40c6ad1178d7?w=260&auto=format&fit=crop&q=80',
}

export function resolverUrlImagen(nombre: string): string | null {
  const norm = nombre.toLowerCase().trim()
  for (const [clave, url] of Object.entries(IMAGENES_PRODUCTOS)) {
    if (norm.includes(clave)) {
      return url
    }
  }
  return null
}

interface IlustracionCategoriaProps {
  categoria?: string
  tamano?: 'sm' | 'md' | 'lg'
}

export function IlustracionCategoria({ categoria = '', tamano = 'md' }: IlustracionCategoriaProps) {
  const cat = categoria.toLowerCase()
  const dim = tamano === 'sm' ? 'h-6 w-6' : tamano === 'lg' ? 'h-20 w-20' : 'h-14 w-14'

  // Bebidas: Botella y lata de refresco
  if (cat.includes('bebida')) {
    return (
      <svg className={`${dim} text-amber-600/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6h12v4H18z" fill="currentColor" fillOpacity="0.15" />
        <path d="M18 10l-2 6v22a4 4 0 004 4h8a4 4 0 004-4V16l-2-6" />
        <path d="M16 22h16" />
        <circle cx="24" cy="30" r="3" fill="currentColor" fillOpacity="0.25" />
        <path d="M36 18v18a3 3 0 01-3 3h-2" strokeDasharray="2 3" />
      </svg>
    )
  }

  // Snacks: Paquete de papitas/nachos crujientes
  if (cat.includes('snack')) {
    return (
      <svg className={`${dim} text-orange-600/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 10l3-4h18l3 4v28l-3 4H15l-3-4V10z" fill="currentColor" fillOpacity="0.15" />
        <path d="M18 20l6-4 6 4-6 8-6-8z" fill="currentColor" fillOpacity="0.3" />
        <path d="M12 10l6 2 6-2 6 2 6-2" />
        <path d="M12 38l6-2 6 2 6-2 6 2" />
      </svg>
    )
  }

  // Lácteos: Cartón de leche fresca y queso
  if (cat.includes('lácteo') || cat.includes('lacteo')) {
    return (
      <svg className={`${dim} text-sky-600/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 8h16l-3-4H19l-3 4z" fill="currentColor" fillOpacity="0.2" />
        <path d="M16 8v30a4 4 0 004 4h8a4 4 0 004-4V8L24 12 16 8z" fill="currentColor" fillOpacity="0.1" />
        <path d="M16 24h16" />
        <circle cx="24" cy="31" r="3.5" fill="currentColor" fillOpacity="0.25" />
      </svg>
    )
  }

  // Abarrotes: Canasta de víveres / lata de conserva
  if (cat.includes('abarrote')) {
    return (
      <svg className={`${dim} text-amber-700/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="24" cy="12" rx="14" ry="5" fill="currentColor" fillOpacity="0.2" />
        <path d="M10 12v18c0 2.76 6.27 5 14 5s14-2.24 14-5V12" />
        <ellipse cx="24" cy="21" rx="14" ry="4" strokeDasharray="2 3" />
        <path d="M18 26h12" />
        <path d="M24 6v6" />
      </svg>
    )
  }

  // Limpieza: Botella atomizadora con destellos
  if (cat.includes('limpieza')) {
    return (
      <svg className={`${dim} text-teal-600/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 6h8l2 6h-12l2-6z" />
        <path d="M22 12v4l-6 6v16a4 4 0 004 4h8a4 4 0 004-4V22l-4-6" fill="currentColor" fillOpacity="0.15" />
        <path d="M16 12h-4l-2 4 4 1" />
        <circle cx="36" cy="12" r="2" fill="currentColor" />
        <circle cx="38" cy="20" r="1.5" fill="currentColor" />
      </svg>
    )
  }

  // Cuidado personal: Dispensador y cuidado
  if (cat.includes('cuidado') || cat.includes('personal')) {
    return (
      <svg className={`${dim} text-pink-600/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6h8v4h-8z" fill="currentColor" fillOpacity="0.2" />
        <path d="M24 6V2m0 0h-6" />
        <path d="M16 14a4 4 0 014-4h8a4 4 0 014 4v24a4 4 0 01-4 4H20a4 4 0 01-4-4V14z" fill="currentColor" fillOpacity="0.12" />
        <circle cx="24" cy="24" r="3.5" fill="currentColor" fillOpacity="0.3" />
      </svg>
    )
  }

  // Panadería: Pan horneado / trigo
  if (cat.includes('panad') || cat.includes('pan')) {
    return (
      <svg className={`${dim} text-amber-800/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 24c0-7 6.27-12 14-12s14 5 14 12c0 6-5 10-14 10s-14-4-14-10z" fill="currentColor" fillOpacity="0.18" />
        <path d="M18 20l2 6" />
        <path d="M24 19v7" />
        <path d="M30 20l-2 6" />
      </svg>
    )
  }

  // Congelados: Helado o copo de nieve
  if (cat.includes('congelado') || cat.includes('helado')) {
    return (
      <svg className={`${dim} text-cyan-600/90`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 20a8 8 0 1116 0c0 4-4 6-8 16-4-10-8-12-8-16z" fill="currentColor" fillOpacity="0.18" />
        <path d="M24 4v4m0 28v4m-12-18h4m16 0h4" />
        <path d="M17 13l3 3m8-3l-3 3" />
      </svg>
    )
  }

  // Fallback General: Bolsa de compras de tienda
  return (
    <svg className={`${dim} text-brand-primary/80`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14h28l-3 26H13L10 14z" fill="currentColor" fillOpacity="0.15" />
      <path d="M18 14V10a6 6 0 0112 0v4" />
      <circle cx="24" cy="27" r="3" fill="currentColor" fillOpacity="0.25" />
    </svg>
  )
}

interface ImagenProductoProps {
  producto: ProductoBusqueda
  tamano?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ImagenProducto({ producto, tamano = 'md', className = '' }: ImagenProductoProps) {
  const [errorCarga, setErrorCarga] = useState(false)
  const urlResuelta = (producto as unknown as { imagen_url?: string }).imagen_url || resolverUrlImagen(producto.nombre)

  if (!urlResuelta || errorCarga) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <IlustracionCategoria categoria={producto.categoria_nombre} tamano={tamano} />
      </div>
    )
  }

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`}>
      <img
        src={urlResuelta}
        alt={producto.nombre}
        loading="lazy"
        onError={() => setErrorCarga(true)}
        className="h-full w-full object-contain drop-shadow-xs transition-transform duration-200 group-hover:scale-105"
      />
    </div>
  )
}

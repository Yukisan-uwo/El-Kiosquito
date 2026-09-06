# Prompt para IA generadora de interfaces — El Kiosquito

> Copiar y pegar este documento completo como prompt inicial. Adjuntar
> también, si la herramienta lo permite, `frontend/mockups/login.html`
> y `frontend/mockups/dashboard.html` (referencia visual ya validada
> del sistema de diseño — no son plantillas genéricas, son la fuente de
> verdad de estilo).

## 1. Qué es el producto (para que no generes un dashboard SaaS genérico)

El Kiosquito es una **cadena propia de minimarkets de barrio** (Ecuador)
— no una plataforma de intermediación, no un SaaS multi-tenant. Es
software de gestión interna para 4 roles con alcance distinto:

- **Dueño / Gerencia General** — ve la red completa consolidada, no
  opera el día a día. Consume analítica estratégica y el asistente
  conversacional.
- **Encargado de Compras** — rol corporativo (toda la red), gestiona
  proveedores y órdenes de compra.
- **Encargado de Sucursal** — ve y gestiona SOLO su(s) sucursal(es)
  asignada(s): precios locales, inventario, caducidad, fidelización,
  prevención de pérdidas.
- **Cajero/Vendedor** — punto de venta de una sola sucursal: ventas,
  cobro, cuadre de caja, demanda insatisfecha.

Esto importa para las interfaces: **el sidebar y el contenido cambian
por rol, no es una sola app con toggles** — un cajero nunca ve un menú
de "comparar sucursales" ni siquiera deshabilitado, porque no se
renderiza.

## 2. Identidad visual — no negociable, ya está fijada

**No inventes paleta, tipografía ni layout nuevos.** Estos valores ya
están decididos y en producción (tokens de Tailwind reales, no una
sugerencia):

```
Primario (acción)     #0F6E5C   verde esmeralda profundo
Primario texto        #0B5445
Primario suave (bg)   #E1F0EC
Profundo de marca     #0B2E2A   sidebar, headers de tabla — NUNCA fondo de card
Acento                #E8871E   naranja mango — borde/ícono/línea, NUNCA área grande, NUNCA texto sobre claro
Fondo general         #FAF6EE   crema cálido (no blanco, no gris frío)
Superficie/card       #FFFFFF
Texto primario        #1F2B27
Texto secundario      #5C6B65
Éxito #1E7D4F · Peligro #A32E1F · Advertencia #C77D1E · Información #2F6B8C

Fuente display: Fraunces (serif con carácter, para KPIs y títulos de página)
Fuente interfaz: Inter o Plus Jakarta Sans (todo lo demás)
```

Escala tipográfica (6 niveles, nunca más de 3 a la vez en una pantalla
fuera del shell):

| Token | Tamaño/interlineado | Peso | Fuente | Uso |
|---|---|---|---|---|
| display-xl | 40/44px | 600 | Fraunces | Cifra de KPI hero |
| display-lg | 28/34px | 600 | Fraunces | Título de página |
| title | 20/28px | 600 | Inter | Título de card/sección |
| body | 15/22px | 400 | Inter | Tabla, formularios |
| body-sm | 13/18px | 400 | Inter | Metadatos, timestamps |
| label | 12/16px, uppercase, tracking 0.04em | 600 | Inter | Header de columna, badge |

Espaciado: base 4px (4/8/12/16/24/32/48/64). Padding de card: 24px.
Radio de card/botón: 12px. Radio de badge/chip: 999px (píldora).
Elevación: máximo 2 niveles simultáneos en pantalla — un tercero es
señal de que la jerarquía de información falló, no un problema de
sombra.

## 3. Los 4 principios que hacen esto distinto (aplicalos, no los repitas como texto)

1. **Jerarquía por tipografía y espacio, no por color.** El color es
   solo para estado y para las dos acciones de marca. Nada de 6 KPIs
   en verde esmeralda — el tamaño/peso de fuente hace la jerarquía.
2. **Restricción sobre densidad.** Cada pantalla muestra lo que ese rol
   necesita ACCIONAR, no todo lo que la base de datos podría mostrar.
   Menos filas y menos widgets que un dashboard genérico, no más.
3. **Movimiento con propósito, nunca decorativo** (ver sección 5 — esto
   responde directamente a "quiero dinámico, no estático, pero sin
   abusar").
4. **Un solo lugar de verdad por token** — nada de un color o un
   tamaño escrito suelto en un componente.

**Inspiración de referencia, NO plantilla:** de Linear tomamos la
progresión lineal sin zig-zag y la paleta casi monocromática con
acentos selectivos; de Stripe tomamos la restricción de densidad y
mostrar la comparación contra el periodo anterior junto a cada cifra.
Ninguno de los dos usa verde esmeralda/mango, Fraunces, ni sidebar por
rol — la combinación de esos tres elementos es lo que hace que esto NO
se vea como otro dashboard genérico de plantilla.

## 4. Checklist anti-genérico (rechazar si el resultado cae en esto)

- ❌ Hero con gradiente morado/azul genérico de "SaaS moderno".
- ❌ Sidebar blanco con íconos outline genéricos tipo Heroicons sin
  jerarquía — el sidebar es `#0B2E2A` (verde profundo), oscuro,
  siempre.
- ❌ Cards de KPI todas del mismo color con un ícono decorativo grande
  — la jerarquía es tipográfica (ver sección 2), el ícono es
  secundario o no existe.
- ❌ Tipografía sans-serif única de punta a punta — Fraunces DEBE
  aparecer en cifras hero y títulos de página, es lo que le da carácter
  propio frente a cualquier plantilla de Tailwind UI/shadcn genérica.
- ❌ Animaciones tipo "todo hace bounce/fade al hover" — ver catálogo
  cerrado de usos en la sección 5, nada fuera de esa lista.
- ❌ Fondo blanco puro (`#FFFFFF`) de página — el fondo de página es
  `#FAF6EE` (crema cálido), blanco es solo para cards.

## 5. Movimiento — cuánto dinamismo (ni estático, ni excesivo)

Esta es la respuesta directa a "dinámico pero sin abusar": el
movimiento está en un catálogo CERRADO de situaciones, nunca libre.
Fuera de esta lista, no se anima nada:

| Situación | Qué pasa | Por qué |
|---|---|---|
| Entrada de página | Contenedor con fade+subida de 8px, hijos en stagger de 0.04s | Explica qué es nuevo sin saltos |
| Card de KPI al montar | Scale-in sutil (0.97→1) | Confirma que el número ya está calculado |
| Fila de tabla que cambia de estado | Layout animation del badge de estado | El cambio de estado es el evento de negocio más importante de esa fila |
| Modal/drawer | Scale-in + overlay fade | Estándar de foco, sin desplazar el layout |
| Toast | Entra desde abajo, sale a los 4s | Nunca bloquea la siguiente acción |
| Entrada de la app (una sola vez por sesión) | Lottie corto (trazo del isotipo dibujándose + barrido de degradé) | Cinemática, pero 100% omitible con un clic o tecla |

Duraciones: rápido 0.15s, base 0.25s, lento 0.4s. Nada dura más de
0.4s salvo la cinemática de entrada. `prefers-reduced-motion` desactiva
todo lo anterior a opacidad simple sin desplazamiento/escala.

## 6. Componentes base ya definidos

- **Botón primario**: fondo `#0F6E5C`, texto blanco, radio 12px.
  Secundario: borde 1px del mismo verde, fondo transparente. Ghost:
  sin borde, para acciones terciarias de tabla. Peligro (`#A32E1F`):
  solo para acciones irreversibles, nunca comparte color con un badge
  de estado.
- **Badge de estado**: píldora, texto en mayúsculas (`label`), fondo
  "-soft" del color semántico. El texto viene siempre de un catálogo
  de datos real, nunca inventado por el componente.
- **Card KPI**: `label` → cifra grande (`display-xl`/`display-lg`,
  Fraunces) → línea secundaria comparando contra el periodo anterior →
  **si el dato viene de un modelo de ML, pie obligatorio con tamaño de
  muestra y periodo cubierto** (esto es un requisito real del proyecto,
  no un detalle visual — nunca lo omitas en un mockup de KPI de
  analítica).
- **Tabla**: header `#0B2E2A` con texto blanco, hover de fila en
  `#FAF6EE`, alto de fila 44px, diseñada para paginar/virtualizar (se
  espera volumen real, no 10 filas de demo).
- **Estados vacíos**: nunca "no hay datos" a secas — siempre qué
  significa el vacío y la acción que sigue.
- **Loading**: skeleton con la geometría del contenido final, nunca un
  spinner genérico centrado.
- **Sidebar**: `#0B2E2A`, muestra solo los módulos que el rol puede
  ver. Ítem activo: borde izquierdo de 3px en `#E8871E` (único uso de
  acento como línea sólida grande).

## 7. Accesibilidad (no es opcional, es requisito del proyecto)

WCAG 2.1 AA. Navegación 100% por teclado (Tab/Shift+Tab en orden
visual, Esc cierra modal, anillo de foco siempre visible). Ningún
ícono solo-color transmite estado — siempre con texto/aria-label.
Gráficos con patrón/forma además de color, más una tabla de datos
alternativa.

## 8. Pantallas a generar (por rol)

Generar primero estas, en este orden de prioridad:

1. **Login** con la cinemática de la sección 5 (ya hay referencia en
   `mockups/login.html`).
2. **Dashboard Dueño** — consolidado de toda la red: KPIs de margen,
   merma, ticket promedio, comparación entre sucursales, acceso al
   asistente conversacional (input de lenguaje natural + respuestas
   basadas en datos reales, nunca inventadas).
3. **POS / Punto de venta (Cajero)** — pantalla de alta frecuencia de
   uso, optimizada para velocidad de cobro (<90 seg por venta es una
   meta real del proyecto): búsqueda rápida de producto, carrito,
   registro de demanda insatisfecha cuando falta stock, cuadre de caja
   al cierre de turno.
4. **Dashboard Encargado de Sucursal** — su sucursal únicamente:
   inventario, caducidad, precios locales, fidelización, prevención de
   pérdidas.
5. **Compras y Proveedores (Encargado de Compras)** — órdenes de
   compra, catálogo de proveedores, alerta cuando una compra por oferta
   contradice el pronóstico de demanda (con el motivo obligatorio a
   registrar).
6. **Administración** — gestión de sucursales, usuarios/roles,
   catálogos.

Cada pantalla debe reflejar el principio 2 (restricción sobre
densidad): mostrar solo lo que ese rol puede accionar, no todo el
modelo de datos disponible.

## 9. Resultado esperado

Mockups de alta fidelidad (HTML/CSS o React+Tailwind, como prefiera la
herramienta) que se vean como la continuación exacta de
`mockups/login.html` y `mockups/dashboard.html` — mismo sistema de
diseño, mismas reglas de movimiento, mismos componentes — nunca como
una interfaz nueva con su propia identidad. El objetivo es tener
referencia visual para las pantallas que faltan antes de escribir el
código React final.

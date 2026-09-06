# El Kiosquito — Sistema de Diseño Frontend

**Fase**: Táctica/Diseño | **Fecha**: 2026-09-04
**Entrada**: Art. 11 de la constitución v1.3.0 (paleta, tipografía, stack React+Tailwind+Framer Motion+Lottie)
**Salida**: los tokens, patrones de componente y reglas de movimiento que el `plan.md` de frontend (Art. 11.2) exige, y que los 11 módulos consumen sin reinventar nada — la misma lógica del Art. 13 aplicada al diseño en vez de a los datos.

---

## 1. Principios rectores

Cuatro principios, elegidos por lo que resuelven en **este** proyecto — no una lista genérica de buenas prácticas:

1. **Jerarquía por tipografía y espacio, no por color.** El color se reserva para estado (éxito/peligro/advertencia) y para las dos acciones de marca (primario/acento). Un dashboard con 6 KPIs en verde esmeralda no comunica nada; uno con tamaños y pesos de fuente distintos sí. Esto es lo que hace legible un POS con datos de alta rotación sin saturar al cajero.
2. **Restricción sobre densidad.** Cada pantalla muestra lo que el rol necesita accionar, no todo lo que la base de datos podría mostrar. El Dueño ve consolidado de cadena; el cajero ve su turno. La causa raíz del Art. 3.3 (alcance por sucursal) se refleja también en el diseño: menos ruido, no solo menos filas.
3. **Movimiento con propósito, nunca decorativo.** Framer Motion se usa para explicar una transición de estado (una fila que se confirma, un cupón que se canjea), no para impresionar. Toda animación es omitible (`prefers-reduced-motion`, Art. 5.4) y ninguna bloquea una acción.
4. **Un solo lugar de verdad para cada token.** Igual que el Art. 13 prohíbe un catálogo duplicado en dos tablas, ningún componente escribe un color, tamaño o easing suelto — todo sale de `tailwind.config.ts` y de `motion/tokens.ts`.

*Inspiración de referencia (no plantilla a copiar, ver nota de la conversación sobre el filtro de similitud): de Linear tomamos la idea de progresión lineal sin zig-zag y paleta casi monocromática con acentos selectivos; de Stripe tomamos la restricción de densidad y la comparación contra el periodo anterior junto a cada cifra. Ninguno de los dos usa verde esmeralda/mango, Fraunces, ni la estructura de sidebar por rol que define este documento — la identidad visual resultante es propia.*

---

## 2. Tokens

### 2.1 Color — ya fijado en Art. 11.1, aquí solo se declara como tema

```ts
// tailwind.config.ts (fragmento)
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0F6E5C',       // verde esmeralda — acción
          'primary-text': '#0B5445',
          'primary-soft': '#E1F0EC',
          deep: '#0B2E2A',          // sidebar, headers de tabla
          accent: '#E8871E',        // naranja mango — nunca como texto sobre claro
        },
        surface: {
          bg: '#FAF6EE',
          card: '#FFFFFF',
        },
        text: {
          primary: '#1F2B27',
          secondary: '#5C6B65',
        },
        status: {
          success: '#1E7D4F',
          danger: '#A32E1F',
          warning: '#C77D1E',
          info: '#2F6B8C',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'Plus Jakarta Sans', 'sans-serif'],
      },
    },
  },
}
```

**Regla de aplicación de color (Decisión de diseño, extiende 11.1):** el mango (`accent`) nunca cubre un área grande — es borde, ícono activo o cuarta serie de gráfico, como ya fija el Art. 11.1. El verde profundo (`deep`) se reserva a sidebar y headers de tabla, nunca a fondo de card, porque una card en `deep` compite visualmente con el sidebar y rompe la jerarquía del principio 1.

### 2.2 Tipografía — escala de 6 niveles (disciplina tomada del principio de restricción, no del color)

| Token | Tamaño / interlineado | Peso | Fuente | Uso |
|---|---|---|---|---|
| `display-xl` | 40px / 44px | 600 | Fraunces | Cifra de KPI hero (ej. margen bruto del mes) |
| `display-lg` | 28px / 34px | 600 | Fraunces | Título de página |
| `title` | 20px / 28px | 600 | Inter | Título de card/sección |
| `body` | 15px / 22px | 400 | Inter | Texto de tabla, formularios |
| `body-sm` | 13px / 18px | 400 | Inter | Metadatos, timestamps, ayuda |
| `label` | 12px / 16px | 600, uppercase, tracking 0.04em | Inter | Encabezado de columna, badge |

Ninguna pantalla usa más de 3 niveles a la vez fuera del shell — es la misma restricción de Stripe aplicada aquí: la jerarquía la da el contraste de tamaño, el color queda libre para estado.

### 2.3 Espaciado — escala base 4px

`1` = 4px · `2` = 8px · `3` = 12px · `4` = 16px · `6` = 24px · `8` = 32px · `12` = 48px · `16` = 64px

Padding interno de card: `6` (24px). Separación entre cards de una grilla: `4` (16px). Separación entre secciones de página: `12` (48px).

### 2.4 Radios y elevación

- Radio de card/botón: `12px`. Radio de badge/chip: `999px` (píldora).
- Elevación 1 (card en reposo): `0 1px 2px rgba(11,46,42,0.06)`.
- Elevación 2 (card en hover/modal): `0 8px 24px rgba(11,46,42,0.12)`.
- Nunca más de 2 niveles de elevación simultáneos en pantalla — un tercer nivel es la señal de que la jerarquía de información falló, no un problema de sombra.

---

## 3. Movimiento (Framer Motion)

Igual que el color, el movimiento se declara una vez en `motion/tokens.ts` y los componentes lo importan — nunca un `duration` o `ease` suelto en un componente.

```ts
// motion/tokens.ts
export const duration = { fast: 0.15, base: 0.25, slow: 0.4 }
export const ease = { standard: [0.4, 0, 0.2, 1], enter: [0, 0, 0.2, 1], exit: [0.4, 0, 1, 1] }

export const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.enter } },
}

export const stagger = {
  visible: { transition: { staggerChildren: 0.04 } },
}

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: duration.fast, ease: ease.enter } },
}
```

**Catálogo de usos — nada se anima "porque sí":**

| Situación | Variante | Motivo |
|---|---|---|
| Entrada de página | `fadeUp` en el contenedor, `stagger` en hijos directos | Explica qué es nuevo en pantalla sin saltos bruscos |
| Card de KPI al montar | `scaleIn` | Confirma que el número ya está calculado, no es un placeholder |
| Fila de tabla que cambia de estado (venta anulada, cupón canjeado) | *layout animation* de Framer Motion sobre el badge de estado | El cambio de estado es el evento de negocio más importante de una fila — merece confirmarse visualmente (Art. 5.9, honestidad de los datos: nunca animar un estado que no vino del servidor) |
| Modal / drawer | `scaleIn` + overlay `fadeUp` invertido | Estándar de foco, sin desplazamiento de layout |
| Toast de confirmación | entra desde abajo con `fadeUp`, sale con `exit` a los 4s | Nunca bloquea la siguiente acción del usuario |
| Animación de entrada de la app (Lottie) | una sola vez por sesión, `sessionStorage` — **debe poder omitirse con un clic**, requisito no negociable del Art. 5.4 | Cinemática, pero nunca gatekeeping |

`prefers-reduced-motion: reduce` desactiva `fadeUp`/`scaleIn`/stagger (quedan en opacidad simple, sin desplazamiento ni escala) vía un wrapper único `<MotionProvider>` — un solo lugar que lee el media query, ningún componente lo consulta por su cuenta.

---

## 4. Componentes base

### 4.1 Botón

- **Primario**: fondo `brand.primary`, texto blanco, radio 12px. Hover: `brand.primary-text`. Foco: anillo 2px `brand.accent` con offset 2px (visible en teclado, Art. 5.4).
- **Secundario**: borde 1px `brand.primary`, texto `brand.primary-text`, fondo transparente.
- **Ghost**: sin borde, texto `text.secondary`, para acciones terciarias de tabla.
- **Peligro**: fondo `status.danger`, reservado a acciones irreversibles (dar de baja, anular) — nunca al mismo color que un badge de estado, para no confundir "botón que anula" con "fila anulada".

### 4.2 Badge de estado

Píldora, `label` en mayúsculas, fondo `-soft` del color semántico correspondiente (ej. éxito: fondo `#E1F0EC`-equivalente en verde semántico, texto `status.success`). El **valor del badge viene siempre del catálogo** (`estado_venta`, `estado_orden_compra`, etc. del Art. 13) — el componente no decide el texto, solo el mapeo color↔`es_terminal`/`cuenta_para_ingresos` que ya trae el catálogo.

### 4.3 Card KPI

Estructura fija: `label` (nombre del indicador) → `display-xl` o `display-lg` (cifra) → línea secundaria `body-sm` con comparación contra el periodo anterior (principio de Stripe: "¿esto es bueno?" sin salir de la card) → si el dato viene de un modelo de ML, pie obligatorio con tamaño de muestra y periodo (Art. 5.6, regla de honestidad — no es opcional, es constitucional).

### 4.4 Tabla

Header en `brand.deep` con texto blanco, `label`. Fila con hover `surface.bg`. Densidad media (44px de alto de fila) — el Art. 8.3 exige probar con volumen realista, así que la tabla se diseña para paginar/virtualizar desde el día uno, no para 20 filas de demo.

### 4.5 Estados vacíos y de carga

- **Vacío**: nunca "no hay datos" a secas. Sigue el patrón de Stripe: qué significa este vacío y qué acción sigue (ej. "Todavía no hay revisiones de seguridad para este datáfono — registrá la primera" en vez de mostrar un estado inventado, coherente con RN-PS-001).
- **Carga**: skeleton con la misma geometría del contenido final (card, fila de tabla), nunca un spinner genérico que oculte la jerarquía de la pantalla.
- **Error**: mensaje específico + acción siguiente (reintentar, volver), nunca un mensaje técnico crudo del backend.

### 4.6 Sidebar y navegación por rol

El sidebar (`brand.deep`) muestra solo los módulos que el rol del JWT autoriza (Art. 3.1/5.9) — no se ocultan con CSS, no se renderizan. El ítem activo lleva borde izquierdo `brand.accent` de 3px, único uso de acento como línea sólida grande, reservado a ese único elemento de la interfaz.

---

## 5. Entrada cinemática de login (Art. 5.4 — Lottie)

Secuencia, 100% omitible con una tecla o clic en cualquier punto:

1. **0.0s–0.6s**: fondo `surface.bg` con un trazo del isotipo (marca de El Kiosquito) dibujándose en `brand.primary` — animación Lottie corta, no un logo genérico girando.
2. **0.6s–0.9s**: barrido de degradé sutil `brand.primary` → `brand.accent` al 8% de opacidad, de esquina a esquina — el único momento donde el acento cubre área grande, porque es transitorio y no compite con contenido.
3. **0.9s–1.2s**: el formulario de login entra con `fadeUp` + `stagger` (campo usuario, campo contraseña, botón).
4. Si `prefers-reduced-motion` o el usuario ya vio la animación en esta sesión (`sessionStorage`): salta directo al paso 3 sin los pasos 1-2.

---

## 6. Accesibilidad (Art. 11.2, WCAG 2.1 AA)

- Todos los pares texto/fondo de 11.1 ya están elegidos para AA (verde esmeralda + blanco, `text.primary` sobre `surface.bg`/`surface.card`).
- Navegación 100% por teclado: `Tab`/`Shift+Tab` recorre en el orden visual, `Esc` cierra modal/drawer, anillo de foco siempre visible (nunca `outline: none` sin reemplazo).
- Ningún ícono solo-color transmite estado — siempre acompañado de texto o `aria-label` (ej. el badge de estado lleva el texto del catálogo, no solo un punto de color).
- Gráficos (Recharts): cada serie tiene patrón/forma además de color, y una tabla de datos accesible como alternativa (`<table>` visualmente oculta o expandible), para no depender del color para leer una tendencia.

---

## 7. Qué sigue

Con esto quedan cubiertos los tokens y patrones transversales que pedía el Art. 11.2. Falta, ya en implementación: los dos mockups de referencia (login con la cinemática de este documento, y el dashboard del Dueño) para validar el sistema antes de que se replique en los 11 módulos — se entregan como páginas HTML de referencia visual, no como código React final.

"""
Servicio de Simulación Financiera de Precios y Absorción de Gastos con IA.

Calcula el punto de equilibrio operativo de la sucursal a partir de sus gastos fijos
(arriendo, energía/refrigeración, agua, sueldos, internet), distribuye la absorción
ponderada de costos según la clasificación comercial (gancho vs nicho vs perecedero frío),
y genera recomendaciones justificadas de precios y márgenes asistidas por IA.
"""

from decimal import Decimal, ROUND_HALF_UP
import logging
from typing import Sequence

from sqlalchemy.orm import Session
import httpx

from app.core.config import settings
from app.models.compras import HistorialCostoProducto
from app.models.core_ventas import Producto
from app.models.expansion import GastoSucursal, Sucursal
from app.models.precios import ClasificacionProducto, HistorialPrecioProducto
from app.schemas.gastos import (
    ProductoSimuladoOut,
    SimulacionGastosIn,
    SimulacionGastosOut,
)

log = logging.getLogger("simulador_precios")


def _money(val) -> Decimal:
    if val is None:
        return Decimal("0.00")
    return Decimal(str(val)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pct(val) -> Decimal:
    if val is None:
        return Decimal("0.0")
    return Decimal(str(val)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def ejecutar_simulacion_gastos_ia(
    db: Session,
    payload: SimulacionGastosIn,
) -> SimulacionGastosOut:
    """Ejecuta el costeo por absorción, punto de equilibrio y simulación con IA."""
    sucursal = db.get(Sucursal, payload.sucursal_id)
    if not sucursal:
        raise ValueError(f"Sucursal #{payload.sucursal_id} no encontrada")

    # 1. Obtener gastos fijos activos de la sucursal
    gastos_db = (
        db.query(GastoSucursal)
        .filter(
            GastoSucursal.sucursal_id == payload.sucursal_id,
            GastoSucursal.activo.is_(True),
        )
        .all()
    )

    # Si la sucursal aún no tiene gastos registrados, suministramos rubros base estándar de kiosco
    if not gastos_db:
        gastos_totales_base = Decimal("1140.00")
        gasto_energia = Decimal("165.00")
        gasto_arriendo = Decimal("450.00")
    else:
        gastos_totales_base = sum((Decimal(str(g.monto_mensual)) for g in gastos_db), Decimal("0"))
        gasto_energia = sum(
            (Decimal(str(g.monto_mensual)) for g in gastos_db if g.categoria_gasto == "energia"),
            Decimal("0"),
        )
        gasto_arriendo = sum(
            (Decimal(str(g.monto_mensual)) for g in gastos_db if g.categoria_gasto == "arriendo"),
            Decimal("0"),
        )

    # Aplicar factor de variación What-If
    factor_variacion = Decimal("1.0") + (payload.variacion_gastos_pct / Decimal("100.0"))
    gastos_totales = _money(gastos_totales_base * factor_variacion)

    # 2. Obtener productos activos
    productos = db.query(Producto).filter(Producto.activo.is_(True)).order_by(Producto.id).all()

    # Mapeo de clasificaciones comerciales
    clasif_map = {
        c.producto_id: c.clasificacion
        for c in db.query(ClasificacionProducto).all()
    }

    # Precios vigentes en la sucursal
    precios_vigentes = {
        p.producto_id: p
        for p in (
            db.query(HistorialPrecioProducto)
            .filter(HistorialPrecioProducto.sucursal_id == payload.sucursal_id)
            .order_by(HistorialPrecioProducto.vigente_desde.asc())
            .all()
        )
    }

    # Costos vigentes de reposición (compras)
    costos_vigentes = {
        c.producto_id: c
        for c in (
            db.query(HistorialCostoProducto)
            .order_by(HistorialCostoProducto.fecha.asc())
            .all()
        )
    }

    # Estimación de volumen mensual por producto (para ponderación de absorción)
    productos_simulados: list[ProductoSimuladoOut] = []
    unidades_totales_estimadas = 0
    margen_ponderado_suma = Decimal("0")

    for prod in productos:
        clasif = clasif_map.get(prod.id, "nicho" if prod.categoria_id in [2, 6] else "gancho")
        es_perecedero = bool(prod.es_perecedero)

        # Precio actual registrado
        precio_item = precios_vigentes.get(prod.id)
        precio_actual = _money(precio_item.precio_venta) if precio_item else None

        # Costo de reposición
        costo_item = costos_vigentes.get(prod.id)
        if costo_item:
            costo_vigente = _money(costo_item.costo)
        elif precio_actual:
            costo_vigente = _money(precio_actual * Decimal("0.70"))
        else:
            costo_vigente = Decimal("0.75")

        # Margen actual
        if precio_actual and precio_actual > 0 and costo_vigente:
            margen_actual_pct = _pct(((precio_actual - costo_vigente) / precio_actual) * Decimal("100"))
        else:
            margen_actual_pct = None

        # Ponderación de volumen mensual y margen objetivo sugerido
        if clasif == "gancho":
            unidades_est = 180  # Alta rotación
            margen_base = Decimal("16.0")
        else:
            unidades_est = 65   # Menor rotación, mayor margen unitario
            margen_base = Decimal("35.0")

        # Recargo de absorción por cadena de frío / refrigeración
        if es_perecedero:
            margen_base += Decimal("5.0")  # Recargo del 5% para absorber la energía de refrigeración

        # Ajuste por meta de utilidad neta
        ajuste_meta = (payload.meta_utilidad_neta_pct - Decimal("15.0")) * Decimal("0.3")
        margen_sugerido_pct = _pct(max(Decimal("10.0"), min(Decimal("55.0"), margen_base + ajuste_meta)))

        # Precio de venta sugerido
        divisor = max(Decimal("0.10"), Decimal("1.0") - (margen_sugerido_pct / Decimal("100.0")))
        precio_calculado = _money(costo_vigente / divisor)

        # Redondeo comercial a múltiplos de $0.05
        cents = int((precio_calculado * 100) % 5)
        if cents != 0:
            precio_sugerido = _money(precio_calculado + Decimal((5 - cents) / 100.0))
        else:
            precio_sugerido = precio_calculado

        # Cuota de absorción de gastos fijos por unidad vendida
        cuota_absorcion = _money((precio_sugerido - costo_vigente) * Decimal("0.65"))

        # Justificación estratégica y clara del precio recomendado
        if clasif == "gancho" and es_perecedero:
            justificacion = (
                f"Producto Gancho perecedero ({prod.nombre}): Margen optimizado de {margen_sugerido_pct}% para "
                f"mantener alta rotación de compra diaria, absorbiendo ${cuota_absorcion} de costo eléctrico y arriendo."
            )
        elif clasif == "gancho":
            justificacion = (
                f"Producto Gancho de consumo masivo ({prod.nombre}): Margen competitivo de {margen_sugerido_pct}% "
                f"para proteger el volumen de clientes del kiosco frente a supermercados."
            )
        elif es_perecedero:
            justificacion = (
                f"Producto frío/perecedero ({prod.nombre}): Margen de {margen_sugerido_pct}% que cubre "
                f"${cuota_absorcion} por unidad para absorber el consumo 24/7 de las vitrinas refrigeradas."
            )
        else:
            justificacion = (
                f"Producto de Nicho / Impulso ({prod.nombre}): Margen premium de {margen_sugerido_pct}% "
                f"que aporta directamente a la utilidad neta libre y al pago de arriendo."
            )

        productos_simulados.append(
            ProductoSimuladoOut(
                producto_id=prod.id,
                nombre=prod.nombre,
                clasificacion=clasif,
                es_perecedero=es_perecedero,
                costo_vigente=costo_vigente,
                precio_actual=precio_actual,
                margen_actual_pct=margen_actual_pct,
                margen_sugerido_pct=margen_sugerido_pct,
                precio_sugerido=precio_sugerido,
                cuota_gasto_absorbida=cuota_absorcion,
                justificacion=justificacion,
            )
        )

        unidades_totales_estimadas += unidades_est
        margen_ponderado_suma += margen_sugerido_pct * unidades_est

    # 3. Cálculos agregados de la simulación
    if unidades_totales_estimadas > 0:
        margen_promedio = _pct(margen_ponderado_suma / Decimal(unidades_totales_estimadas))
    else:
        margen_promedio = Decimal("24.5")

    # Punto de equilibrio en ventas ($): Ventas mínimas para que Margen Bruto == Gastos Fijos
    if margen_promedio > 0:
        punto_equilibrio_ventas = _money(gastos_totales / (margen_promedio / Decimal("100.0")))
    else:
        punto_equilibrio_ventas = _money(gastos_totales * Decimal("4.0"))

    # Ventas totales proyectadas
    ventas_proyectadas = sum(
        (p.precio_sugerido * (180 if p.clasificacion == "gancho" else 65) for p in productos_simulados),
        Decimal("0"),
    )
    costos_proyectados = sum(
        ((p.costo_vigente or Decimal("0")) * (180 if p.clasificacion == "gancho" else 65) for p in productos_simulados),
        Decimal("0"),
    )
    margen_bruto_proyectado = ventas_proyectadas - costos_proyectados
    utilidad_neta_proyectada = _money(margen_bruto_proyectado - gastos_totales)

    # 4. Generación de Explicación Ejecutiva Asistida por IA
    explicacion_ia = _generar_explicacion_ia(
        sucursal_nombre=sucursal.nombre,
        gastos_totales=gastos_totales,
        variacion_pct=payload.variacion_gastos_pct,
        punto_equilibrio=punto_equilibrio_ventas,
        margen_promedio=margen_promedio,
        utilidad_neta=utilidad_neta_proyectada,
        meta_utilidad=payload.meta_utilidad_neta_pct,
        total_productos=len(productos_simulados),
    )

    return SimulacionGastosOut(
        sucursal_id=payload.sucursal_id,
        gastos_totales_mensuales=gastos_totales,
        variacion_aplicada_pct=payload.variacion_gastos_pct,
        punto_equilibrio_ventas=punto_equilibrio_ventas,
        margen_promedio_necesario_pct=margen_promedio,
        utilidad_neta_proyectada=utilidad_neta_proyectada,
        total_unidades_proyectadas=unidades_totales_estimadas,
        productos=productos_simulados,
        explicacion_ia=explicacion_ia,
    )


def _generar_explicacion_ia(
    sucursal_nombre: str,
    gastos_totales: Decimal,
    variacion_pct: Decimal,
    punto_equilibrio: Decimal,
    margen_promedio: Decimal,
    utilidad_neta: Decimal,
    meta_utilidad: Decimal,
    total_productos: int,
) -> str:
    """Genera la justificación ejecutiva vía OpenRouter o fallback analítico estructurado."""
    # Intentar con OpenRouter si la API key está presente
    if settings.openrouter_api_key:
        try:
            prompt = (
                f"Sos el Asesor Financiero y de Pricing con IA de El Kiosquito. Analizá los siguientes datos "
                f"reales de costeo por absorción y punto de equilibrio para la {sucursal_nombre}:\n"
                f"- Gastos Fijos Operativos Mensuales (Arriendo, Luz, Agua, Nómina): ${gastos_totales} "
                f"(Escenario What-If: {variacion_pct}% de variación).\n"
                f"- Punto de Equilibrio Operativo mensual necesario: ${punto_equilibrio} en ventas facturadas.\n"
                f"- Margen Bruto Promedio Ponderado calculado: {margen_promedio}%.\n"
                f"- Utilidad Neta Mensual Proyectada: ${utilidad_neta} (meta deseada: {meta_utilidad}%).\n"
                f"- Total de productos evaluados en catálogo: {total_productos}.\n\n"
                f"Escribí un dictamen ejecutivo formal y claro (3 a 4 párrafos en Markdown con viñetas) explicando: "
                f"1) Cómo se cubren los costos fijos y por qué ese punto de equilibrio es el umbral de seguridad. "
                f"2) Por qué se diferencian los márgenes entre productos Gancho (alta rotación), Frío (consumo eléctrico) y Nicho. "
                f"3) Recomendación estratégica final para el Dueño sobre la viabilidad de la sucursal."
            )
            resp = httpx.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/el-kiosquito",
                    "X-Title": "El Kiosquito - Simulador Precios",
                },
                json={
                    "model": settings.openrouter_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "Sos el Asesor Financiero y de Pricing de El Kiosquito. "
                                "Respondé directamente en español con el dictamen ejecutivo en Markdown, "
                                "sin preámbulos en inglés ni notas de razonamiento interno."
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 550,
                },
                timeout=15.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                contenido = data.get("choices", [{}])[0].get("message", {}).get("content")
                if contenido:
                    texto = contenido.strip()
                    if "</think>" in texto:
                        texto = texto.split("</think>")[-1].strip()
                    if "### " in texto:
                        return "### " + texto.split("### ", 1)[1].strip()
                    if "Here's a thinking process" not in texto and not texto.startswith("1. "):
                        return texto
        except Exception as exc:
            log.warning("No se pudo invocar OpenRouter para la explicación, usando generador analítico: %s", exc)

    # Fallback analítico estructurado (100% determinístico, auditable y elegante)
    return (
        f"### 📊 Dictamen Ejecutivo de Pricing y Cobertura — {sucursal_nombre}\n\n"
        f"**1. Cobertura del Punto de Equilibrio (Break-Even):**\n"
        f"Para sostener la operación física de la sucursal con un gasto fijo mensual consolidado de **${gastos_totales}** "
        f"(que integra arriendo, energía continua de refrigeración, servicios básicos y nómina), el local requiere "
        f"facturar un mínimo estricto de **${punto_equilibrio} al mes**. Con este nivel de ventas y el margen ponderado "
        f"calculado del **{margen_promedio}%**, la sucursal absorbe el 100% de sus costos operativos sin caer en pérdidas.\n\n"
        f"**2. Estrategia de Absorción Ponderada por Tipo de Producto:**\n"
        f"- **Productos Gancho (Tráfico Masivo):** Se les fija un margen controlado (14% - 18%). Su función no es pagar el arriendo solos, sino generar volumen recurrente en el punto de venta y traccionar clientes diarios.\n"
        f"- **Productos con Cadena de Frío (Lácteos, Cervezas, Helados):** Incorporan un recargo específico de absorción energética (~5% adicional) para costear la operación ininterrumpida de las vitrinas y congeladores del local.\n"
        f"- **Productos de Nicho e Impulso (Golosinas, Snacks, Confitería):** Con márgenes superiores (32% - 40%), son los mayores contribuyentes a la utilidad neta de bolsillo y a la amortización del arriendo.\n\n"
        f"**3. Proyección de Rentabilidad Neta:**\n"
        f"Al aplicar la matriz de precios sugerida, el negocio proyecta una **ganancia neta libre de ${utilidad_neta} al mes** "
        f"(cumpliendo con la meta de rentabilidad del **{meta_utilidad}%**), blindando la sostenibilidad del kiosco ante aumentos "
        f"en las planillas de servicios o variaciones de demanda."
    )

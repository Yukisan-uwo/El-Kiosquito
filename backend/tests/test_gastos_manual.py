"""
Prueba de verificación del módulo de Gastos y Simulador de Precios con IA.
Ejercita:
  1. Lectura de gastos sembrados para sucursal 1.
  2. Motor financiero de costeo por absorción y punto de equilibrio (break-even).
  3. Generación del dictamen de IA (o fallback determinístico estructurado).
  4. Alta, edición y baja lógica de un gasto fijo.
"""

from decimal import Decimal
from app.database import SessionLocal
from app.models.expansion import GastoSucursal
from app.schemas.gastos import SimulacionGastosIn
from app.services.simulador_precios_ia import ejecutar_simulacion_gastos_ia

def test_simulador_gastos():
    db = SessionLocal()
    try:
        print("=== 1. Verificando gastos sembrados para Sucursal 1 ===")
        gastos = db.query(GastoSucursal).filter(
            GastoSucursal.sucursal_id == 1,
            GastoSucursal.activo.is_(True)
        ).all()
        assert len(gastos) >= 3, f"Se esperaban al menos 3 gastos sembrados, encontrados {len(gastos)}"
        total_gastos = sum(Decimal(str(g.monto_mensual)) for g in gastos)
        print(f"  OK: Encontrados {len(gastos)} gastos por un total de ${total_gastos:,.2f}")
        for g in gastos:
            print(f"    - {g.concepto} ({g.categoria_gasto}): ${g.monto_mensual}")

        print("\n=== 2. Ejecutando motor de simulación de precios con IA ===")
        payload = SimulacionGastosIn(
            sucursal_id=1,
            meta_utilidad_neta_pct=Decimal("15.0"),
            variacion_gastos_pct=Decimal("0.0")
        )
        simulacion = ejecutar_simulacion_gastos_ia(db=db, payload=payload)
        assert simulacion.sucursal_id == 1
        assert Decimal(str(simulacion.gastos_totales_mensuales)) == total_gastos
        assert simulacion.punto_equilibrio_ventas > 0
        assert len(simulacion.productos) > 0
        assert len(simulacion.explicacion_ia) > 50

        print(f"  OK: Punto de Equilibrio mensual: ${simulacion.punto_equilibrio_ventas:,.2f}")
        print(f"  OK: Margen promedio de cobertura: {simulacion.margen_promedio_necesario_pct}%")
        print(f"  OK: Productos evaluados: {len(simulacion.productos)}")
        
        primer_prod = simulacion.productos[0]
        print(f"  Ejemplo producto: {primer_prod.nombre} | Costo: ${primer_prod.costo_vigente} | Actual: ${primer_prod.precio_actual} ({primer_prod.margen_actual_pct}%) -> Sugerido: ${primer_prod.precio_sugerido} ({primer_prod.margen_sugerido_pct}%)")
        print(f"  Justificación: {primer_prod.justificacion}")

        print("\n=== 3. Probando CRUD de Gasto ===")
        nuevo_gasto = GastoSucursal(
            sucursal_id=1,
            concepto="Internet de Alta Velocidad Fibra",
            categoria_gasto="servicios",
            monto_mensual=Decimal("45.00"),
            activo=True
        )
        db.add(nuevo_gasto)
        db.commit()
        db.refresh(nuevo_gasto)
        print(f"  OK: Creado gasto ID {nuevo_gasto.id}: {nuevo_gasto.concepto}")

        # Editar
        nuevo_gasto.monto_mensual = Decimal("50.00")
        db.commit()
        print(f"  OK: Actualizado monto a ${nuevo_gasto.monto_mensual}")

        # Desactivar (soft delete)
        nuevo_gasto.activo = False
        db.commit()
        print(f"  OK: Baja lógica exitosa (activo=False)")

        # Limpiar
        db.delete(nuevo_gasto)
        db.commit()
        print("  OK: Limpieza de prueba exitosa.")

        print("\n==========================================")
        print(" ¡TODAS LAS PRUEBAS DE GASTOS Y SIMULACIÓN PASARON EXITOSAMENTE!")
        print("==========================================")

    finally:
        db.close()

if __name__ == "__main__":
    test_simulador_gastos()

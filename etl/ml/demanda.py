"""
Modelo 1/5 (Art. 5.6): Pronóstico de demanda — regresión con
scikit-learn (RandomForestRegressor sobre features de calendario y
confusores; NUNCA ARIMA/statsmodels — fuera del stack del Art. 5.6, que
admite scikit-learn como única librería de ML).

Grano de entrenamiento: (fecha, sucursal_id, producto_id) → unidades
vendidas ese día. Se completa la grilla COMPLETA (todo producto × toda
sucursal operativa × todo día del rango con ventas) rellenando con cero
donde no hubo venta: un día sin venta es una observación real de
demanda cero, no un hueco a descartar. `tamano_muestra` reportado a la
API es el tamaño de esa grilla — cada fila es una combinación real de
calendario × catálogo, nunca una fila inventada.

Confusores exigidos por el Art. 4.4/5.6 (nunca pronosticar solo con el
histórico de ventas):
- Estacionalidad (feriados): `dia_semana`, `es_fin_de_semana`,
  `es_quincena`, `es_feriado` (de `dim_tiempo` — la quincena mueve la
  demanda de un kiosko de barrio tanto como una promoción, ver
  el-kiosquito-clickhouse-fact-dim.md §2).
- Estacionalidad (eventos locales no feriado) *(enmienda 2026-09-05,
  auditoría de riesgos derivados)*: `evento_local_alza`/
  `evento_local_baja`, de `dim_evento_local` — fiesta patronal, evento
  comunitario, clima extremo y corte de servicios, con el signo tomado
  de `afecta_demanda_al_alza` (nunca inferido, RN-PD-003 de
  `004-pronostico-demanda`). Antes de esta enmienda, `dim_evento_local`
  se cargaba en cada corrida del ETL y se usaba en el informe compuesto
  de OT3.7, pero nunca llegaba a este modelo — solo `es_feriado` (un
  subconjunto de `evento_local`) entraba como feature. Un día de clima
  extremo o de un corte de servicios quedaba indistinguible de un día
  de demanda genuinamente baja, la misma trampa que este módulo existe
  para evitar.
- Demanda insatisfecha: conteo de eventos de quiebre de stock ese
  mismo día/sucursal/producto (`fact_demanda_insatisfecha`) — un día de
  ventas bajas con muchos quiebres no es lo mismo que un día de ventas
  bajas porque nadie quería el producto.
- Sustitución de marca *(enmienda 2026-09-05)*: `hubo_sustituto_
  ofrecido`/`hubo_sustituto_aceptado`, del mismo `fact_demanda_
  insatisfecha` — un quiebre donde se ofreció y aceptó un sustituto no
  debería descontar tan fuerte la demanda real del producto original
  como uno donde el cliente se fue sin nada.
- Promoción activa: al menos un cupón enviado a algún cliente en los 7
  días previos (`fact_cupon`), proxy de campaña corriendo esa semana —
  `fact_cupon` no lleva `producto_id` (un cupón es del cliente, no del
  SKU), así que no se puede atar la promoción a un producto específico
  sin inventar ese vínculo; se usa como señal de cadena/semana.
"""

from datetime import date

import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

from ml.datos import a_dataframe

MODELO = "demanda"
METRICA = "MAE"

_FEATURES = [
    "dia_semana", "es_fin_de_semana", "es_quincena", "es_feriado",
    "evento_local_alza", "evento_local_baja",
    "eventos_quiebre", "hubo_sustituto_ofrecido", "hubo_sustituto_aceptado",
    "promocion_activa_semana", "sucursal_id", "producto_id",
]


def _extraer_dataset(ch_client) -> pd.DataFrame:
    ventas = a_dataframe(
        ch_client,
        """
        SELECT fecha, sucursal_id, producto_id, sum(cantidad_venta) AS unidades
        FROM fact_venta_linea
        WHERE cuenta_para_ingresos = 1
        GROUP BY fecha, sucursal_id, producto_id
        """,
        ["fecha", "sucursal_id", "producto_id", "unidades"],
    )
    if ventas.empty:
        return ventas

    calendario = a_dataframe(
        ch_client,
        """
        SELECT fecha, dia_semana, es_fin_de_semana, es_quincena, es_feriado
        FROM dim_tiempo
        WHERE fecha >= (SELECT min(fecha) FROM fact_venta_linea)
          AND fecha <= (SELECT max(fecha) FROM fact_venta_linea)
        """,
        ["fecha", "dia_semana", "es_fin_de_semana", "es_quincena", "es_feriado"],
    )
    productos = a_dataframe(ch_client, "SELECT DISTINCT producto_id FROM dim_producto", ["producto_id"])
    sucursales = a_dataframe(
        ch_client, "SELECT sucursal_id FROM dim_sucursal WHERE opera_ventas = 1", ["sucursal_id"]
    )
    if calendario.empty or productos.empty or sucursales.empty:
        return pd.DataFrame()

    # Grilla completa fecha × sucursal × producto.
    grilla = calendario[["fecha"]].merge(sucursales, how="cross").merge(productos, how="cross")
    dataset = grilla.merge(ventas, on=["fecha", "sucursal_id", "producto_id"], how="left")
    dataset["unidades"] = dataset["unidades"].fillna(0.0)
    dataset = dataset.merge(calendario, on="fecha", how="left")
    dataset["fecha"] = pd.to_datetime(dataset["fecha"])

    insatisfecha = a_dataframe(
        ch_client,
        """
        SELECT fecha, sucursal_id, producto_id, count() AS eventos_quiebre,
               max(sustituto_ofrecido) AS hubo_sustituto_ofrecido,
               max(sustituto_aceptado) AS hubo_sustituto_aceptado
        FROM fact_demanda_insatisfecha
        GROUP BY fecha, sucursal_id, producto_id
        """,
        ["fecha", "sucursal_id", "producto_id", "eventos_quiebre", "hubo_sustituto_ofrecido", "hubo_sustituto_aceptado"],
    )
    if not insatisfecha.empty:
        insatisfecha["fecha"] = pd.to_datetime(insatisfecha["fecha"])
        dataset = dataset.merge(insatisfecha, on=["fecha", "sucursal_id", "producto_id"], how="left")
    else:
        dataset["eventos_quiebre"] = 0
        dataset["hubo_sustituto_ofrecido"] = 0
        dataset["hubo_sustituto_aceptado"] = 0
    dataset["eventos_quiebre"] = dataset["eventos_quiebre"].fillna(0).astype(int)
    dataset["hubo_sustituto_ofrecido"] = dataset["hubo_sustituto_ofrecido"].fillna(0).astype(int)
    dataset["hubo_sustituto_aceptado"] = dataset["hubo_sustituto_aceptado"].fillna(0).astype(int)

    # Eventos locales no feriado (fiesta patronal, evento comunitario, clima
    # extremo, corte de servicios) — 'feriado' ya llega vía es_feriado de
    # dim_tiempo, incluirlo de nuevo aquí lo contaría dos veces. El signo se
    # toma de afecta_demanda_al_alza (dato del catálogo, RN-PD-003 de
    # 004-pronostico-demanda), nunca se infiere.
    dataset["evento_local_alza"] = 0
    dataset["evento_local_baja"] = 0
    eventos = a_dataframe(
        ch_client,
        "SELECT tipo, afecta_demanda_al_alza, fecha_inicio, fecha_fin, sucursal_id "
        "FROM dim_evento_local WHERE tipo != 'feriado'",
        ["tipo", "afecta_demanda_al_alza", "fecha_inicio", "fecha_fin", "sucursal_id"],
    )
    if not eventos.empty:
        eventos["fecha_inicio"] = pd.to_datetime(eventos["fecha_inicio"])
        eventos["fecha_fin"] = pd.to_datetime(eventos["fecha_fin"])
        for _, evento in eventos.iterrows():
            en_rango = (dataset["fecha"] >= evento["fecha_inicio"]) & (dataset["fecha"] <= evento["fecha_fin"])
            en_sucursal = (
                dataset["sucursal_id"] == evento["sucursal_id"]
                if pd.notna(evento["sucursal_id"])
                else pd.Series(True, index=dataset.index)
            )
            columna = "evento_local_alza" if evento["afecta_demanda_al_alza"] else "evento_local_baja"
            dataset.loc[en_rango & en_sucursal, columna] = 1

    cupones = a_dataframe(ch_client, "SELECT fecha_envio AS fecha FROM fact_cupon", ["fecha"])
    if not cupones.empty:
        cupones["fecha"] = pd.to_datetime(cupones["fecha"])
        dataset["promocion_activa_semana"] = dataset["fecha"].apply(
            lambda f: int(((cupones["fecha"] >= f - pd.Timedelta(days=7)) & (cupones["fecha"] <= f)).any())
        )
    else:
        dataset["promocion_activa_semana"] = 0

    return dataset


def entrenar(ch_client) -> dict:
    dataset = _extraer_dataset(ch_client)
    if dataset.empty:
        return {"tamano_muestra": 0, "periodo_inicio": None, "periodo_fin": None, "valor_metrica": None}

    periodo_inicio = dataset["fecha"].min().date()
    periodo_fin = dataset["fecha"].max().date()

    # Con muy pocas filas ni siquiera tiene sentido separar train/test —
    # se reporta el tamaño real igual; el servidor decide el estado
    # (RN-AR-002), nunca se infla la muestra para forzar un `valor_
    # metrica`.
    if len(dataset) < 10:
        return {
            "tamano_muestra": len(dataset),
            "periodo_inicio": periodo_inicio,
            "periodo_fin": periodo_fin,
            "valor_metrica": None,
        }

    X, y = dataset[_FEATURES], dataset["unidades"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    modelo = RandomForestRegressor(n_estimators=200, max_depth=8, random_state=42)
    modelo.fit(X_train, y_train)
    mae = mean_absolute_error(y_test, modelo.predict(X_test))

    return {
        "tamano_muestra": len(dataset),
        "periodo_inicio": periodo_inicio,
        "periodo_fin": periodo_fin,
        "valor_metrica": float(mae),
    }

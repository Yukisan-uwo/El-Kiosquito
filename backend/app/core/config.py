"""
Configuración de la aplicación (Art. 5.1) — leída de variables de entorno,
nunca hardcodeada. `secret_key` DEBE sobrescribirse con la variable de
entorno `SECRET_KEY` en cualquier ambiente que no sea desarrollo local.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    secret_key: str = "dev-secret-solo-para-desarrollo-local-cambiar-en-produccion"
    algorithm: str = "HS256"
    # 8 horas ~ un turno de caja (006-caja-mermas-fraude) — vencer el token a
    # mitad de turno forzaría un re-login sin motivo de negocio.
    access_token_expire_minutes: int = 60 * 8

    # ClickHouse (Art. 2.5, capa táctica) — mismos nombres de variable que
    # etl/etl/config.py: los dos servicios apuntan al mismo ClickHouse,
    # nunca dos configuraciones distintas para un solo destino. El backend
    # solo LEE (asistente conversacional, Art. 5.10) — nunca escribe, eso
    # sigue siendo exclusivo del pipeline ETL.
    clickhouse_host: str = "localhost"
    clickhouse_native_port: int = 9000
    clickhouse_database: str = "elkiosquito_dw"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    # OpenRouter (Art. 5.10, enmienda v1.4.0) — único proveedor de LLM
    # externo admitido en todo el stack, exclusivo del asistente
    # conversacional. `openrouter_model` es un valor de configuración, no
    # constitucional: puede cambiar sin enmendar el Art. 5.10 mientras siga
    # siendo gratuito y con soporte de tool calling (ver docstring de
    # services/asistente.py).
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "nvidia/nemotron-3.5-lightning:free"

    # Notificaciones por correo (Art. 8.4) — canal real con tier gratuito
    # para cupón de cumpleaños, cupón por patrón de compra y alerta de
    # campaña de recuperación. Gmail SMTP con contraseña de aplicación (no
    # OAuth: es la vía gratuita más simple para un remitente único de
    # cuenta personal, sin presupuesto de proveedor transaccional). Igual
    # que OpenRouter: opcional a nivel de stack — si no está configurado,
    # el envío queda registrado como no-enviado (RN-CF-002/RN-PI-008) en
    # vez de bloquear la operación de negocio (Art. 8.6: un módulo
    # operativo nunca depende de un tercero para completar un INSERT).
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465
    smtp_usuario: str = ""
    smtp_contrasena_app: str = ""
    smtp_remitente_nombre: str = "El Kiosquito"

    # CORS (Art. 5.1) — el frontend (Vite, puerto 5173 por defecto) y el
    # backend (puerto 8000) son dos orígenes distintos para el navegador,
    # así que sin esta lista el navegador bloquea toda llamada real desde
    # las pantallas React aunque el backend responda bien por curl/Swagger.
    # Lista separada por comas, nunca "*": la app ya usa Bearer token (no
    # cookies), pero un wildcard de origen sigue siendo una mala práctica
    # de superficie de ataque — mismo error ya detectado y corregido en el
    # proyecto hermano NexoStay. Ampliable por variable de entorno
    # CORS_ORIGINS sin tocar código para otro puerto/dominio (ej. build de
    # `vite preview`, puerto 4173).
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        """Orígenes permitidos, ya separados — lo que espera CORSMiddleware."""
        return [origen.strip() for origen in self.cors_origins.split(",") if origen.strip()]


settings = Settings()

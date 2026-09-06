"""
Notificaciones al cliente por correo electrónico (Art. 8.4) — canal real
con tier gratuito para las tres alertas que la constitución exige: cupón
de cumpleaños, cupón por patrón de compra y alerta de campaña de
recuperación de churn. El envío por SMS puede quedar simulado (Art. 8.4
lo permite explícitamente); acá no se implementa SMS.

Decisión de proveedor: Gmail SMTP con contraseña de aplicación
(smtp.gmail.com:465, SSL). Es la vía gratuita más simple para un
remitente único de cuenta personal — sin presupuesto para un proveedor
transaccional (Sendgrid/Brevo/etc.), y sin necesitar flujo OAuth para un
solo remitente fijo. Mismo criterio que la enmienda v1.4.0 de OpenRouter:
acceso gratuito real, no de prueba.

Honestidad (mismo principio que el asistente conversacional, Art. 5.9/
5.10): este módulo NUNCA simula un envío exitoso. `enviar_email` devuelve
siempre `(enviado: bool, detalle: str | None)` — si SMTP no está
configurado, si `cliente.contacto` no tiene forma de correo, o si el
servidor SMTP rechaza el mensaje, se devuelve `enviado=False` con el
motivo real en `detalle`. Quien llama persiste ese resultado tal cual
(`Cupon.notificacion_enviada`/`CampanaRecuperacion.notificacion_enviada`)
— nunca se asume "enviado" solo porque se intentó.

`contacto` de `cliente` es un campo libre (Art. 10.2 no fija su formato:
puede ser teléfono). Antes de intentar un envío real se valida con
`_parece_correo` — un cliente sin correo válido en `contacto` nunca
dispara un intento SMTP, queda registrado directamente como no-enviado
con motivo "sin correo válido en contacto".

Plantilla HTML (Tarea #64, 2026-09-06): antes de esta tarea, `enviar_email`
mandaba texto plano simple, y las tres alertas terminaban en la carpeta de
Spam de Gmail con relativa frecuencia. Dos causas reales, no cosméticas:

1. **Señales de spam en el asunto** — emoji + signos de exclamación
   dobles ("¡Feliz cumpleaños! ... 🎂") son un patrón que los filtros
   bayesianos de Gmail penalizan de forma conocida. Los tres asuntos se
   reescribieron sin emoji ni "¡...!".
2. **Correo de una sola parte (`text/plain`)** — un remitente Gmail
   personal (no un dominio transaccional verificado con SPF/DKIM/DMARC
   alineados) ya parte con desventaja de reputación; un correo
   `multipart/alternative` con una parte HTML bien formada (marca
   reconocible, sin enlaces sospechosos, con texto real y no solo
   imágenes) es una señal adicional de legitimidad que la parte de texto
   plano sola no aporta. `enviar_email` ahora arma siempre las dos partes
   — la de texto plano nunca se quita, sigue siendo el *fallback* real
   para clientes que no rendericen HTML.

Ninguna de las dos correcciones puede garantizar salir de Spam (SPF/DKIM/
DMARC alineados a un dominio propio sí lo harían, pero eso excede lo que
un remitente Gmail personal gratuito puede ofrecer, Art. 8.4) — son las
dos mejoras reales disponibles dentro de esa restricción.
"""

from __future__ import annotations

import html as _html
import re
import smtplib
from email.message import EmailMessage

from app.core.config import settings
from app.models.clientes import CampanaRecuperacion, Cliente
from app.models.promociones import Cupon

_PATRON_CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Asuntos reescritos en la Tarea #64 — sin emoji ni "¡...!" (ver nota de
# módulo). El texto sigue siendo cálido, solo deja de imitar el patrón que
# los filtros de spam de Gmail asocian con correo masivo de bajo valor.
_ASUNTOS_CUPON = {
    "cumpleanos": "Un cupón de cumpleaños para vos en El Kiosquito",
    "patron_compra": "Un cupón pensado para vos en El Kiosquito",
    "recuperacion_churn": "Te extrañamos — un cupón te espera en El Kiosquito",
}
_ASUNTO_CAMPANA = "Te extrañamos en El Kiosquito"

# Paleta de marca (constitución v1.6.0, Art. 11.1) fijada a mano, igual que
# `public/favicon.svg` — un correo HTML no tiene acceso a los tokens CSS de
# `index.css`, así que esta es la segunda excepción admitida (junto al
# favicon) a la regla de "solo tokens" del Art. 11.2, y debe actualizarse a
# mano si la paleta vuelve a cambiar.
_COLOR_PRIMARIO = "#946F00"
_COLOR_PRIMARIO_TEXTO = "#705400"
_COLOR_PRIMARIO_SUAVE = "#F8F1DD"
_COLOR_PROFUNDO = "#3D2E00"
_COLOR_ACENTO = "#E64919"
_COLOR_FONDO = "#FAF6EE"
_COLOR_TEXTO = "#1F2B27"
_COLOR_TEXTO_SECUNDARIO = "#5C6B65"

# Isotipo simplificado para email — mismo puestito de `LogoMarca.tsx`
# (Tarea #63), reducido a las formas que sobreviven bien a 32px inline en
# un cliente de correo: toldo + cuerpo + ventanilla, sin banderín (se
# pierde en clientes que no aplican antialiasing a SVG pequeños).
_LOGO_SVG = (
    '<svg width="32" height="32" viewBox="0 0 48 48" style="display:block">'
    f'<rect x="2" y="2" width="44" height="44" rx="12" fill="{_COLOR_PRIMARIO}"/>'
    f'<polygon points="8,21 24,9 40,21" fill="{_COLOR_PROFUNDO}"/>'
    f'<rect x="6" y="20" width="36" height="3" rx="1.5" fill="{_COLOR_PROFUNDO}"/>'
    f'<rect x="10" y="23" width="28" height="16" rx="3" fill="#FFFFFF"/>'
    f'<rect x="14" y="27" width="20" height="8" rx="1.5" fill="{_COLOR_ACENTO}"/>'
    '</svg>'
)


def _parece_correo(contacto: str | None) -> bool:
    return bool(contacto) and bool(_PATRON_CORREO.match(contacto.strip()))


def _plantilla_html(*, titulo: str, parrafos: list[str], caja_cupon: str | None = None) -> str:
    """Envoltorio HTML compartido por las tres alertas — un solo lugar de
    verdad para el layout de correo (mismo principio del Art. 13/11.2
    trasladado a plantillas de email), para que un ajuste de marca futuro
    no obligue a tocar cada función de notificación por separado.

    Tablas para el layout (no flexbox/grid) a propósito: es la práctica
    estándar de HTML de email — Outlook de escritorio usa el motor de
    render de Word y ignora CSS moderno de layout."""
    filas_parrafos = "".join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:{_COLOR_TEXTO};">{p}</p>'
        for p in parrafos
    )
    bloque_cupon = caja_cupon or ""
    return f"""\
<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:{_COLOR_FONDO};font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{_COLOR_FONDO};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px;">{_LOGO_SVG}</td>
                    <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:{_COLOR_PROFUNDO};">El Kiosquito</td>
                  </tr>
                </table>
                <div style="height:3px;background-color:{_COLOR_ACENTO};border-radius:2px;margin:20px 0 24px;width:56px;"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;font-family:Arial,Helvetica,sans-serif;">
                <h1 style="margin:0 0 16px;font-size:19px;line-height:26px;color:{_COLOR_PROFUNDO};font-family:Georgia,'Times New Roman',serif;">{titulo}</h1>
                {filas_parrafos}
                {bloque_cupon}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:12px;line-height:18px;color:{_COLOR_TEXTO_SECUNDARIO};border-top:1px solid {_COLOR_PRIMARIO_SUAVE};padding-top:16px;">
                  Este correo es una comunicación operativa de tu programa de fidelización en El Kiosquito.
                  Si preferís no recibir más este tipo de mensajes, respondé a este correo y lo gestionamos.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _caja_cupon(codigo: str, fecha_expiracion) -> str:
    codigo_html = _html.escape(codigo)
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
  <tr>
    <td style="background-color:{_COLOR_PRIMARIO_SUAVE};border:1px solid {_COLOR_PRIMARIO};border-radius:12px;padding:20px;text-align:center;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:{_COLOR_PRIMARIO_TEXTO};margin-bottom:8px;">Tu código de cupón</div>
      <div style="font-family:'Courier New',monospace;font-size:26px;font-weight:bold;letter-spacing:0.06em;color:{_COLOR_PROFUNDO};margin-bottom:8px;">{codigo_html}</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:{_COLOR_TEXTO_SECUNDARIO};">Válido hasta el {fecha_expiracion:%d/%m/%Y} · presentalo en caja para canjearlo</div>
    </td>
  </tr>
</table>
"""


def enviar_email(destinatario: str, asunto: str, cuerpo_texto: str, cuerpo_html: str | None = None) -> tuple[bool, str | None]:
    """Envío real vía Gmail SMTP. Nunca lanza excepción hacia quien llama
    — cualquier falla (config ausente, auth, conexión, rechazo del
    servidor) vuelve como `(False, motivo)`, para que el flujo de negocio
    que la invoca (registrar cupón, registrar campaña) nunca se rompa por
    una dependencia externa (Art. 8.6).

    `cuerpo_html` es opcional a nivel de firma (para no romper otros
    llamadores hipotéticos), pero las tres funciones de este módulo
    siempre lo pasan — arma un `multipart/alternative` con la parte de
    texto plano como fallback real, no decorativo (Tarea #64)."""
    if not settings.smtp_usuario or not settings.smtp_contrasena_app:
        return False, "SMTP no configurado (SMTP_USUARIO/SMTP_CONTRASENA_APP ausentes)"

    mensaje = EmailMessage()
    mensaje["Subject"] = asunto
    mensaje["From"] = f"{settings.smtp_remitente_nombre} <{settings.smtp_usuario}>"
    mensaje["To"] = destinatario
    mensaje.set_content(cuerpo_texto)
    if cuerpo_html:
        mensaje.add_alternative(cuerpo_html, subtype="html")

    try:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as servidor:
            servidor.login(settings.smtp_usuario, settings.smtp_contrasena_app)
            servidor.send_message(mensaje)
        return True, None
    except smtplib.SMTPException as exc:
        return False, f"SMTP rechazó el envío: {exc}"
    except OSError as exc:
        return False, f"No se pudo conectar al servidor SMTP: {exc}"


def notificar_cupon(cliente: Cliente, cupon: Cupon) -> tuple[bool, str | None]:
    """Cubre dos de las tres alertas del Art. 8.4: cupón de cumpleaños y
    cupón por patrón de compra (el tercero, recuperación de churn, también
    pasa por acá cuando el cupón nace de una campaña — el aviso de la
    campaña en sí lo cubre `notificar_campana_recuperacion`)."""
    if not _parece_correo(cliente.contacto):
        return False, "sin correo válido en contacto"

    asunto = _ASUNTOS_CUPON.get(cupon.tipo_origen, "Tenés un cupón de El Kiosquito")
    cuerpo_texto = (
        f"Hola {cliente.nombre},\n\n"
        f"Te enviamos un cupón de El Kiosquito: código {cupon.codigo}.\n"
        f"Válido hasta el {cupon.fecha_expiracion:%d/%m/%Y}.\n\n"
        "Presentalo en caja para canjearlo.\n\n"
        "— El Kiosquito"
    )
    cuerpo_html = _plantilla_html(
        titulo=f"Hola {_html.escape(cliente.nombre)}, tenés un cupón esperándote",
        parrafos=["Te enviamos un cupón de El Kiosquito para tu próxima visita."],
        caja_cupon=_caja_cupon(cupon.codigo, cupon.fecha_expiracion),
    )
    return enviar_email(cliente.contacto, asunto, cuerpo_texto, cuerpo_html)


def notificar_campana_recuperacion(cliente: Cliente, campana: CampanaRecuperacion) -> tuple[bool, str | None]:
    """Tercera alerta del Art. 8.4: aviso de campaña de recuperación,
    independiente de si la campaña incluye o no un cupón (`cupon_id` es
    nullable — una campaña puede ser solo contacto)."""
    if not _parece_correo(cliente.contacto):
        return False, "sin correo válido en contacto"

    tiene_cupon = campana.cupon_id is not None
    cuerpo_extra = (
        " Además, te dejamos un cupón — revisá tu historial de cupones en tu próxima visita."
        if tiene_cupon
        else ""
    )
    cuerpo_texto = f"Hola {cliente.nombre},\n\nHace un tiempo que no te vemos por El Kiosquito.{cuerpo_extra}\n\n— El Kiosquito"

    parrafos = ["Hace un tiempo que no te vemos por El Kiosquito y nos gustaría verte de nuevo."]
    if tiene_cupon:
        parrafos.append("Te dejamos un cupón — revisá tu historial de cupones en tu próxima visita.")
    cuerpo_html = _plantilla_html(
        titulo=f"Te extrañamos, {_html.escape(cliente.nombre)}",
        parrafos=parrafos,
    )
    return enviar_email(cliente.contacto, _ASUNTO_CAMPANA, cuerpo_texto, cuerpo_html)

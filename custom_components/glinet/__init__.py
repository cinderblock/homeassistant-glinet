"""GL.iNet Router integration for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .api import GlInetApi
from .const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME, DOMAIN
from .coordinator import GlInetCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor", "button", "select"]

CARD_URL = f"/{DOMAIN}/glinet-card.js"
CARD_PATH = Path(__file__).parent / "www" / "glinet-card.js"

SERVICE_CONNECT_WIFI = "connect_wifi"
SERVICE_CONNECT_WIFI_SCHEMA = vol.Schema(
    {
        vol.Required("ssid"): cv.string,
        vol.Optional("key", default=""): cv.string,
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up GL.iNet Router from a config entry."""
    host = entry.data[CONF_HOST]
    username = entry.data[CONF_USERNAME]
    password = entry.data[CONF_PASSWORD]

    api = GlInetApi(host=host, username=username, password=password)
    coordinator = GlInetCoordinator(hass, api)

    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Register the Lovelace card JS (once)
    if CARD_URL not in hass.data.get("frontend_extra_module_url", set()):
        hass.http.register_static_path(CARD_URL, str(CARD_PATH), cache_headers=False)
        add_extra_js_url(hass, CARD_URL)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register the connect_wifi service (once, not per entry)
    if not hass.services.has_service(DOMAIN, SERVICE_CONNECT_WIFI):

        async def handle_connect_wifi(call: ServiceCall) -> None:
            """Handle the glinet.connect_wifi service call."""
            ssid = call.data["ssid"]
            key = call.data.get("key", "")
            # Use the first coordinator (single-router assumption for now)
            for coord in hass.data[DOMAIN].values():
                if isinstance(coord, GlInetCoordinator):
                    await coord.async_connect(ssid, key)
                    break

        hass.services.async_register(
            DOMAIN,
            SERVICE_CONNECT_WIFI,
            handle_connect_wifi,
            schema=SERVICE_CONNECT_WIFI_SCHEMA,
        )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        # Remove service if no more entries
        if not hass.data[DOMAIN]:
            hass.services.async_remove(DOMAIN, SERVICE_CONNECT_WIFI)
    return unload_ok

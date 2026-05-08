"""Button entities for GL.iNet Router integration."""

from __future__ import annotations

import logging

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import GlInetCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up GL.iNet button entities."""
    coordinator: GlInetCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            GlInetScanButton(coordinator, entry),
            GlInetDisconnectButton(coordinator, entry),
        ]
    )


class GlInetScanButton(CoordinatorEntity[GlInetCoordinator], ButtonEntity):
    """Button to trigger a Wi-Fi network scan."""

    _attr_has_entity_name = True
    _attr_name = "Scan Wi-Fi"
    _attr_icon = "mdi:wifi-sync"

    def __init__(self, coordinator: GlInetCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_scan_wifi"
        self._attr_device_info = _device_info(entry)

    async def async_press(self) -> None:
        """Trigger a Wi-Fi scan."""
        _LOGGER.debug("Triggering GL.iNet Wi-Fi scan")
        await self.coordinator.async_scan_networks()


class GlInetDisconnectButton(CoordinatorEntity[GlInetCoordinator], ButtonEntity):
    """Button to disconnect from the current Wi-Fi network."""

    _attr_has_entity_name = True
    _attr_name = "Disconnect Wi-Fi"
    _attr_icon = "mdi:wifi-off"

    def __init__(self, coordinator: GlInetCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_disconnect_wifi"
        self._attr_device_info = _device_info(entry)

    async def async_press(self) -> None:
        """Disconnect from the current network."""
        _LOGGER.debug("Disconnecting GL.iNet repeater")
        await self.coordinator.async_disconnect()


def _device_info(entry: ConfigEntry) -> dict:
    """Return device info for grouping entities."""
    return {
        "identifiers": {(DOMAIN, entry.entry_id)},
        "name": f"GL.iNet Router ({entry.data['host']})",
        "manufacturer": "GL.iNet",
    }

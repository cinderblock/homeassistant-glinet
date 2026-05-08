"""Select entity for GL.iNet Router integration — network picker."""

from __future__ import annotations

import logging

from homeassistant.components.select import SelectEntity
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
    """Set up GL.iNet select entities."""
    coordinator: GlInetCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([GlInetNetworkSelect(coordinator, entry)])


class GlInetNetworkSelect(CoordinatorEntity[GlInetCoordinator], SelectEntity):
    """Select entity populated by scan results.

    Selecting a network connects to it if a saved password exists.
    For new networks (no saved key), use the glinet.connect_wifi service instead.
    """

    _attr_has_entity_name = True
    _attr_name = "Repeater Network"
    _attr_icon = "mdi:wifi-cog"

    def __init__(self, coordinator: GlInetCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_repeater_network"
        self._attr_device_info = _device_info(entry)

    @property
    def options(self) -> list[str]:
        """Return deduplicated list of SSIDs from the last scan."""
        seen: set[str] = set()
        result: list[str] = []
        for net in self.coordinator.scan_results:
            ssid = net.get("ssid", "")
            if ssid and ssid not in seen:
                seen.add(ssid)
                result.append(ssid)
        return result if result else ["(scan first)"]

    @property
    def current_option(self) -> str | None:
        """Return the currently connected SSID."""
        saved = self.coordinator.data.get("saved", [])
        if saved:
            ssid = saved[0].get("ssid")
            if ssid in self.options:
                return ssid
        return None

    @property
    def extra_state_attributes(self) -> dict:
        """Expose full scan results so the Lovelace card can show signal/band."""
        networks = []
        for net in self.coordinator.scan_results:
            ssid = net.get("ssid", "")
            if not ssid:
                continue
            networks.append(
                {
                    "ssid": ssid,
                    "signal": net.get("signal"),
                    "band": net.get("band"),
                    "bssid": net.get("bssid"),
                    "encryption": net.get("encryption", {}).get("description", ""),
                }
            )
        return {"scan_results": networks}

    async def async_select_option(self, option: str) -> None:
        """Connect to the selected network."""
        if option == "(scan first)":
            return

        # Check if we have a saved key for this network
        saved = self.coordinator.data.get("saved", [])
        key = ""
        for net in saved:
            if net.get("ssid") == option:
                key = net.get("key", "")
                break

        _LOGGER.info("Connecting to Wi-Fi network: %s", option)
        await self.coordinator.async_connect(option, key)


def _device_info(entry: ConfigEntry) -> dict:
    """Return device info for grouping entities."""
    return {
        "identifiers": {(DOMAIN, entry.entry_id)},
        "name": f"GL.iNet Router ({entry.data['host']})",
        "manufacturer": "GL.iNet",
    }

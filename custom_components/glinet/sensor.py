"""Sensor entities for GL.iNet Router integration."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import SIGNAL_STRENGTH_DECIBELS_MILLIWATT
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import GlInetCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up GL.iNet sensor entities."""
    coordinator: GlInetCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            GlInetRepeaterSsidSensor(coordinator, entry),
            GlInetRepeaterSignalSensor(coordinator, entry),
        ]
    )


class GlInetRepeaterSsidSensor(CoordinatorEntity[GlInetCoordinator], SensorEntity):
    """Sensor showing the currently connected Wi-Fi network SSID."""

    _attr_has_entity_name = True
    _attr_name = "Repeater SSID"
    _attr_icon = "mdi:wifi"

    def __init__(self, coordinator: GlInetCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_repeater_ssid"
        self._attr_device_info = _device_info(entry)

    @property
    def native_value(self) -> str | None:
        """Return the SSID of the connected network, or 'Disconnected'."""
        rs = self.coordinator.data.get("repeater_status", {})
        if rs.get("running") and rs.get("ssid"):
            return rs["ssid"]
        return "Disconnected"

    @property
    def extra_state_attributes(self) -> dict:
        """Return connection details from repeater status."""
        rs = self.coordinator.data.get("repeater_status", {})
        if not rs.get("running"):
            return {}
        ipv4 = rs.get("ipv4", {})
        attrs = {
            "ip_address": ipv4.get("ip"),
            "gateway": ipv4.get("gateway"),
            "dns": ipv4.get("dns"),
            "macaddr": rs.get("macaddr"),
            "bssid": rs.get("bssid"),
            "channel": rs.get("channel"),
            "connected": rs.get("connected"),
        }
        return {k: v for k, v in attrs.items() if v is not None}


class GlInetRepeaterSignalSensor(CoordinatorEntity[GlInetCoordinator], SensorEntity):
    """Sensor showing the signal strength of the connected network."""

    _attr_has_entity_name = True
    _attr_name = "Repeater Signal"
    _attr_icon = "mdi:wifi-strength-2"
    _attr_native_unit_of_measurement = SIGNAL_STRENGTH_DECIBELS_MILLIWATT

    def __init__(self, coordinator: GlInetCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_repeater_signal"
        self._attr_device_info = _device_info(entry)

    @property
    def native_value(self) -> int | None:
        """Return signal strength from repeater status (live, not scan-based)."""
        rs = self.coordinator.data.get("repeater_status", {})
        if rs.get("running"):
            return rs.get("signal")
        return None


def _device_info(entry: ConfigEntry) -> dict:
    """Return device info for grouping entities."""
    return {
        "identifiers": {(DOMAIN, entry.entry_id)},
        "name": f"GL.iNet Router ({entry.data['host']})",
        "manufacturer": "GL.iNet",
    }

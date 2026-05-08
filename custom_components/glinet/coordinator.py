"""DataUpdateCoordinator for GL.iNet Router integration."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import GlInetApi, GlInetApiError
from .const import DOMAIN, SCAN_INTERVAL_SECONDS

_LOGGER = logging.getLogger(__name__)


class GlInetCoordinator(DataUpdateCoordinator):
    """Polls the router for repeater status.

    The regular poll fetches lightweight config and saved network info.
    Wi-Fi scans are triggered manually via the scan button entity (they take 5-10s).
    """

    def __init__(self, hass: HomeAssistant, api: GlInetApi) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=SCAN_INTERVAL_SECONDS),
        )
        self.api = api
        self.scan_results: list[dict] = []

    async def _async_update_data(self) -> dict:
        """Fetch repeater config and saved networks (lightweight poll)."""
        try:
            return await self.hass.async_add_executor_job(self._fetch_status)
        except GlInetApiError as err:
            raise UpdateFailed(f"Error communicating with GL.iNet router: {err}") from err
        except (OSError, TimeoutError) as err:
            raise UpdateFailed(f"Cannot reach GL.iNet router: {err}") from err

    def _fetch_status(self) -> dict:
        """Synchronous fetch — runs in executor."""
        config = self.api.repeater_get_config()
        saved = self.api.repeater_saved_networks()
        repeater_status = self.api.repeater_get_status()
        system_status = self.api.system_get_status()
        clients = self.api.clients_get_list()

        # VPN client status (best-effort)
        vpn_client_status: dict = {}
        try:
            vpn_client_status = self.api.vpn_client_get_status()
        except Exception:  # noqa: BLE001
            pass

        # Cellular modem (best-effort — not all routers have one)
        modem_status: dict = {}
        modem_info: dict = {}
        modem_config: dict = {}
        try:
            modem_status = self.api.modem_get_status()
            modem_info = self.api.modem_get_info()
            modems = modem_status.get("modems", [])
            bus = modems[0].get("bus", "") if modems else ""
            if bus:
                modem_config = self.api.modem_get_config(bus)
        except Exception:  # noqa: BLE001
            pass

        return {
            "config": config,
            "saved": saved,
            "repeater_status": repeater_status,
            "system_status": system_status,
            "clients": clients,
            "vpn_client_status": vpn_client_status,
            "modem_status": modem_status,
            "modem_info": modem_info,
            "modem_config": modem_config,
        }

    async def async_scan_networks(self) -> list[dict]:
        """Trigger a Wi-Fi scan (called by the scan button). Takes 5-10 seconds."""
        try:
            self.scan_results = await self.hass.async_add_executor_job(
                self.api.repeater_scan
            )
        except GlInetApiError as err:
            _LOGGER.error("Wi-Fi scan failed: %s", err)
            raise
        # Notify entities that data changed (scan results updated)
        self.async_set_updated_data(self.data)
        return self.scan_results

    async def async_connect(self, ssid: str, key: str = "") -> None:
        """Connect to a Wi-Fi network."""
        await self.hass.async_add_executor_job(self.api.repeater_connect, ssid, key)
        # Refresh status after connecting
        await self.async_request_refresh()

    async def async_disconnect(self) -> None:
        """Disconnect from the current Wi-Fi network."""
        await self.hass.async_add_executor_job(self.api.repeater_disconnect)
        await self.async_request_refresh()

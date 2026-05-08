"""Config flow for the GL.iNet Router integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .api import GlInetApi, GlInetApiError
from .const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME, DEFAULT_HOST, DEFAULT_USERNAME, DOMAIN

_LOGGER = logging.getLogger(__name__)


class GlInetConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for GL.iNet Router."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step — user enters host and password."""
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST]
            username = user_input.get(CONF_USERNAME, DEFAULT_USERNAME)
            password = user_input[CONF_PASSWORD]

            api = GlInetApi(host=host, username=username, password=password)

            try:
                sid = await self.hass.async_add_executor_job(api.login)
            except GlInetApiError as err:
                _LOGGER.error("Authentication failed: %s", err)
                errors["base"] = "invalid_auth"
            except (OSError, TimeoutError) as err:
                _LOGGER.error("Cannot connect to %s: %s", host, err)
                errors["base"] = "cannot_connect"
            except Exception:
                _LOGGER.exception("Unexpected error during GL.iNet login")
                errors["base"] = "unknown"
            else:
                # Use host as unique ID (could use MAC from system status later)
                await self.async_set_unique_id(host)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=f"GL.iNet ({host})",
                    data={
                        CONF_HOST: host,
                        CONF_USERNAME: username,
                        CONF_PASSWORD: password,
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST, default=DEFAULT_HOST): str,
                    vol.Required(CONF_PASSWORD): str,
                }
            ),
            errors=errors,
        )

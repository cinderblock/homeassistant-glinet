"""GL.iNet Router API client for the Home Assistant integration.

Supports the GL.iNet 4.x JSON-RPC API with challenge-response authentication.
Works with any GL.iNet router running firmware 4.x.
"""

import hashlib
import json
import urllib.request

from passlib.hash import sha256_crypt


class GlInetApi:
    """Synchronous API client for GL.iNet routers.

    All methods are blocking — call via hass.async_add_executor_job() in HA.
    """

    def __init__(self, host: str, username: str = "root", password: str = ""):
        self.base_url = f"http://{host}/rpc"
        self.username = username
        self.password = password
        self.sid: str | None = None
        self._rpc_id = 0

    def _next_id(self) -> int:
        self._rpc_id += 1
        return self._rpc_id

    def _rpc(self, method: str, params):
        """Send a JSON-RPC request and return the result."""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params,
        }
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            self.base_url,
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
        if "error" in result:
            raise GlInetApiError(
                result["error"]["message"],
                result["error"].get("code"),
                result["error"].get("data"),
            )
        return result.get("result")

    def login(self) -> str:
        """Authenticate via challenge-response.

        The router issues a nonce valid for ~2 seconds, so challenge + hash +
        login must complete in a single fast burst. Do not add any I/O between
        the challenge and login calls.
        """
        # Step 1: Get challenge (nonce + salt)
        challenge = self._rpc("challenge", {"username": self.username})
        nonce = challenge["nonce"]
        salt = challenge["salt"]
        alg = challenge["alg"]

        # Step 2: Compute cipher password
        if alg == 5:
            cipher = sha256_crypt.using(salt=salt, rounds=5000).hash(self.password)
        elif alg == 6:
            from passlib.hash import sha512_crypt

            cipher = sha512_crypt.using(salt=salt, rounds=5000).hash(self.password)
        else:
            raise ValueError(f"Unsupported algorithm: {alg}")

        # Step 3: SHA-256 hash of "username:cipher:nonce"
        login_str = f"{self.username}:{cipher}:{nonce}"
        login_hash = hashlib.sha256(login_str.encode()).hexdigest()

        # Step 4: Login with hash
        result = self._rpc("login", {"username": self.username, "hash": login_hash})
        self.sid = result["sid"]
        return self.sid

    def call(self, namespace: str, method: str, params: dict | None = None):
        """Call an authenticated API method. Re-authenticates on token expiry."""
        if not self.sid:
            self.login()
        try:
            return self._rpc("call", [self.sid, namespace, method, params or {}])
        except GlInetApiError as e:
            if e.code == -32000:  # Access denied — token expired
                self.login()
                return self._rpc("call", [self.sid, namespace, method, params or {}])
            raise

    # --- Repeater (Wi-Fi Client) Methods ---

    def repeater_scan(self, all_band: bool = True, refresh: bool = True) -> list[dict]:
        """Scan for available Wi-Fi networks. Takes 5-10 seconds."""
        result = self.call("repeater", "scan", {"all_band": all_band, "refresh": refresh})
        return result.get("res", [])

    def repeater_get_config(self) -> dict:
        """Get repeater module configuration."""
        return self.call("repeater", "get_config")

    def repeater_saved_networks(self) -> list[dict]:
        """Get list of saved/known Wi-Fi networks."""
        result = self.call("repeater", "get_saved_ap_list")
        return result.get("res", [])

    def repeater_connect(
        self,
        ssid: str,
        key: str = "",
        bssid: str = "",
        band: str = "",
        channel: int = 0,
    ):
        """Connect to a Wi-Fi network as a repeater client."""
        params = {
            "ssid": ssid,
            "key": key,
            "bssid": bssid,
            "band": band,
            "channel": channel,
        }
        return self.call("repeater", "connect", params)

    def repeater_disconnect(self):
        """Disconnect from the current Wi-Fi network."""
        return self.call("repeater", "disconnect")

    def repeater_remove_saved(self, ssid: str):
        """Remove a saved Wi-Fi network."""
        return self.call("repeater", "remove_saved_ap", {"ssid": ssid})

    def repeater_get_status(self) -> dict:
        """Get repeater connection status (IP, MAC, signal, SSID, etc.)."""
        return self.call("repeater", "get_status")

    # --- Client Methods ---

    def clients_get_list(self) -> list[dict]:
        """Get list of connected clients (Wi-Fi and wired)."""
        result = self.call("clients", "get_list")
        return result.get("clients", [])

    # --- Modem (Cellular) Methods ---

    def modem_get_status(self) -> dict:
        """Get modem status (traffic, SIM, SMS count)."""
        return self.call("modem", "get_status")

    def modem_get_info(self) -> dict:
        """Get modem hardware info (model, IMEI, firmware)."""
        return self.call("modem", "get_info")

    def modem_get_config(self, bus: str = "") -> dict:
        """Get modem config (APN, bands, protocol)."""
        params = {"bus": bus} if bus else {}
        return self.call("modem", "get_config", params)

    def modem_get_sms_list(self, bus: str = "") -> list[dict]:
        """Get SMS messages from the modem."""
        params = {"bus": bus} if bus else {}
        result = self.call("modem", "get_sms_list", params)
        return result.get("list", [])

    # --- VPN / Service Methods ---

    def vpn_client_get_status(self) -> dict:
        """Get VPN client status (WireGuard/OpenVPN tunnels)."""
        return self.call("vpn-client", "get_status")

    def tailscale_get_config(self) -> dict:
        """Get Tailscale VPN configuration."""
        return self.call("tailscale", "get_config")

    # --- System Methods ---

    def system_get_status(self) -> dict:
        """Get system info (model, uptime, firmware version, etc.)."""
        return self.call("system", "get_status")


class GlInetApiError(Exception):
    """Error returned by the GL.iNet JSON-RPC API."""

    def __init__(self, message: str, code: int | None = None, data=None):
        self.message = message
        self.code = code
        self.data = data
        super().__init__(f"[{code}] {message}" + (f" ({data})" if data else ""))

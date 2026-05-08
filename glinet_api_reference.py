"""GL.iNet Router API client for repeater (Wi-Fi client) control.

Supports the GL.iNet 4.x JSON-RPC API with challenge-response authentication.
Designed for the GL-XE3000 but should work with any GL.iNet 4.x router.
"""

import hashlib
import json
import urllib.request
from passlib.hash import sha256_crypt


class GlInetApi:
    def __init__(self, host="192.168.8.1", username="root", password=""):
        self.base_url = f"http://{host}/rpc"
        self.username = username
        self.password = password
        self.sid = None
        self._rpc_id = 0

    def _next_id(self):
        self._rpc_id += 1
        return self._rpc_id

    def _rpc(self, method, params):
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
            raise ApiError(result["error"]["message"], result["error"].get("code"), result["error"].get("data"))
        return result.get("result")

    def login(self):
        """Authenticate via challenge-response.

        The router issues a nonce valid for ~2 seconds, so challenge + hash +
        login must complete in a single fast burst.
        """
        # Step 1: Get challenge (nonce + salt)
        challenge = self._rpc("challenge", {"username": self.username})

        nonce = challenge["nonce"]
        salt = challenge["salt"]
        alg = challenge["alg"]

        # Step 2: Compute cipher password using the appropriate crypt algorithm
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

    def call(self, namespace, method, params=None):
        """Call an authenticated API method. Re-authenticates on token expiry."""
        if not self.sid:
            self.login()
        try:
            return self._rpc("call", [self.sid, namespace, method, params or {}])
        except ApiError as e:
            if e.code == -32000:  # Access denied — token expired
                self.login()
                return self._rpc("call", [self.sid, namespace, method, params or {}])
            raise

    # --- Repeater (Wi-Fi Client) Methods ---

    def repeater_scan(self, all_band=True, refresh=True):
        """Scan for available Wi-Fi networks. Returns list of AP dicts."""
        result = self.call("repeater", "scan", {"all_band": all_band, "refresh": refresh})
        return result.get("res", [])

    def repeater_get_config(self):
        """Get repeater module configuration (MAC address, auto-reconnect, etc.)."""
        return self.call("repeater", "get_config")

    def repeater_saved_networks(self):
        """Get list of saved/known Wi-Fi networks with their keys."""
        result = self.call("repeater", "get_saved_ap_list")
        return result.get("res", [])

    def repeater_connect(self, ssid, key="", bssid="", band="", channel=0, encryption=None):
        """Connect to a Wi-Fi network as a client (repeater mode).

        Args:
            ssid: Network name to connect to.
            key: Network password/passphrase.
            bssid: Specific AP MAC address (optional, for targeting a specific AP).
            band: "2g" or "5g" (optional).
            channel: Channel number (optional).
            encryption: Encryption description dict (optional).
        """
        params = {
            "ssid": ssid,
            "key": key,
            "bssid": bssid,
            "band": band,
            "channel": channel,
        }
        if encryption:
            params["encryption"] = encryption
        return self.call("repeater", "connect", params)

    def repeater_disconnect(self):
        """Disconnect from the current Wi-Fi network."""
        return self.call("repeater", "disconnect")

    def repeater_remove_saved(self, ssid):
        """Remove a saved Wi-Fi network."""
        return self.call("repeater", "remove_saved_ap", {"ssid": ssid})


class ApiError(Exception):
    def __init__(self, message, code=None, data=None):
        self.message = message
        self.code = code
        self.data = data
        super().__init__(f"[{code}] {message}" + (f" ({data})" if data else ""))


def main():
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="GL.iNet Router Repeater Control")
    parser.add_argument("--host", default="192.168.8.1", help="Router IP address")
    parser.add_argument("--password", required=True, help="Admin password")
    parser.add_argument("--json", action="store_true", help="Output as JSON (for scripting/HA)")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("scan", help="Scan for available Wi-Fi networks")
    sub.add_parser("status", help="Get repeater config/status")
    sub.add_parser("saved", help="List saved networks")
    sub.add_parser("disconnect", help="Disconnect from current network")

    connect_p = sub.add_parser("connect", help="Connect to a Wi-Fi network")
    connect_p.add_argument("ssid", help="Network SSID to connect to")
    connect_p.add_argument("--key", default="", help="Network password/key")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    api = GlInetApi(host=args.host, password=args.password)

    if args.command == "scan":
        networks = api.repeater_scan()
        if args.json:
            print(json.dumps(networks, indent=2))
        else:
            print(f"{'SSID':<30} {'Band':<6} {'Signal':<8} {'Encryption':<15} {'BSSID'}")
            print("-" * 85)
            for net in sorted(networks, key=lambda n: n.get("signal", -100), reverse=True):
                enc = net.get("encryption", {}).get("description", "Open")
                print(f"{net['ssid']:<30} {net.get('band','?'):<6} {net.get('signal','?'):<8} {enc:<15} {net.get('bssid','')}")

    elif args.command == "status":
        config = api.repeater_get_config()
        saved = api.repeater_saved_networks()
        if args.json:
            print(json.dumps({"config": config, "saved": saved}, indent=2))
        else:
            print(json.dumps(config, indent=2))
            if saved:
                print(f"\nConnected to: {saved[0]['ssid']}")

    elif args.command == "saved":
        saved = api.repeater_saved_networks()
        if args.json:
            print(json.dumps(saved, indent=2))
        else:
            for net in saved:
                print(f"  {net['ssid']} (protocol: {net.get('protocol', '?')})")

    elif args.command == "connect":
        result = api.repeater_connect(args.ssid, key=args.key)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"Connecting to '{args.ssid}'...")
            print(f"Result: {json.dumps(result, indent=2)}")

    elif args.command == "disconnect":
        result = api.repeater_disconnect()
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"Disconnected: {json.dumps(result, indent=2)}")


if __name__ == "__main__":
    main()

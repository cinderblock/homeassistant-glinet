/**
 * GL.iNet Repeater Card — custom Lovelace card for the glinet integration.
 *
 * Shows current connection, scan results, and a manual-connect form.
 */

class GlinetRepeaterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._manualOpen = false;
    this._manualSsid = "";
    this._manualKey = "";
    this._scanning = false;
    this._connecting = false;
    this._bandFilter = null; // null = all, "2g", "5g"
  }

  setConfig(config) {
    this._config = {
      ssid_sensor: config.ssid_sensor || "",
      signal_sensor: config.signal_sensor || "",
      scan_button: config.scan_button || "",
      disconnect_button: config.disconnect_button || "",
      network_select: config.network_select || "",
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return {};
  }

  // --- Helpers ---

  _bandLabel(raw) {
    if (!raw) return "";
    const parts = raw.split(/\s*\/\s*/);
    return parts.map(p => {
      if (p === "2g") return "2.4 GHz";
      if (p === "5g") return "5 GHz";
      return p;
    }).join(" / ");
  }

  _bandPills(raw) {
    if (!raw) return "";
    const parts = raw.split(/\s*\/\s*/);
    return parts.map(p => {
      if (p === "2g") return '<span class="band-pill band-2g">2.4 GHz</span>';
      if (p === "5g") return '<span class="band-pill band-5g">5 GHz</span>';
      return `<span class="band-pill">${this._esc(p)}</span>`;
    }).join(" ");
  }

  _matchesBandFilter(bandStr) {
    if (!this._bandFilter) return true;
    if (!bandStr) return true;
    return bandStr.includes(this._bandFilter);
  }

  // --- Actions ---

  _pressScan() {
    if (!this._hass || !this._config.scan_button) return;
    this._scanning = true;
    this._render();
    this._hass.callService("button", "press", {
      entity_id: this._config.scan_button,
    }).then(() => {
      this._scanning = false;
      this._render();
    }).catch(() => {
      this._scanning = false;
      this._render();
    });
  }

  _pressDisconnect() {
    if (!this._hass || !this._config.disconnect_button) return;
    this._hass.callService("button", "press", {
      entity_id: this._config.disconnect_button,
    });
  }

  _connectTo(ssid, key) {
    if (!this._hass) return;
    this._connecting = true;
    this._render();
    this._hass.callService("glinet", "connect_wifi", {
      ssid,
      key: key || "",
    }).then(() => {
      this._connecting = false;
      this._manualSsid = "";
      this._manualKey = "";
      this._render();
    }).catch(() => {
      this._connecting = false;
      this._render();
    });
  }

  _joinScanned(ssid) {
    if (!this._hass || !this._config.network_select) return;
    this._connecting = true;
    this._render();
    this._hass.callService("select", "select_option", {
      entity_id: this._config.network_select,
      option: ssid,
    }).then(() => {
      this._connecting = false;
      this._render();
    }).catch(() => {
      this._connecting = false;
      this._render();
    });
  }

  _toggleManual() {
    this._manualOpen = !this._manualOpen;
    this._render();
  }

  _setBandFilter(band) {
    this._bandFilter = band;
    this._render();
  }

  // --- Render ---

  _render() {
    if (!this._hass || !this._config) return;

    const c = this._config;
    const h = this._hass;

    // Read entity states
    const ssidState = c.ssid_sensor ? h.states[c.ssid_sensor] : null;
    const signalState = c.signal_sensor ? h.states[c.signal_sensor] : null;
    const selectState = c.network_select ? h.states[c.network_select] : null;

    const connectedSsid = ssidState ? ssidState.state : "Unknown";
    const isConnected = connectedSsid && connectedSsid !== "Disconnected" && connectedSsid !== "unknown";
    const signalDbm = signalState && signalState.state !== "unknown" ? signalState.state + " dBm" : "";

    // Scan results from select entity attributes
    const scanResults = selectState?.attributes?.scan_results || [];

    // Apply band filter
    const filteredResults = scanResults
      .filter(net => this._matchesBandFilter(net.band))
      .sort((a, b) => (b.signal || -100) - (a.signal || -100));

    // Signal icon helper — CSS-based Wi-Fi bars (4 arcs)
    const signalIcon = (dbm) => {
      let level, cls;
      if (dbm == null) { level = 0; cls = "sig-none"; }
      else if (dbm >= -50) { level = 4; cls = "sig-4"; }
      else if (dbm >= -60) { level = 3; cls = "sig-3"; }
      else if (dbm >= -70) { level = 2; cls = "sig-2"; }
      else { level = 1; cls = "sig-1"; }
      return `<span class="wifi-icon ${cls}" title="${dbm != null ? dbm + ' dBm' : 'unknown'}">` +
        `<span class="wifi-bar b1 ${level >= 1 ? 'on' : ''}"></span>` +
        `<span class="wifi-bar b2 ${level >= 2 ? 'on' : ''}"></span>` +
        `<span class="wifi-bar b3 ${level >= 3 ? 'on' : ''}"></span>` +
        `<span class="wifi-bar b4 ${level >= 4 ? 'on' : ''}"></span>` +
        `</span>`;
    };

    const bf = this._bandFilter;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          padding: 16px;
        }
        .header {
          display: none;
        }
        .status {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px;
          border-radius: 8px;
          background: var(--primary-background-color);
          margin-bottom: 12px;
        }
        .status-left {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ssid-name {
          font-size: 1.05em;
          font-weight: 500;
        }
        .signal-info {
          font-size: 0.85em;
          color: var(--secondary-text-color);
        }
        .connected-badge {
          font-size: 0.75em;
          color: var(--success-color, #4caf50);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .disconnected-badge {
          font-size: 0.75em;
          color: var(--warning-color, #ff9800);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .btn {
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          cursor: pointer;
          font-size: 0.9em;
          font-family: inherit;
          transition: opacity 0.2s;
        }
        .btn:hover { opacity: 0.85; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .btn-outline {
          background: transparent;
          border: 1px solid var(--divider-color);
          color: var(--primary-text-color);
        }
        .btn-danger {
          background: transparent;
          border: 1px solid var(--error-color, #f44336);
          color: var(--error-color, #f44336);
        }
        .btn-small {
          padding: 4px 12px;
          font-size: 0.8em;
        }
        .scan-results {
          margin-bottom: 12px;
        }
        .scan-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .scan-header h3 {
          margin: 0;
          font-size: 0.9em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .band-filter {
          display: flex;
          gap: 4px;
        }
        .band-filter .btn-filter {
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 2px 10px;
          cursor: pointer;
          font-size: 0.75em;
          font-family: inherit;
          background: transparent;
          color: var(--secondary-text-color);
          transition: all 0.15s;
        }
        .band-filter .btn-filter:hover {
          border-color: var(--primary-color);
          color: var(--primary-color);
        }
        .band-filter .btn-filter.active {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .network-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .network-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 6px;
          background: var(--primary-background-color);
        }
        .network-item.current {
          border-left: 3px solid var(--primary-color);
        }
        .network-ssid {
          font-size: 0.95em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
          flex: 1;
        }
        .network-detail {
          font-size: 0.8em;
          color: var(--secondary-text-color);
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .wifi-icon {
          display: inline-flex;
          align-items: flex-end;
          gap: 2px;
          height: 16px;
          flex-shrink: 0;
        }
        .wifi-bar {
          width: 3px;
          border-radius: 1px;
          background: var(--disabled-text-color, #555);
          opacity: 0.25;
        }
        .wifi-bar.on { opacity: 1; }
        .wifi-bar.b1 { height: 4px; }
        .wifi-bar.b2 { height: 7px; }
        .wifi-bar.b3 { height: 11px; }
        .wifi-bar.b4 { height: 15px; }
        .sig-4 .wifi-bar.on, .sig-3 .wifi-bar.on { background: var(--success-color, #4caf50); }
        .sig-2 .wifi-bar.on { background: var(--warning-color, #ff9800); }
        .sig-1 .wifi-bar.on { background: var(--error-color, #f44336); }
        .band-pill {
          display: inline-block;
          padding: 1px 7px;
          border-radius: 9px;
          font-size: 0.85em;
          font-weight: 500;
          letter-spacing: 0.2px;
          line-height: 1.4;
        }
        .band-2g {
          background: rgba(33, 150, 243, 0.15);
          color: #1976d2;
        }
        .band-5g {
          background: rgba(156, 39, 176, 0.15);
          color: #7b1fa2;
        }
        .manual-section {
          border-top: 1px solid var(--divider-color);
          padding-top: 8px;
        }
        .manual-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          user-select: none;
          padding: 4px 0;
          font-size: 0.9em;
          color: var(--primary-text-color);
          background: none;
          border: none;
          font-family: inherit;
          width: 100%;
          text-align: left;
        }
        .manual-toggle:hover { color: var(--primary-color); }
        .manual-toggle .arrow {
          font-size: 0.7em;
          transition: transform 0.2s;
        }
        .manual-toggle .arrow.open {
          transform: rotate(90deg);
        }
        .manual-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px 0 4px;
        }
        .manual-form input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          font-size: 0.9em;
          font-family: inherit;
          box-sizing: border-box;
        }
        .manual-form input:focus {
          outline: none;
          border-color: var(--primary-color);
        }
        .manual-form .form-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .manual-form label {
          font-size: 0.8em;
          color: var(--secondary-text-color);
        }
        .manual-form .form-actions {
          display: flex;
          justify-content: flex-end;
          padding-top: 4px;
        }
        .empty-state {
          text-align: center;
          padding: 16px;
          color: var(--secondary-text-color);
          font-size: 0.9em;
        }
      </style>
      <ha-card>
        <div class="header">
          <h2>GL.iNet Repeater</h2>
        </div>

        <div class="status">
          <div class="status-left">
            ${isConnected
              ? `<span class="connected-badge">Connected</span>
                 <span class="ssid-name">${this._esc(connectedSsid)}</span>
                 ${signalDbm ? `<span class="signal-info">${signalDbm}</span>` : ""}`
              : `<span class="disconnected-badge">Disconnected</span>
                 <span class="ssid-name">No network</span>`
            }
          </div>
          ${isConnected && c.disconnect_button
            ? `<button class="btn btn-danger btn-small" id="btn-disconnect">Disconnect</button>`
            : ""
          }
        </div>

        <div class="actions">
          <button class="btn btn-primary" id="btn-scan" ${this._scanning ? "disabled" : ""}>
            ${this._scanning ? "Scanning\u2026" : "Scan Wi-Fi"}
          </button>
        </div>

        ${scanResults.length > 0 ? `
          <div class="scan-results">
            <div class="scan-header">
              <h3>Available Networks</h3>
              <div class="band-filter">
                <button class="btn-filter ${bf === null ? 'active' : ''}" data-band="all">All</button>
                <button class="btn-filter ${bf === '2g' ? 'active' : ''}" data-band="2g">2.4 GHz</button>
                <button class="btn-filter ${bf === '5g' ? 'active' : ''}" data-band="5g">5 GHz</button>
              </div>
            </div>
            <div class="network-list">
              ${filteredResults
                .map(net => `
                  <div class="network-item ${net.ssid === connectedSsid ? 'current' : ''}">
                    ${signalIcon(net.signal)}
                    <span class="network-ssid">${this._esc(net.ssid)}</span>
                    <span class="network-detail">
                      ${this._bandPills(net.band)}
                      ${net.encryption ? '<span>' + this._esc(net.encryption) + '</span>' : ''}
                      ${net.signal != null ? '<span>' + net.signal + ' dBm</span>' : ''}
                    </span>
                    ${net.ssid !== connectedSsid
                      ? `<button class="btn btn-outline btn-small btn-join" data-ssid="${this._esc(net.ssid)}"
                           ${this._connecting ? 'disabled' : ''}>Join</button>`
                      : '<span class="network-detail">current</span>'
                    }
                  </div>
                `).join("")}
            </div>
          </div>
        ` : (c.network_select ? `
          <div class="empty-state">Press Scan to discover nearby networks</div>
        ` : "")}

        <div class="manual-section">
          <button class="manual-toggle" id="btn-manual-toggle">
            <span class="arrow ${this._manualOpen ? 'open' : ''}">&#9654;</span>
            Manual Connect
          </button>

          ${this._manualOpen ? `
            <div class="manual-form">
              <div class="form-row">
                <label for="manual-ssid">SSID</label>
                <input type="text" id="manual-ssid" placeholder="Network name"
                       value="${this._esc(this._manualSsid)}">
              </div>
              <div class="form-row">
                <label for="manual-key">Password</label>
                <input type="password" id="manual-key" placeholder="Leave empty for open networks"
                       value="${this._esc(this._manualKey)}">
              </div>
              <div class="form-actions">
                <button class="btn btn-primary" id="btn-manual-connect"
                        ${this._connecting ? 'disabled' : ''}>
                  ${this._connecting ? 'Connecting\u2026' : 'Connect'}
                </button>
              </div>
            </div>
          ` : ""}
        </div>
      </ha-card>
    `;

    // --- Bind event listeners ---

    const btnScan = this.shadowRoot.getElementById("btn-scan");
    if (btnScan) btnScan.addEventListener("click", () => this._pressScan());

    const btnDisconnect = this.shadowRoot.getElementById("btn-disconnect");
    if (btnDisconnect) btnDisconnect.addEventListener("click", () => this._pressDisconnect());

    const btnManualToggle = this.shadowRoot.getElementById("btn-manual-toggle");
    if (btnManualToggle) btnManualToggle.addEventListener("click", () => this._toggleManual());

    // Band filter buttons
    this.shadowRoot.querySelectorAll(".btn-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        const band = btn.dataset.band;
        this._setBandFilter(band === "all" ? null : band);
      });
    });

    // Manual form inputs
    const ssidInput = this.shadowRoot.getElementById("manual-ssid");
    if (ssidInput) {
      ssidInput.addEventListener("input", (e) => { this._manualSsid = e.target.value; });
      ssidInput.focus();
    }

    const keyInput = this.shadowRoot.getElementById("manual-key");
    if (keyInput) {
      keyInput.addEventListener("input", (e) => { this._manualKey = e.target.value; });
    }

    // Manual connect button
    const btnManualConnect = this.shadowRoot.getElementById("btn-manual-connect");
    if (btnManualConnect) {
      btnManualConnect.addEventListener("click", () => {
        if (this._manualSsid.trim()) {
          this._connectTo(this._manualSsid.trim(), this._manualKey);
        }
      });
    }

    // Join buttons in scan results
    this.shadowRoot.querySelectorAll(".btn-join").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._joinScanned(btn.dataset.ssid);
      });
    });
  }

  _esc(str) {
    if (!str) return "";
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }
}

if (!customElements.get("glinet-repeater-card")) {
  customElements.define("glinet-repeater-card", GlinetRepeaterCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "glinet-repeater-card",
  name: "GL.iNet Repeater",
  description: "Control your GL.iNet router's Wi-Fi repeater connection",
});

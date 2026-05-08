/**
 * GL.iNet Network Overview Card — custom Lovelace card for the glinet integration.
 *
 * Full network dashboard: WAN sources, repeater status, connected clients,
 * Wi-Fi radios, services, cellular modem, and system stats.
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
    this._bandFilter = null;
    this._scanOpen = false;
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

  getCardSize() { return 6; }
  static getStubConfig() { return {}; }

  // --- Helpers ---

  _bandLabel(raw) {
    if (!raw) return raw;
    const s = raw.toLowerCase();
    if (s === '2g' || s === '2.4g') return '2.4 GHz';
    if (s === '5g') return '5 GHz';
    return raw;
  }

  _bandPills(raw) {
    if (!raw) return "";
    return raw.split(/\s*\/\s*/).map(p => {
      if (p === "2g") return '<span class="pill pill-2g">2.4 GHz</span>';
      if (p === "5g") return '<span class="pill pill-5g">5 GHz</span>';
      return `<span class="pill">${this._esc(p)}</span>`;
    }).join(" ");
  }

  _matchesBandFilter(bandStr) {
    if (!this._bandFilter) return true;
    if (!bandStr) return true;
    return bandStr.includes(this._bandFilter);
  }

  _signalBars(dbm) {
    let level, cls;
    if (dbm == null) { level = 0; cls = "sig-none"; }
    else if (dbm >= -50) { level = 4; cls = "sig-4"; }
    else if (dbm >= -60) { level = 3; cls = "sig-3"; }
    else if (dbm >= -70) { level = 2; cls = "sig-2"; }
    else { level = 1; cls = "sig-1"; }
    return `<span class="wifi-icon ${cls}" title="${dbm != null ? dbm + ' dBm' : 'unknown'}">` +
      [1,2,3,4].map(i => `<span class="wifi-bar b${i} ${level >= i ? 'on' : ''}"></span>`).join("") +
      `</span>`;
  }

  _formatBytes(bytes) {
    if (bytes == null) return "—";
    const b = Number(bytes);
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
    return (b / 1073741824).toFixed(2) + " GB";
  }

  _formatUptime(sec) {
    if (sec == null) return "—";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  _dot(online, up) {
    if (online) return '<span class="dot online"></span>';
    if (up) return '<span class="dot up"></span>';
    return '<span class="dot down"></span>';
  }

  // --- Actions ---

  _pressScan() {
    if (!this._hass || !this._config.scan_button) return;
    this._scanning = true;
    this._scanOpen = true;
    this._render();
    this._hass.callService("button", "press", {
      entity_id: this._config.scan_button,
    }).then(() => { this._scanning = false; this._render(); })
      .catch(() => { this._scanning = false; this._render(); });
  }

  _pressDisconnect() {
    if (!this._hass || !this._config.disconnect_button) return;
    this._hass.callService("button", "press", {
      entity_id: this._config.disconnect_button,
    });
  }

  _connectTo(ssid, key) {
    if (!this._hass) return;
    this._connecting = true; this._render();
    this._hass.callService("glinet", "connect_wifi", { ssid, key: key || "" })
      .then(() => { this._connecting = false; this._manualSsid = ""; this._manualKey = ""; this._render(); })
      .catch(() => { this._connecting = false; this._render(); });
  }

  _joinScanned(ssid) {
    if (!this._hass || !this._config.network_select) return;
    this._connecting = true; this._render();
    this._hass.callService("select", "select_option", {
      entity_id: this._config.network_select, option: ssid,
    }).then(() => { this._connecting = false; this._render(); })
      .catch(() => { this._connecting = false; this._render(); });
  }

  _toggleManual() { this._manualOpen = !this._manualOpen; this._render(); }
  _toggleScan() { this._scanOpen = !this._scanOpen; this._render(); }
  _setBandFilter(band) { this._bandFilter = band; this._render(); }

  // --- Render ---

  _render() {
    if (!this._hass || !this._config) return;
    const c = this._config, h = this._hass;

    const ssidState = c.ssid_sensor ? h.states[c.ssid_sensor] : null;
    const signalState = c.signal_sensor ? h.states[c.signal_sensor] : null;
    const selectState = c.network_select ? h.states[c.network_select] : null;

    const connectedSsid = ssidState ? ssidState.state : "Unknown";
    const isConnected = connectedSsid && connectedSsid !== "Disconnected" && connectedSsid !== "unknown";
    const signalDbm = signalState && signalState.state !== "unknown" ? Number(signalState.state) : null;

    // All data from select entity attributes
    const a = selectState?.attributes || {};
    const scanResults = a.scan_results || [];
    const ri = a.repeater_info || {};
    const wanIfaces = a.wan_interfaces || [];
    const clients = a.clients || [];
    const clientSummary = a.client_summary || {};
    const modem = a.modem_info || {};
    const vpn = a.vpn_services || [];
    const vpnTunnels = a.vpn_tunnels || [];
    const radios = a.wifi_radios || [];
    const sys = a.system_stats || {};

    const bf = this._bandFilter;
    const filteredResults = scanResults.filter(n => this._matchesBandFilter(n.band)).sort((a, b) => (b.signal || -100) - (a.signal || -100));

    // Classify WAN sources
    const wwan = wanIfaces.find(i => i.interface === "wwan");
    const wan = wanIfaces.find(i => i.interface === "wan");
    const secondwan = wanIfaces.find(i => i.interface === "secondwan");
    const tethering = wanIfaces.find(i => i.interface === "tethering");
    const modem0 = wanIfaces.find(i => i.interface === "modem_0001");

    // Online clients
    const onlineClients = clients.filter(c => c.online);
    const wlanClients = onlineClients.filter(c => c.iface !== "cable");
    const lanClients = onlineClients.filter(c => c.iface === "cable");

    // Active radios (non-guest, up)
    const mainRadios = radios.filter(r => !r.guest && r.up);
    const guestRadios = radios.filter(r => r.guest && r.up);

    // Active services
    const activeVpn = vpn.filter(s => s.active);

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .card-section { background: var(--primary-background-color); border-radius: 8px; padding: 12px; }
        .section-label { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.6px; color: var(--secondary-text-color); margin-bottom: 8px; }
        .full-width { grid-column: 1 / -1; }

        /* Status dots */
        .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dot.online { background: var(--success-color, #4caf50); }
        .dot.up { background: var(--warning-color, #ff9800); }
        .dot.down { background: var(--disabled-text-color, #555); }

        /* WAN source rows */
        .wan-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 0.88em; }
        .wan-label { min-width: 70px; font-weight: 500; }
        .wan-detail { color: var(--secondary-text-color); font-size: 0.9em; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* Repeater info grid */
        .info-grid { display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; font-size: 0.82em; margin-top: 4px; }
        .info-grid .label { color: var(--secondary-text-color); }
        .info-grid .value { font-family: monospace; font-size: 0.95em; }

        /* Client list */
        .client-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 0.85em; }
        .client-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .client-detail { color: var(--secondary-text-color); font-size: 0.9em; font-family: monospace; }
        .client-iface { font-size: 0.8em; }

        /* Radio pills */
        .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 0.78em; font-weight: 500; letter-spacing: 0.2px; line-height: 1.5; }
        .pill-2g { background: rgba(33, 150, 243, 0.15); color: #1976d2; }
        .pill-5g { background: rgba(156, 39, 176, 0.15); color: #7b1fa2; }
        .pill-on { background: rgba(76, 175, 80, 0.15); color: var(--success-color, #4caf50); }
        .pill-off { background: rgba(128,128,128,0.12); color: var(--disabled-text-color, #666); }

        /* Radio row */
        .radio-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 0.85em; }
        .radio-ssid { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* Service badges */
        .service-badges { display: flex; flex-wrap: wrap; gap: 4px; }

        /* System stats bar */
        .sys-bar { display: flex; align-items: center; gap: 16px; font-size: 0.82em; color: var(--secondary-text-color); padding: 0 0 12px; flex-wrap: wrap; }
        .sys-stat { display: flex; align-items: center; gap: 4px; }
        .sys-stat .val { color: var(--primary-text-color); font-weight: 500; }

        /* Buttons */
        .btn { border: none; border-radius: 8px; padding: 8px 16px; cursor: pointer; font-size: 0.9em; font-family: inherit; transition: opacity 0.2s; }
        .btn:hover { opacity: 0.85; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .btn-outline { background: transparent; border: 1px solid var(--divider-color); color: var(--primary-text-color); }
        .btn-danger { background: transparent; border: 1px solid var(--error-color, #f44336); color: var(--error-color, #f44336); }
        .btn-small { padding: 4px 12px; font-size: 0.8em; }

        /* Scan section */
        .scan-toggle { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .band-filter { display: flex; gap: 8px; margin-left: auto; margin-right: 190px; }
        .band-filter .btn-filter { border: 1px solid var(--divider-color); border-radius: 12px; padding: 2px 0; cursor: pointer; font-size: 0.72em; font-family: inherit; background: transparent; color: var(--secondary-text-color); transition: all 0.15s; text-align: center; box-sizing: border-box; }
        .band-filter .btn-filter[data-band="all"] { min-width: 36px; }
        .band-filter .btn-filter[data-band="2g"] { min-width: 60px; }
        .band-filter .btn-filter[data-band="5g"] { min-width: 48px; }
        .band-filter .btn-filter:hover { border-color: var(--primary-color); color: var(--primary-color); }
        .band-filter .btn-filter.active { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        .network-list { display: flex; flex-direction: column; gap: 3px; }
        .network-item { display: grid; grid-template-columns: auto 1fr 60px 48px 36px 58px 62px; align-items: center; gap: 0 8px; padding: 5px 10px; border-radius: 6px; background: var(--card-background-color, var(--ha-card-background, #1c1c1c)); }
        .network-item.current { background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.08); }
        .network-ssid { font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        .network-band-24, .network-band-5 { text-align: center; }
        .network-enc { font-size: 0.78em; color: var(--secondary-text-color); white-space: nowrap; text-align: right; }
        .network-dbm { font-size: 0.78em; color: var(--secondary-text-color); white-space: nowrap; text-align: right; font-family: monospace; }
        .network-item .btn { min-width: 62px; text-align: center; box-sizing: border-box; }
        .network-detail { font-size: 0.78em; color: var(--secondary-text-color); white-space: nowrap; display: flex; align-items: center; gap: 4px; }

        /* Wi-Fi signal bars */
        .wifi-icon { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; flex-shrink: 0; }
        .wifi-bar { width: 3px; border-radius: 1px; background: var(--disabled-text-color, #555); opacity: 0.25; }
        .wifi-bar.on { opacity: 1; }
        .wifi-bar.b1 { height: 3px; } .wifi-bar.b2 { height: 6px; } .wifi-bar.b3 { height: 9px; } .wifi-bar.b4 { height: 13px; }
        .sig-4 .wifi-bar.on, .sig-3 .wifi-bar.on { background: var(--success-color, #4caf50); }
        .sig-2 .wifi-bar.on { background: var(--warning-color, #ff9800); }
        .sig-1 .wifi-bar.on { background: var(--error-color, #f44336); }

        /* Manual connect */
        .manual-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; padding: 4px 0; font-size: 0.88em; color: var(--primary-text-color); background: none; border: none; font-family: inherit; width: 100%; text-align: left; }
        .manual-toggle:hover { color: var(--primary-color); }
        .manual-toggle .arrow { font-size: 0.7em; transition: transform 0.2s; }
        .manual-toggle .arrow.open { transform: rotate(90deg); }
        .manual-form { display: flex; flex-direction: column; gap: 8px; padding: 8px 0 4px; }
        .manual-form input { width: 100%; padding: 8px 12px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--primary-background-color); color: var(--primary-text-color); font-size: 0.9em; font-family: inherit; box-sizing: border-box; }
        .manual-form input:focus { outline: none; border-color: var(--primary-color); }
        .manual-form label { font-size: 0.8em; color: var(--secondary-text-color); }
        .manual-form .form-row { display: flex; flex-direction: column; gap: 4px; }
        .manual-form .form-actions { display: flex; justify-content: flex-end; padding-top: 4px; }
        .empty-state { text-align: center; padding: 12px; color: var(--secondary-text-color); font-size: 0.85em; }
      </style>
      <ha-card>
        <!-- System Stats Bar -->
        <div class="sys-bar">
          ${sys.cpu_temp != null ? `<span class="sys-stat">CPU <span class="val">${sys.cpu_temp}&deg;C</span></span>` : ''}
          ${sys.battery_percent != null ? `<span class="sys-stat">${sys.battery_charging ? '&#9889;' : '&#128267;'} <span class="val">${sys.battery_percent}%</span></span>` : ''}
          ${sys.memory_total ? `<span class="sys-stat">RAM <span class="val">${this._formatBytes(sys.memory_free)}</span> free</span>` : ''}
          ${sys.uptime ? `<span class="sys-stat">Up <span class="val">${this._formatUptime(sys.uptime)}</span></span>` : ''}
          ${sys.lan_ip ? `<span class="sys-stat">LAN <span class="val">${this._esc(sys.lan_ip)}</span></span>` : ''}
        </div>

        <!-- WAN Sources + Connected Clients -->
        <div class="grid">
          <div class="card-section">
            <div class="section-label">WAN Sources</div>
            ${wan ? `<div class="wan-row">${this._dot(wan.online, wan.up)}<span class="wan-label">Ethernet</span><span class="wan-detail">${wan.online ? 'online' : wan.up ? 'up' : 'disconnected'}</span></div>` : ''}
            ${secondwan ? `<div class="wan-row">${this._dot(secondwan.online, secondwan.up)}<span class="wan-label">Ethernet 2</span><span class="wan-detail">${secondwan.online ? 'online' : secondwan.up ? 'up' : 'disconnected'}</span></div>` : ''}
            <div class="wan-row">${this._dot(wwan?.online, wwan?.up)}<span class="wan-label">Repeater</span><span class="wan-detail">${isConnected ? this._esc(connectedSsid) : 'disconnected'}</span></div>
            ${tethering ? `<div class="wan-row">${this._dot(tethering.online, tethering.up)}<span class="wan-label">Tethering</span><span class="wan-detail">${tethering.online ? 'online' : tethering.up ? 'up' : 'disconnected'}</span></div>` : ''}
            ${modem0 ? `<div class="wan-row">${this._dot(modem0.online, modem0.up)}<span class="wan-label">Cellular</span><span class="wan-detail">${modem.apn ? this._esc(modem.apn) : modem0.online ? 'online' : 'disconnected'}${modem.model ? ' &middot; ' + this._esc(modem.model.split('_')[0]) : ''}</span></div>` : ''}
          </div>

          <div class="card-section">
            <div class="section-label">Connected Clients</div>
            ${wlanClients.length > 0 ? wlanClients.map(cl => `
              <div class="client-row">
                ${this._dot(true, false)}
                <span class="client-name">${this._esc(cl.name || 'Unknown')}</span>
                <span class="pill ${cl.iface === '5G' ? 'pill-5g' : 'pill-2g'}">${this._esc(this._bandLabel(cl.iface) || '?')}</span>
                <span class="client-detail">${this._esc(cl.ip || '')}</span>
              </div>
            `).join('') : ''}
            ${lanClients.length > 0 ? lanClients.map(cl => `
              <div class="client-row">
                ${this._dot(true, false)}
                <span class="client-name">${this._esc(cl.name || 'Unknown')}</span>
                <span class="pill pill-on">LAN</span>
                <span class="client-detail">${this._esc(cl.ip || '')}</span>
              </div>
            `).join('') : ''}
            ${onlineClients.length === 0 ? '<div class="empty-state">No clients connected</div>' : ''}
          </div>
        </div>

        <!-- Services + Wi-Fi Radios -->
        <div class="grid">
          <div class="card-section">
            <div class="section-label">Services</div>
            <div class="service-badges">
              ${vpnTunnels.map(t => `<span class="pill ${t.connected ? 'pill-on' : 'pill-off'}">${this._esc(t.type)}${t.connected ? ' &#10003;' : ''}</span>`).join('')}
              ${vpn.map(s => `<span class="pill ${s.active ? 'pill-on' : 'pill-off'}">${this._esc(s.name)}</span>`).join('')}
            </div>
            ${vpnTunnels.filter(t => t.connected).map(t => `
              <div class="info-grid" style="margin-top:6px">
                ${t.name ? `<span class="label">Tunnel</span><span class="value">${this._esc(t.name)}</span>` : ''}
                ${t.ipv4 ? `<span class="label">IP</span><span class="value">${this._esc(t.ipv4)}</span>` : ''}
                ${t.domain && t.domain.length ? `<span class="label">Endpoint</span><span class="value">${this._esc(t.domain[0])}${t.port ? ':' + t.port : ''}</span>` : ''}
                ${t.tx_bytes ? `<span class="label">TX / RX</span><span class="value">${this._formatBytes(t.tx_bytes)} / ${this._formatBytes(t.rx_bytes)}</span>` : ''}
              </div>
            `).join('')}
            ${modem.model ? `
              <div class="section-label" style="margin-top:10px">Cellular</div>
              <div class="info-grid">
                ${modem.apn ? `<span class="label">APN</span><span class="value">${this._esc(modem.apn)}</span>` : ''}
                ${modem.traffic_bytes ? `<span class="label">Traffic</span><span class="value">${this._formatBytes(modem.traffic_bytes)}</span>` : ''}
                ${modem.sms_unread ? `<span class="label">SMS</span><span class="value">${modem.sms_unread} unread</span>` : ''}
                ${modem.imei ? `<span class="label">IMEI</span><span class="value">${this._esc(modem.imei)}</span>` : ''}
              </div>
            ` : ''}
          </div>

          <div class="card-section">
            <div class="section-label">Wi-Fi Radios</div>
            ${mainRadios.map(r => `
              <div class="radio-row">
                <span class="pill ${r.band === '2G' ? 'pill-2g' : 'pill-5g'}">${this._esc(this._bandLabel(r.band))}</span>
                <span class="radio-ssid">${this._esc(r.ssid)}</span>
                ${r.hidden ? '<span style="font-size:0.75em;color:var(--secondary-text-color)">hidden</span>' : ''}
              </div>
            `).join('')}
            ${guestRadios.map(r => `
              <div class="radio-row">
                <span class="pill ${r.band === '2G' ? 'pill-2g' : 'pill-5g'}">${this._esc(this._bandLabel(r.band))}</span>
                <span class="radio-ssid">${this._esc(r.ssid)}</span>
                <span style="font-size:0.75em;color:var(--secondary-text-color)">guest</span>
              </div>
            `).join('')}
            ${mainRadios.length === 0 && guestRadios.length === 0 ? '<div class="empty-state">No radios active</div>' : ''}
          </div>
        </div>

        <!-- Repeater Connection Details (when connected) -->
        ${isConnected ? `
        <div class="card-section" style="margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px">
                ${this._signalBars(signalDbm)}
                <span style="font-weight:500">${this._esc(connectedSsid)}</span>
                <span style="font-size:0.82em;color:var(--secondary-text-color)">${signalDbm != null ? signalDbm + ' dBm' : ''}</span>
              </div>
              <div class="info-grid" style="margin-top:6px">
                ${ri.ip_address ? `<span class="label">IP</span><span class="value">${this._esc(ri.ip_address)}</span>` : ''}
                ${ri.macaddr ? `<span class="label">MAC</span><span class="value">${this._esc(ri.macaddr)}</span>` : ''}
                ${ri.gateway ? `<span class="label">Gateway</span><span class="value">${this._esc(ri.gateway)}</span>` : ''}
                ${ri.connected ? `<span class="label">Connected</span><span class="value">${this._esc(ri.connected)}</span>` : ''}
                ${ri.channel ? `<span class="label">Channel</span><span class="value">${ri.channel}</span>` : ''}
                ${ri.bssid ? `<span class="label">BSSID</span><span class="value">${this._esc(ri.bssid)}</span>` : ''}
              </div>
            </div>
            ${c.disconnect_button ? `<button class="btn btn-danger btn-small" id="btn-disconnect">Disconnect</button>` : ''}
          </div>
        </div>
        ` : ''}

        <!-- Scan / Network Picker -->
        <div style="margin-top:14px">
          <div class="scan-toggle">
            <button class="btn btn-primary btn-small" id="btn-scan" ${this._scanning ? "disabled" : ""}>
              ${this._scanning ? "Scanning\u2026" : "Scan Wi-Fi"}
            </button>
            ${scanResults.length > 0 ? `
              <button class="btn btn-outline btn-small" id="btn-toggle-scan">${this._scanOpen ? 'Hide' : 'Show'} ${scanResults.length} networks</button>
              <div class="band-filter">
                <button class="btn-filter ${bf === null ? 'active' : ''}" data-band="all">All</button>
                <button class="btn-filter ${bf === '2g' ? 'active' : ''}" data-band="2g">2.4G</button>
                <button class="btn-filter ${bf === '5g' ? 'active' : ''}" data-band="5g">5G</button>
              </div>
            ` : ''}
          </div>
          ${this._scanOpen && scanResults.length > 0 ? `
            <div class="network-list">
              ${filteredResults.map(net => `
                <div class="network-item ${net.ssid === connectedSsid ? 'current' : ''}">
                  ${this._signalBars(net.signal)}
                  <span class="network-ssid">${this._esc(net.ssid)}</span>
                  <span class="network-band-24">${net.band && net.band.includes('2g') ? '<span class="pill pill-2g">2.4 GHz</span>' : ''}</span>
                  <span class="network-band-5">${net.band && net.band.includes('5g') ? '<span class="pill pill-5g">5 GHz</span>' : ''}</span>
                  <span class="network-enc">${net.encryption ? this._esc(net.encryption) : ''}</span>
                  <span class="network-dbm">${net.signal != null ? net.signal + ' dBm' : ''}</span>
                  ${net.ssid !== connectedSsid
                    ? `<button class="btn btn-outline btn-small btn-join" data-ssid="${this._esc(net.ssid)}" ${this._connecting ? 'disabled' : ''}>Join</button>`
                    : '<button class="btn btn-outline btn-small" disabled>Current</button>'}
                </div>
              `).join("")}
            </div>
          ` : ''}

          <div style="border-top:1px solid var(--divider-color);margin-top:8px;padding-top:6px">
            <button class="manual-toggle" id="btn-manual-toggle">
              <span class="arrow ${this._manualOpen ? 'open' : ''}">&#9654;</span> Manual Connect
            </button>
            ${this._manualOpen ? `
              <div class="manual-form">
                <div class="form-row"><label>SSID</label><input type="text" id="manual-ssid" placeholder="Network name" value="${this._esc(this._manualSsid)}"></div>
                <div class="form-row"><label>Password</label><input type="password" id="manual-key" placeholder="Leave empty for open networks" value="${this._esc(this._manualKey)}"></div>
                <div class="form-actions"><button class="btn btn-primary btn-small" id="btn-manual-connect" ${this._connecting ? 'disabled' : ''}>${this._connecting ? 'Connecting\u2026' : 'Connect'}</button></div>
              </div>
            ` : ''}
          </div>
        </div>
      </ha-card>
    `;

    // --- Bind events ---
    this.shadowRoot.getElementById("btn-scan")?.addEventListener("click", () => this._pressScan());
    this.shadowRoot.getElementById("btn-disconnect")?.addEventListener("click", () => this._pressDisconnect());
    this.shadowRoot.getElementById("btn-manual-toggle")?.addEventListener("click", () => this._toggleManual());
    this.shadowRoot.getElementById("btn-toggle-scan")?.addEventListener("click", () => this._toggleScan());
    this.shadowRoot.querySelectorAll(".btn-filter").forEach(btn => btn.addEventListener("click", () => this._setBandFilter(btn.dataset.band === "all" ? null : btn.dataset.band)));

    const ssidInput = this.shadowRoot.getElementById("manual-ssid");
    if (ssidInput) { ssidInput.addEventListener("input", e => { this._manualSsid = e.target.value; }); }
    const keyInput = this.shadowRoot.getElementById("manual-key");
    if (keyInput) { keyInput.addEventListener("input", e => { this._manualKey = e.target.value; }); }
    this.shadowRoot.getElementById("btn-manual-connect")?.addEventListener("click", () => {
      if (this._manualSsid.trim()) this._connectTo(this._manualSsid.trim(), this._manualKey);
    });
    this.shadowRoot.querySelectorAll(".btn-join").forEach(btn => btn.addEventListener("click", () => this._joinScanned(btn.dataset.ssid)));
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
  name: "GL.iNet Network Overview",
  description: "Full network dashboard for GL.iNet routers",
});

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchControlHealth,
  fetchControlReadiness,
  fetchControlServices,
  fetchControlSettings,
  fetchControlUsb,
  runControlServiceAction,
  saveControlCollectorSettings,
  saveControlDeviceSettings,
  saveControlSite
} from "../data/api";
import type { ControlCollectorService, ControlSettingsResponse, ControlUsbDevice, SiteAnchor } from "../domain/types";
import type { ControlReadinessResponse } from "../domain/types";
import { AppNavigation } from "./AppNavigation";

interface SettingsPageState {
  devices: ControlUsbDevice[];
  services: ControlCollectorService[];
  settings: ControlSettingsResponse | null;
  readiness: ControlReadinessResponse | null;
  controlStatus: string;
  loading: boolean;
  error: string | null;
  loadedAt: string | null;
}

interface CollectorDraft {
  enabled: boolean;
  values: Record<string, string | boolean>;
}

interface DeviceDraft {
  alias: string;
  family_override: string;
  enabled: boolean;
  collector_ids: string[];
}

interface SiteDraft {
  label: string;
  latitude: string;
  longitude: string;
  floor_heading_degrees: string;
}

const FAMILY_LABELS: Record<string, string> = {
  rtl_sdr: "RTL-SDR",
  hackrf: "HackRF",
  usrp_b210: "USRP / LibreSDR B210",
  nrf52: "nRF52",
  ble_analyzer: "BLE analyzer",
  wifi_bt_adapter: "Wi-Fi / BT adapter",
  usb_topology: "USB topology",
  gps: "GPS",
  unknown: "Unknown"
};

export function SettingsPage() {
  const [state, setState] = useState<SettingsPageState>({
    devices: [],
    services: [],
    settings: null,
    readiness: null,
    controlStatus: "unknown",
    loading: true,
    error: null,
    loadedAt: null
  });
  const [editingCollectorId, setEditingCollectorId] = useState<string | null>(null);
  const [collectorDraft, setCollectorDraft] = useState<CollectorDraft>({ enabled: true, values: {} });
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<DeviceDraft>({ alias: "", family_override: "", enabled: true, collector_ids: [] });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showUsbTopology, setShowUsbTopology] = useState(false);
  const [siteDraft, setSiteDraft] = useState<SiteDraft>(buildSiteDraft(null));
  const siteDraftDirtyRef = useRef(false);

  const loadInventory = async () => {
    try {
      const [health, usb, services, settings, readiness] = await Promise.all([
        fetchControlHealth(),
        fetchControlUsb(),
        fetchControlServices(),
        fetchControlSettings(),
        fetchControlReadiness().then(normalizeReadiness).catch(() => null)
      ]);
      setState({
        devices: usb.devices,
        services: services.services,
        settings,
        readiness,
        controlStatus: health.status,
        loading: false,
        error: null,
        loadedAt: new Date().toISOString()
      });
      setSiteDraft((currentDraft) => (siteDraftDirtyRef.current ? currentDraft : buildSiteDraft(settings.site)));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        controlStatus: "unavailable",
        error: error instanceof Error ? error.message : "Unable to load TDS control inventory"
      }));
    }
  };

  useEffect(() => {
    void loadInventory();
    const interval = window.setInterval(() => void loadInventory(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleDevices = useMemo(
    () => state.devices.filter((device) => showUsbTopology || !isUsbTopologyDevice(device, state.settings)),
    [state.devices, state.settings, showUsbTopology]
  );
  const topologyDeviceCount = state.devices.length - visibleDevices.length;
  const devicesByFamily = useMemo(() => groupDevicesByFamily(state.devices, state.settings), [state.devices, state.settings]);

  const beginCollectorEdit = (service: ControlCollectorService) => {
    setEditingCollectorId(service.id);
    setCollectorDraft(buildCollectorDraft(service, state.settings));
    setStatusMessage(null);
  };

  const saveCollector = async (service: ControlCollectorService) => {
    setSavingKey(`collector:${service.id}`);
    try {
      const settings = await saveControlCollectorSettings(service.id, {
        enabled: collectorDraft.enabled,
        values: collectorValuesFromDraft(service, collectorDraft)
      });
      setState((current) => ({ ...current, settings }));
      setEditingCollectorId(null);
      setStatusMessage(`${service.label} settings saved`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Unable to save ${service.label}`);
    } finally {
      setSavingKey(null);
    }
  };

  const runAction = async (service: ControlCollectorService, action: string) => {
    setSavingKey(`action:${service.id}:${action}`);
    try {
      const result = await runControlServiceAction(service.id, action);
      setStatusMessage(result.message || `${service.label} ${action} ${result.status}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Unable to ${action} ${service.label}`);
    } finally {
      setSavingKey(null);
    }
  };

  const beginDeviceEdit = (device: ControlUsbDevice) => {
    setEditingDeviceId(device.stable_id);
    setDeviceDraft(buildDeviceDraft(device, state.settings));
    setStatusMessage(null);
  };

  const saveDevice = async (device: ControlUsbDevice) => {
    setSavingKey(`device:${device.stable_id}`);
    try {
      const settings = await saveControlDeviceSettings(device.stable_id, {
        alias: deviceDraft.alias.trim() || null,
        family_override: deviceDraft.family_override || null,
        enabled: deviceDraft.enabled,
        collector_ids: deviceDraft.collector_ids
      });
      setState((current) => ({ ...current, settings }));
      setEditingDeviceId(null);
      setStatusMessage(`${device.product || device.stable_id} device settings saved`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Unable to save ${device.product || device.stable_id}`);
    } finally {
      setSavingKey(null);
    }
  };

  const saveSite = async () => {
    setSavingKey("site");
    try {
      const site = await saveControlSite(sitePayloadFromDraft(siteDraft));
      setState((current) => ({
        ...current,
        settings: current.settings
          ? { ...current.settings, site, source: "saved" }
          : { collectors: {}, devices: {}, site, source: "saved", apply_note: "Saved settings are desired state." }
      }));
      setSiteDraft(buildSiteDraft(site));
      siteDraftDirtyRef.current = false;
      setStatusMessage("Site origin settings saved");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save site origin settings");
    } finally {
      setSavingKey(null);
    }
  };

  const updateSiteDraft = (changes: Partial<SiteDraft>) => {
    siteDraftDirtyRef.current = true;
    setSiteDraft((current) => ({ ...current, ...changes }));
  };

  return (
    <main className="settings-page">
      <header className="settings-header">
        <div>
          <p className="presence-eyebrow">Portable control plane</p>
          <h1>TDS Settings</h1>
          <p>Detected hardware, collector services, and editable desired control-plane settings for this install.</p>
          <div className="settings-status-strip" aria-label="Settings page state">
            <span className="settings-chip is-good">editable</span>
            <span className="settings-chip">30s refresh</span>
            <span className="settings-chip is-sidecar">control sidecar</span>
          </div>
        </div>
        <AppNavigation />
      </header>

      <section className="settings-hero" aria-label="Control Plane Status">
        <SettingsMetric label="Control plane" value={state.error ? "Unavailable" : state.loading ? "Loading" : state.controlStatus} tone={state.error ? "bad" : "good"} />
        <SettingsMetric label="USB hardware" value={String(state.devices.length)} />
        <SettingsMetric label="Collectors" value={String(state.services.length)} />
        <SettingsMetric label="Last refresh" value={state.loadedAt ? new Date(state.loadedAt).toLocaleTimeString() : "Pending"} />
      </section>

      {state.error ? <p className="settings-error">{state.error}</p> : null}
      {statusMessage ? <p className="settings-notice">{statusMessage}</p> : null}

      {state.readiness ? <ReadinessPanel readiness={state.readiness} /> : null}

      <section className="settings-panel settings-site-panel" aria-label="Site floor origin">
        <PanelHeader eyebrow="3D World Anchor" title="Site / Floor Origin" />
        <form className="settings-edit-form" onSubmit={(event) => { event.preventDefault(); void saveSite(); }}>
          <div className="settings-form-grid">
            <label>
              <span>Label</span>
              <input aria-label="Site label" value={siteDraft.label} onChange={(event) => updateSiteDraft({ label: event.target.value })} />
            </label>
            <label>
              <span>Latitude</span>
              <input
                aria-label="Site latitude"
                type="number"
                step="0.000001"
                value={siteDraft.latitude}
                onChange={(event) => updateSiteDraft({ latitude: event.target.value })}
              />
            </label>
            <label>
              <span>Longitude</span>
              <input
                aria-label="Site longitude"
                type="number"
                step="0.000001"
                value={siteDraft.longitude}
                onChange={(event) => updateSiteDraft({ longitude: event.target.value })}
              />
            </label>
            <label>
              <span>Floor heading</span>
              <input
                aria-label="Floor heading degrees"
                type="number"
                step="1"
                value={siteDraft.floor_heading_degrees}
                onChange={(event) => updateSiteDraft({ floor_heading_degrees: event.target.value })}
              />
            </label>
          </div>
          <div className="settings-chip-row" aria-label="Active site origin">
            <span className="settings-chip is-sidecar">{state.settings?.site?.source ?? "defaults"}</span>
            <span className="settings-chip">{siteDraft.latitude || "lat unset"}</span>
            <span className="settings-chip">{siteDraft.longitude || "lon unset"}</span>
          </div>
          <div className="settings-action-row">
            <button type="submit" disabled={savingKey === "site"} aria-label="Save site origin settings">
              {savingKey === "site" ? "Saving..." : "Save Site Origin"}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-grid" aria-label="Settings inventory">
        <div className="settings-panel">
          <PanelHeader eyebrow="Hardware Inventory" title="USB Devices" />
          {state.loading ? <p className="settings-empty">Loading USB hardware...</p> : null}
          {topologyDeviceCount > 0 ? (
            <div className="settings-panel-toolbar">
              <span className="settings-chip is-muted">
                {showUsbTopology ? `${topologyDeviceCount} topology visible` : `${topologyDeviceCount} topology hidden`}
              </span>
              <button
                type="button"
                onClick={() => setShowUsbTopology((current) => !current)}
                aria-label={showUsbTopology ? "Hide USB topology devices" : "Show USB topology devices"}
              >
                {showUsbTopology ? "Hide USB topology" : "Show USB topology"}
              </button>
            </div>
          ) : null}
          {!state.loading && visibleDevices.length === 0 ? (
            <p className="settings-empty">
              {state.devices.length > 0 ? "Only USB topology devices are hidden by default." : "No USB hardware reported by the control sidecar."}
            </p>
          ) : null}
          <div className="settings-device-list">
            {visibleDevices.map((device) => {
              const saved = state.settings?.devices[device.stable_id];
              const effectiveFamily = effectiveDeviceFamily(device, state.settings);
              const title = device.product || "Unnamed USB device";
              return (
                <article key={device.stable_id} className={`settings-device-card ${tokenClass(effectiveFamily)}`}>
                  <div className="settings-card-head">
                    <div>
                      <span className={`settings-family-pill ${tokenClass(effectiveFamily)}`}>{FAMILY_LABELS[effectiveFamily] ?? effectiveFamily}</span>
                      <strong>{title}</strong>
                      {saved?.alias ? <em className="settings-alias">{saved.alias}</em> : null}
                    </div>
                    <span className="settings-status-pill">{saved?.enabled === false ? "disabled" : device.speed ? `${device.speed} Mbps` : "speed unknown"}</span>
                  </div>
                  <div className="settings-primary-id">
                    <span>Stable ID</span>
                    <strong>{device.stable_id}</strong>
                  </div>
                  <div className="settings-chip-row" aria-label={`${title} hardware details`}>
                    <span className="settings-chip">{device.serial || "serial unavailable"}</span>
                    <span className="settings-chip">{device.bus_path}</span>
                    <span className="settings-chip">{device.driver || "unbound"}</span>
                    <span className="settings-chip">{`${device.vendor_id}:${device.product_id}`}</span>
                    <span className="settings-chip">{device.manufacturer || "unknown"}</span>
                  </div>
                  <div className="settings-action-row">
                    <button type="button" onClick={() => beginDeviceEdit(device)} aria-label={`Edit ${title}`}>
                      Edit
                    </button>
                    {saved?.collector_ids?.length ? <span className="settings-chip is-sidecar">{saved.collector_ids.join(", ")}</span> : null}
                  </div>
                  {editingDeviceId === device.stable_id ? (
                    <DeviceSettingsForm
                      device={device}
                      services={state.services}
                      draft={deviceDraft}
                      saving={savingKey === `device:${device.stable_id}`}
                      onDraftChange={setDeviceDraft}
                      onCancel={() => setEditingDeviceId(null)}
                      onSave={() => void saveDevice(device)}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="settings-panel">
          <PanelHeader eyebrow="Collector Services" title="Configured Collectors" />
          {state.loading ? <p className="settings-empty">Loading collector manifest...</p> : null}
          {!state.loading && state.services.length === 0 ? <p className="settings-empty">No collector services reported by the control sidecar.</p> : null}
          <div className="settings-service-list">
            {state.services.map((service) => (
              <article key={service.id} className={`settings-service-card ${tokenClass(service.start_mode)}`}>
                <div className="settings-card-head">
                  <div>
                    <span className={`settings-mode-pill ${tokenClass(service.start_mode)}`}>{service.start_mode}</span>
                    <strong>{service.label}</strong>
                  </div>
                  <span className="settings-status-pill">{state.settings?.collectors[service.id]?.enabled === false ? "disabled" : service.device_families.length ? "hardware bound" : "network/API"}</span>
                </div>
                <div className="settings-primary-id">
                  <span>Service</span>
                  <strong>{service.service_name}</strong>
                </div>
                <p className="settings-service-summary">{service.roles.length ? service.roles.join(", ") : "network/API collector"}</p>
                <div className="settings-chip-row" aria-label={`${service.label} hardware families`}>
                  {(service.device_families.length ? service.device_families : ["none required"]).map((family) => (
                    <span key={family} className={`settings-family-pill ${tokenClass(family)}`}>
                      {family}
                    </span>
                  ))}
                </div>
                <div className="settings-config-row" aria-label={`${service.label} configurable fields`}>
                  {Object.keys(service.settings_schema).length
                    ? Object.keys(service.settings_schema).map((key) => (
                        <span key={key} className="settings-config-chip">
                          {key}
                        </span>
                      ))
                    : <span className="settings-config-chip">none</span>}
                </div>
                <div className="settings-action-row">
                  <button type="button" onClick={() => beginCollectorEdit(service)} aria-label={`Configure ${service.label}`}>
                    Configure
                  </button>
                  <button type="button" onClick={() => void runAction(service, "test")} disabled={savingKey === `action:${service.id}:test`} aria-label={`Test ${service.label}`}>
                    Test
                  </button>
                  <button type="button" onClick={() => void runAction(service, "restart")} disabled={savingKey === `action:${service.id}:restart`} aria-label={`Restart ${service.label}`}>
                    Restart
                  </button>
                </div>
                {editingCollectorId === service.id ? (
                  <CollectorSettingsForm
                    service={service}
                    draft={collectorDraft}
                    saving={savingKey === `collector:${service.id}`}
                    onDraftChange={setCollectorDraft}
                    onCancel={() => setEditingCollectorId(null)}
                    onSave={() => void saveCollector(service)}
                  />
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-panel settings-family-panel" aria-label="Hardware families">
        <PanelHeader eyebrow="Assignment Context" title="Detected Device Families" />
        <div className="settings-family-grid">
          {Object.entries(devicesByFamily).map(([family, count]) => (
            <div key={family}>
              <span>{FAMILY_LABELS[family] ?? family}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function SettingsMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  return (
    <div className={`settings-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReadinessPanel({ readiness }: { readiness: ControlReadinessResponse }) {
  const checks = readiness.checks ?? [];
  return (
    <section className="settings-panel settings-readiness-panel" aria-label="Portable deploy readiness">
      <div className="settings-panel-header">
        <span>Portable Install</span>
        <h2>Deploy Readiness</h2>
      </div>
      <div className="settings-chip-row" aria-label="Deploy readiness summary">
        <span className={`settings-chip ${readinessToneClass(readiness.overall)}`}>{readiness.overall}</span>
        <span className="settings-chip">{checks.length} checks</span>
      </div>
      <div className="settings-readiness-grid">
        {checks.map((check) => (
          <article key={check.id} className={`settings-readiness-card ${readinessToneClass(check.status)}`}>
            <div className="settings-card-head">
              <strong>{check.label}</strong>
              <span className={`settings-status-pill ${readinessToneClass(check.status)}`}>{check.status}</span>
            </div>
            <p>{check.detail}</p>
            {check.action ? <em>{check.action}</em> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function normalizeReadiness(value: ControlReadinessResponse): ControlReadinessResponse | null {
  if (!value || !Array.isArray(value.checks)) {
    return null;
  }
  return value;
}

function readinessToneClass(status: string) {
  if (status === "ready") {
    return "is-good";
  }
  if (status === "missing") {
    return "is-bad";
  }
  return "is-warn";
}

function PanelHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="settings-panel-header">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function CollectorSettingsForm({
  service,
  draft,
  saving,
  onDraftChange,
  onCancel,
  onSave
}: {
  service: ControlCollectorService;
  draft: CollectorDraft;
  saving: boolean;
  onDraftChange: (draft: CollectorDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <form className="settings-edit-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <label className="settings-toggle-row">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => onDraftChange({ ...draft, enabled: event.target.checked })} />
        <span>Collector enabled</span>
      </label>
      <div className="settings-form-grid">
        {Object.entries(service.settings_schema).map(([key, schema]) => (
          <label key={key}>
            <span>{key}</span>
            {schema.type === "boolean" ? (
              <input
                aria-label={`${service.label} ${key}`}
                type="checkbox"
                checked={draft.values[key] === true}
                onChange={(event) => onDraftChange({ ...draft, values: { ...draft.values, [key]: event.target.checked } })}
              />
            ) : (
              <input
                aria-label={`${service.label} ${key}`}
                type={schema.secret ? "password" : schema.type === "integer" ? "number" : "text"}
                value={String(draft.values[key] ?? "")}
                placeholder={schema.secret ? "replace secret" : ""}
                onChange={(event) => onDraftChange({ ...draft, values: { ...draft.values, [key]: event.target.value } })}
              />
            )}
          </label>
        ))}
      </div>
      <div className="settings-action-row">
        <button type="submit" disabled={saving} aria-label={`Save ${service.label} settings`}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function DeviceSettingsForm({
  device,
  services,
  draft,
  saving,
  onDraftChange,
  onCancel,
  onSave
}: {
  device: ControlUsbDevice;
  services: ControlCollectorService[];
  draft: DeviceDraft;
  saving: boolean;
  onDraftChange: (draft: DeviceDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const title = device.product || "USB device";
  const families = Array.from(new Set(["", device.family, ...services.flatMap((service) => service.device_families)])).filter(Boolean);
  return (
    <form className="settings-edit-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="settings-form-grid">
        <label>
          <span>Alias</span>
          <input aria-label={`${title} alias`} value={draft.alias} onChange={(event) => onDraftChange({ ...draft, alias: event.target.value })} />
        </label>
        <label>
          <span>Family override</span>
          <select
            aria-label={`${title} family override`}
            value={draft.family_override}
            onChange={(event) => onDraftChange({ ...draft, family_override: event.target.value })}
          >
            <option value="">auto</option>
            {families.map((family) => <option key={family} value={family}>{family}</option>)}
          </select>
        </label>
      </div>
      <label className="settings-toggle-row">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => onDraftChange({ ...draft, enabled: event.target.checked })} />
        <span>Device enabled</span>
      </label>
      <div className="settings-check-grid" aria-label={`${title} collector assignments`}>
        {services.map((service) => (
          <label key={service.id}>
            <input
              type="checkbox"
              checked={draft.collector_ids.includes(service.id)}
              onChange={() => onDraftChange({ ...draft, collector_ids: toggleValue(draft.collector_ids, service.id) })}
            />
            <span>{service.label}</span>
          </label>
        ))}
      </div>
      <div className="settings-action-row">
        <button type="submit" disabled={saving} aria-label={`Save ${title} device settings`}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function effectiveDeviceFamily(device: ControlUsbDevice, settings: ControlSettingsResponse | null): string {
  return settings?.devices[device.stable_id]?.family_override || device.family;
}

function isUsbTopologyDevice(device: ControlUsbDevice, settings: ControlSettingsResponse | null): boolean {
  return effectiveDeviceFamily(device, settings) === "usb_topology";
}

function groupDevicesByFamily(devices: ControlUsbDevice[], settings: ControlSettingsResponse | null): Record<string, number> {
  if (devices.length === 0) {
    return { unknown: 0 };
  }
  return devices.reduce<Record<string, number>>((families, device) => {
    const family = effectiveDeviceFamily(device, settings);
    families[family] = (families[family] ?? 0) + 1;
    return families;
  }, {});
}

function tokenClass(value: string): string {
  return `is-${value.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

function buildCollectorDraft(service: ControlCollectorService, settings: ControlSettingsResponse | null): CollectorDraft {
  const saved = settings?.collectors[service.id];
  const values = Object.fromEntries(
    Object.entries(service.settings_schema).map(([key, schema]) => {
      const value = saved?.values?.[key] ?? schema.default ?? "";
      return [key, schema.type === "boolean" ? value === true || value === "true" : String(value)];
    })
  );
  return { enabled: saved?.enabled ?? true, values };
}

function collectorValuesFromDraft(service: ControlCollectorService, draft: CollectorDraft): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(service.settings_schema)
      .map(([key, schema]) => [key, valueFromDraft(schema, draft.values[key])] as const)
      .filter(([, value]) => value !== "")
  );
}

function valueFromDraft(schema: Record<string, unknown>, value: string | boolean | undefined): unknown {
  if (schema.type === "boolean") {
    return value === true || value === "true";
  }
  if (schema.type === "integer") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : "";
  }
  return value ?? "";
}

function buildDeviceDraft(device: ControlUsbDevice, settings: ControlSettingsResponse | null): DeviceDraft {
  const saved = settings?.devices[device.stable_id];
  return {
    alias: saved?.alias ?? "",
    family_override: saved?.family_override ?? device.family,
    enabled: saved?.enabled ?? true,
    collector_ids: saved?.collector_ids ?? []
  };
}

function buildSiteDraft(site: SiteAnchor | null): SiteDraft {
  return {
    label: site?.label ?? "TDS Lab",
    latitude: String(site?.latitude ?? 0),
    longitude: String(site?.longitude ?? 0),
    floor_heading_degrees: String(site?.floor_heading_degrees ?? 0)
  };
}

function sitePayloadFromDraft(draft: SiteDraft) {
  return {
    latitude: numericDraftValue(draft.latitude, "latitude"),
    longitude: numericDraftValue(draft.longitude, "longitude"),
    label: draft.label.trim() || "TDS Lab",
    floor_heading_degrees: numericDraftValue(draft.floor_heading_degrees, "floor heading")
  };
}

function numericDraftValue(value: string, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid ${label}`);
  }
  return numeric;
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

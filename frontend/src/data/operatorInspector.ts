import type { AircraftSceneEntity, RfSceneEntity } from "./sceneModel";
import type { CurrentStateItem, NetworkClient } from "../domain/types";
import type { InfrastructureAlert } from "./useInfrastructureAlerts";
import type { SituationSourceId } from "./situationModel";

export type OperatorInspectable = RfSceneEntity | AircraftSceneEntity | SourceInspectable | ClientInspectable | null;
export type OperatorInspectorStatus = "empty" | "live" | "stale" | "error";
export type OperatorInspectorTabId = "summary" | "signal" | "network" | "hardware" | "events" | "evidence" | "motion" | "raw";
export type OperatorInspectorTone = "neutral" | "good" | "warn" | "hot" | "muted";

export interface SourceInspectable {
  kind: "source";
  source: SituationSourceId;
  label: string;
}

export interface ClientInspectable {
  kind: "client";
  client: NetworkClient;
  label: string;
}

export interface OperatorInspectorMetric {
  label: string;
  value: string;
  tone: OperatorInspectorTone;
}

export interface OperatorInspectorRow {
  label: string;
  value: string;
}

export interface OperatorInspectorTab {
  id: OperatorInspectorTabId;
  label: string;
  metrics: OperatorInspectorMetric[];
  rows: OperatorInspectorRow[];
}

export interface OperatorInvestigationStep {
  label: string;
  value: string;
  tabId: OperatorInspectorTabId;
  tone: OperatorInspectorTone;
}

export interface OperatorInspectorTag {
  label: string;
  tone: OperatorInspectorTone | string;
}

export interface OperatorInspectorModel {
  status: OperatorInspectorStatus;
  title: string;
  subtitle: string;
  tags: OperatorInspectorTag[];
  investigationPath?: OperatorInvestigationStep[];
  tabs: OperatorInspectorTab[];
}

export interface OperatorInspectorInput {
  selected: OperatorInspectable;
  sourceStates: Partial<Record<SituationSourceId, CurrentStateItem[]>>;
  alerts: InfrastructureAlert[];
  relatedState?: CurrentStateItem | null;
}

export function buildOperatorInspectorModel({ selected, sourceStates, alerts, relatedState = null }: OperatorInspectorInput): OperatorInspectorModel {
  if (!selected) {
    return emptyInspectorModel();
  }
  if (selected.kind === "source") {
    return sourceInspectorModel(selected, sourceStates[selected.source] ?? [], alerts);
  }
  if (selected.kind === "client") {
    return clientInspectorModel(selected.client);
  }
  if (selected.kind === "aircraft") {
    return aircraftInspectorModel(selected, relatedState ?? undefined);
  }
  return rfInspectorModel(selected, relatedState ?? undefined);
}

export function rfInspectorModel(entity: RfSceneEntity, relatedState?: CurrentStateItem): OperatorInspectorModel {
  const operatorRows = rfOperatorRows(entity, relatedState);
  return {
    status: entity.freshness === "live" ? "live" : "stale",
    title: entity.label,
    subtitle: `${entity.protocol} / ${entity.observedKind}`,
    tags: compactTags([
      { label: titleCase(entity.source), tone: `source-${entity.source}` },
      entity.rssi === null ? null : { label: `${entity.rssi} dBm`, tone: signalTone(entity.rssi) },
      { label: entity.freshness, tone: entity.freshness === "live" ? "good" : "warn" },
      { label: entity.category.replace("_", " "), tone: entity.category }
    ]),
    investigationPath: [
      pathStep("Source", titleCase(entity.source), "summary", "good"),
      pathStep("Signal", entity.rssi === null ? "RSSI unknown" : `${entity.rssi} dBm`, "signal", entity.rssi === null ? "muted" : signalTone(entity.rssi)),
      pathStep("Evidence", relatedState ? "state match" : "scene only", "evidence", relatedState ? "good" : "muted"),
      pathStep("Raw", relatedState ? trimMiddle(relatedState.state_key, 24) : trimMiddle(entity.id, 24), "raw", relatedState ? "neutral" : "muted")
    ],
    tabs: [
      tab("summary", "Summary", [
        metric("Category", entity.category.replace("_", " "), "neutral"),
        metric("Source", titleCase(entity.source), "good"),
        metric("RSSI", entity.rssi === null ? "unknown" : `${entity.rssi} dBm`, entity.rssi === null ? "muted" : signalTone(entity.rssi)),
        metric("Sightings", entity.count.toLocaleString(), entity.count > 20 ? "hot" : "neutral")
      ], operatorRows.length > 0 ? operatorRows : [
        row("Identity", entity.identity),
        row("Manufacturer", entity.manufacturer || "unknown"),
        row("Location", `${entity.locationAccuracy}${entity.locationAccuracy === "estimated" ? " / RSSI-estimated" : ""}`),
        row("Last Seen", formatTimestamp(entity.lastSeenAt))
      ]),
      tab("signal", "Signal", [
        metric("RSSI", entity.rssi === null ? "unknown" : `${entity.rssi} dBm`, entity.rssi === null ? "muted" : signalTone(entity.rssi)),
        metric("Channel", entity.channel || "unknown", entity.channel ? "neutral" : "muted"),
        metric("Frequency", entity.frequency ? `${entity.frequency} MHz` : "unknown", entity.frequency ? "neutral" : "muted")
      ], [
        row("Distance", `${Math.round(entity.displayDistanceMeters)} m display`),
        row("Coordinates", `${entity.latitude.toFixed(6)}, ${entity.longitude.toFixed(6)}`)
      ]),
      tab("evidence", "Evidence", [
        metric("Seen", entity.count.toLocaleString(), entity.count > 20 ? "hot" : "neutral"),
        metric("Freshness", entity.freshness, entity.freshness === "live" ? "good" : "warn"),
        metric("State", relatedState ? "matched" : "map only", relatedState ? "good" : "muted")
      ], [
        row("First Seen", formatTimestamp(entity.firstSeenAt)),
        row("Last Seen", formatTimestamp(entity.lastSeenAt)),
        row("Sensor", relatedState?.sensor_id || entity.source)
      ]),
      rawTab(entity, relatedState)
    ]
  };
}

export function aircraftInspectorModel(entity: AircraftSceneEntity, relatedState?: CurrentStateItem): OperatorInspectorModel {
  return {
    status: "live",
    title: entity.label,
    subtitle: `${entity.protocol} / ${entity.model || "aircraft"}`,
    tags: compactTags([
      { label: titleCase(entity.source), tone: `source-${entity.source}` },
      entity.altitude === null ? null : { label: `${Math.round(entity.altitude).toLocaleString()} ft`, tone: "neutral" },
      entity.speed === null ? null : { label: `${Math.round(entity.speed)} kt`, tone: "neutral" },
      { label: `${Math.round(entity.heading)} deg`, tone: "neutral" }
    ]),
    investigationPath: [
      pathStep("Source", titleCase(entity.source), "summary", "good"),
      pathStep("Motion", entity.altitude === null ? "alt unknown" : `${Math.round(entity.altitude).toLocaleString()} ft`, "motion", entity.altitude === null ? "muted" : "neutral"),
      pathStep("Evidence", relatedState ? "state match" : "scene only", "evidence", relatedState ? "good" : "muted"),
      pathStep("Raw", relatedState ? trimMiddle(relatedState.state_key, 24) : trimMiddle(entity.id, 24), "raw", relatedState ? "neutral" : "muted")
    ],
    tabs: [
      tab("summary", "Summary", [
        metric("Source", titleCase(entity.source), "good"),
        metric("Sightings", entity.count.toLocaleString(), entity.count > 20 ? "hot" : "neutral"),
        metric("Distance", `${Math.round(entity.displayDistanceMeters)} m`, "neutral")
      ], [
        row("Identity", entity.identity),
        row("Callsign", entity.label),
        row("Registration", entity.registration || "unknown"),
        row("Icao Type", entity.icaoType || "unknown"),
        row("Model", entity.model || "unknown"),
        row("Owner", entity.owner || "unknown"),
        row("Country", entity.country || "unknown")
      ]),
      tab("motion", "Motion", [
        metric("Altitude", entity.altitude === null ? "unknown" : `${Math.round(entity.altitude).toLocaleString()} ft`, entity.altitude === null ? "muted" : "neutral"),
        metric("Speed", entity.speed === null ? "unknown" : `${Math.round(entity.speed)} kt`, entity.speed === null ? "muted" : "neutral"),
        metric("Heading", `${Math.round(entity.heading)} deg`, "neutral")
      ], [
        row("Altitude", entity.altitude === null ? "unknown" : `${Math.round(entity.altitude).toLocaleString()} ft`),
        row("Speed", entity.speed === null ? "unknown" : `${Math.round(entity.speed)} kt`),
        row("Heading", `${Math.round(entity.heading)} deg`),
        row("Squawk", entity.squawk || "unknown"),
        row("Coordinates", `${entity.latitude.toFixed(6)}, ${entity.longitude.toFixed(6)}`),
        row("Last Seen", formatTimestamp(entity.lastSeenAt))
      ]),
      tab("evidence", "Evidence", [
        metric("State", relatedState ? "matched" : "map only", relatedState ? "good" : "muted"),
        metric("Protocol", entity.protocol.toUpperCase(), "neutral")
      ], [
        row("First Seen", formatTimestamp(entity.firstSeenAt)),
        row("Last Seen", formatTimestamp(entity.lastSeenAt)),
        row("Sensor", relatedState?.sensor_id || entity.source)
      ]),
      rawTab(entity, relatedState)
    ]
  };
}

export function sourceInspectorModel(source: SourceInspectable, states: CurrentStateItem[], alerts: InfrastructureAlert[]): OperatorInspectorModel {
  const latest = latestSeen(states);
  const kindCounts = countBy(states, (item) => item.kind);
  const sourceAlerts = alerts.filter((alert) => alert.source === source.source || alert.details.some((detail) => detail.toLowerCase().includes(source.source)));
  const retryAttempts = sumMetadataNumber(states, "retry_attempts") + sumMetadataNumber(states, "total_retry_attempts");
  const packets = sumMetadataNumber(states, "num_packets") + sumMetadataNumber(states, "packets_total");
  const summary = sourceSummary(source.source, states, kindCounts, latest);
  const hardware = sourceHardware(source.source, states, packets, retryAttempts);
  const events = sourceEvents(sourceAlerts);
  const diagnostics = sourceDiagnostics(states, latest);

  return {
    status: states.length > 0 ? "live" : "empty",
    title: source.label,
    subtitle: `${source.source} source detail`,
    tags: compactTags([
      { label: states.length > 0 ? "Live" : "Empty", tone: states.length > 0 ? "good" : "muted" },
      { label: `${states.length} records`, tone: states.length > 0 ? "good" : "muted" },
      sourceAlerts.length ? { label: `${sourceAlerts.length} events`, tone: "hot" } : null
    ]),
    investigationPath: [
      pathStep("Source", sourceLabel(source.source), "summary", states.length > 0 ? "good" : "muted"),
      pathStep("Hardware", `${hardware.rows.length} signals`, "hardware", hardware.rows.length > 0 ? "neutral" : "muted"),
      pathStep("Events", sourceAlerts.length ? `${sourceAlerts.length} active` : "none", "events", sourceAlerts.length ? "hot" : "muted"),
      pathStep("Raw", `${states.length} records`, "raw", states.length > 0 ? "neutral" : "muted")
    ],
    tabs: [
      tab("summary", "Summary", summary.metrics, summary.rows),
      tab("hardware", "Hardware", hardware.metrics, hardware.rows),
      tab("events", "Events", events.metrics, events.rows),
      tab("raw", "Diagnostics", diagnostics.metrics, diagnostics.rows)
    ]
  };
}

export function clientInspectorModel(client: NetworkClient): OperatorInspectorModel {
  const label = client.alias || client.hostname || client.mac_address;
  const networkLabel = client.network ?? defaultNetworkLabel(client.connection_type) ?? "unknown";
  const connectionLabel = normalizedConnectionType(client.connection_type);
  const lastEvidence = [...client.evidence]
    .filter((evidence) => evidence.last_seen_at)
    .sort((left, right) => new Date(right.last_seen_at ?? 0).getTime() - new Date(left.last_seen_at ?? 0).getTime())[0];
  const sourceCount = client.sources.length;
  return {
    status: client.last_seen_at ? "live" : "stale",
    title: label,
    subtitle: `network client / ${client.mac_address}`,
    tags: compactTags([
      { label: sourceCount > 1 ? `${sourceCount} sources` : client.sources[0] ?? "single source", tone: sourceCount > 1 ? "good" : "neutral" },
      client.primary_ip ? { label: client.primary_ip, tone: "neutral" } : null,
      networkLabel !== "unknown" ? { label: networkLabel, tone: "neutral" } : null,
      client.access_point ? { label: formatAccessPoint(client.access_point), tone: "good" } : null
    ]),
    investigationPath: [
      pathStep("Client", client.primary_ip ?? trimMiddle(client.mac_address, 18), "summary", client.primary_ip ? "good" : "neutral"),
      pathStep("Network", networkLabel, "network", networkLabel !== "unknown" ? "neutral" : "muted"),
      pathStep("Evidence", `${client.evidence.length} records`, "evidence", client.evidence.length > 0 ? "good" : "muted"),
      pathStep("Raw", lastEvidence ? sourceLabel(lastEvidence.source) : "none", "raw", lastEvidence ? "neutral" : "muted")
    ],
    tabs: [
      tab("summary", "Summary", [
        metric("Sources", sourceCount.toLocaleString(), sourceCount > 1 ? "good" : "neutral"),
        metric("Evidence", client.evidence.length.toLocaleString(), client.evidence.length > 0 ? "good" : "muted"),
        metric("Last Seen", formatTimestamp(client.last_seen_at), client.last_seen_at ? "good" : "muted")
      ], compactRows([
        row("Name", label),
        row("MAC", client.mac_address),
        row("Primary IP", client.primary_ip ?? "unknown")
      ])),
      tab("network", "Network", [
        metric("IPs", client.ip_addresses.length.toLocaleString(), client.ip_addresses.length > 0 ? "good" : "muted"),
        metric("Network", networkLabel, networkLabel !== "unknown" ? "neutral" : "muted"),
        metric("Connection", connectionLabel ?? "unknown", connectionLabel ? "neutral" : "muted")
      ], compactRows([
        row("Access Point", client.access_point ? formatAccessPoint(client.access_point) : "unknown"),
        row("Hostnames", client.hostnames.slice(0, 3).join(", ") || "unknown"),
        row("Aliases", client.aliases.slice(0, 3).join(", ") || "unknown")
      ])),
      tab("evidence", "Evidence", [
        metric("Sources", client.sources.join(", ") || "unknown", client.sources.length > 0 ? "good" : "muted"),
        metric("First Seen", formatTimestamp(client.first_seen_at), client.first_seen_at ? "neutral" : "muted")
      ], evidenceRows(client)),
      tab("raw", "Diagnostics", [
        metric("Latest Evidence", lastEvidence ? sourceLabel(lastEvidence.source) : "none", lastEvidence ? "good" : "muted")
      ], compactRows([
        row("Evidence Keys", client.evidence.slice(0, 3).map((item) => trimMiddle(item.state_key, 28)).join(", ") || "none"),
        row("IP Set", client.ip_addresses.slice(0, 4).join(", ") || "none"),
        row("Last Evidence", formatTimestamp(lastEvidence?.last_seen_at ?? null))
      ]))
    ]
  };
}

function emptyInspectorModel(): OperatorInspectorModel {
  return {
    status: "empty",
    title: "No selection",
    subtitle: "Select an object or source",
    tags: [],
    investigationPath: [],
    tabs: []
  };
}

function tab(id: OperatorInspectorTabId, label: string, metrics: OperatorInspectorMetric[], rows: OperatorInspectorRow[]): OperatorInspectorTab {
  return { id, label, metrics, rows };
}

function metric(label: string, value: string, tone: OperatorInspectorTone): OperatorInspectorMetric {
  return { label, value, tone };
}

function pathStep(label: string, value: string, tabId: OperatorInspectorTabId, tone: OperatorInspectorTone): OperatorInvestigationStep {
  return { label, value: conciseValue(value), tabId, tone };
}

function row(label: string, value: string): OperatorInspectorRow {
  return { label: cleanLabel(label), value: conciseValue(value) };
}

function rawTab(entity: RfSceneEntity | AircraftSceneEntity, relatedState?: CurrentStateItem): OperatorInspectorTab {
  return tab("raw", "Diagnostics", [
    metric("Payload", relatedState ? "state match" : "scene only", relatedState ? "good" : "muted")
  ], [
    row("Scene", `${entity.source} / ${entity.protocol} / ${trimMiddle(entity.id, 36)}`),
    row("State", relatedState ? `${relatedState.kind} / ${trimMiddle(relatedState.state_key, 36)}` : "unavailable")
  ]);
}

function rfOperatorRows(entity: RfSceneEntity, relatedState?: CurrentStateItem): OperatorInspectorRow[] {
  if (!relatedState) {
    return [];
  }

  const metadata = relatedState.metadata;
  const raw = relatedState.raw_payload;
  const access = objectFrom(raw.access);

  if (entity.source === "unifi" && (entity.observedKind === "client" || relatedState.kind === "client")) {
    return compactRows([
      valueRow("mac_address", firstString(raw.macAddress, raw.mac_address, metadata.mac_address, relatedState.identity_hint, entity.identity)),
      valueRow("name", firstString(raw.name, metadata.name, metadata.alias, entity.label)),
      valueRow("ip_address", firstString(raw.ipAddress, raw.ip_address, metadata.ip_address, metadata.ip, metadata.primary_ip)),
      valueRow("network_name", firstString(raw.NetworkName, raw.networkName, raw.network_name, metadata.NetworkName, metadata.networkName, metadata.network_name, metadata.network)),
      valueRow("access_type", firstString(access.type, metadata.connection_type, metadata.access_type, metadata.kind)),
      valueRow("sensor_id", firstString(relatedState.sensor_id, entity.source)),
      valueRow("kind", firstString(relatedState.kind, entity.observedKind)),
      valueRow("rssi", formatRssi(firstNumber(entity.rssi, raw.rssi, access.signal, metadata.rssi))),
      valueRow("last_seen", formatTimestamp(relatedState.last_seen_at ?? entity.lastSeenAt))
    ]);
  }

  if (entity.source === "kismet") {
    const signal = objectFrom(raw["kismet.device.base.signal"]);
    return compactRows([
      valueRow("phyname", firstString(raw["kismet.device.base.phyname"], metadata.phyname, metadata["kismet.device.base.phyname"], entity.protocol)),
      valueRow("mac_address", firstString(raw["kismet.device.base.macaddr"], metadata.macaddr, metadata.mac_address, relatedState.identity_hint, entity.identity)),
      valueRow("common_name", firstString(raw["kismet.device.base.commonname"], metadata.commonname, metadata.name, entity.label)),
      valueRow("last_signal", formatRssi(firstNumber(signal["kismet.common.signal.last_signal"], raw["kismet.common.signal.last_signal"], metadata.last_signal, metadata.rssi, entity.rssi))),
      valueRow("last_seen", formatTimestamp(relatedState.last_seen_at ?? entity.lastSeenAt))
    ]);
  }

  if (entity.source === "intercept" && (entity.observedKind === "intercept_event" || relatedState.kind === "intercept_event")) {
    const payload = objectFrom(raw.payload);
    const decoded = objectFrom(payload.event);
    return compactRows([
      valueRow("event_type", firstString(metadata.event_type, raw.event_type, payload.event_type, entity.observedKind)),
      valueRow("severity", firstString(metadata.severity, raw.severity, payload.severity)),
      valueRow("message", firstString(metadata.message, raw.message, payload.message)),
      valueRow("model", firstString(decoded.model, payload.model, metadata.model)),
      valueRow("event_id", firstString(decoded.id, payload.id, raw.id, relatedState.identity_hint, entity.identity)),
      valueRow("rssi", formatRssi(firstNumber(decoded.rssi, payload.rssi, metadata.rssi, entity.rssi))),
      valueRow("frequency", formatFrequency(firstNumber(decoded.frequency, payload.frequency, metadata.frequency, metadata.frequency_mhz))),
      valueRow("last_seen", formatTimestamp(relatedState.last_seen_at ?? entity.lastSeenAt))
    ]);
  }

  if (entity.source === "intercept" && (entity.observedKind === "spectrum_peak" || relatedState.kind === "spectrum_peak")) {
    return compactRows([
      valueRow("sensor_id", firstString(relatedState.sensor_id, entity.source)),
      valueRow("protocol", firstString(entity.protocol, relatedState.protocol)),
      valueRow("identity_hint", firstString(relatedState.identity_hint, entity.identity)),
      valueRow("rssi", formatRssi(firstNumber(entity.rssi, metadata.rssi, metadata.power_dbm))),
      valueRow("known", formatBoolean(firstBoolean(metadata.known, raw.known) ?? false)),
      valueRow("last_seen", formatTimestamp(relatedState.last_seen_at ?? entity.lastSeenAt))
    ]);
  }

  return [];
}

function sourceSummary(
  source: SituationSourceId,
  states: CurrentStateItem[],
  kindCounts: Record<string, number>,
  latest: string | null
): { metrics: OperatorInspectorMetric[]; rows: OperatorInspectorRow[] } {
  if (source === "intercept") {
    const strongestPeak = strongestSpectrumPeak(states);
    return {
      metrics: [
        metric("Spectrum Peaks", countKind(kindCounts, "spectrum_peak").toLocaleString(), countKind(kindCounts, "spectrum_peak") > 0 ? "hot" : "muted"),
        metric("SDR Devices", countKind(kindCounts, "sdr_device").toLocaleString(), countKind(kindCounts, "sdr_device") > 0 ? "good" : "muted"),
        metric("Latest", latest ? formatTimestamp(latest) : "none", latest ? "good" : "muted")
      ],
      rows: compactRows([
        row("Strongest Peak", strongestPeak ? `${formatNumber(strongestPeak.frequency)} MHz / ${formatNumber(strongestPeak.power)} dBm` : "none"),
        row("Decode Status", metadataString(findKind(states, "subghz_status"), ["status", "active_profile", "scan_profile"]) ?? "listening"),
        row("Receiver", identityOrValue(findKind(states, "sdr_device")) ?? "unknown")
      ])
    };
  }
  if (source === "kismet") {
    return {
      metrics: [
        metric("Devices", countKind(kindCounts, "device").toLocaleString(), countKind(kindCounts, "device") > 0 ? "good" : "muted"),
        metric("Datasources", countKind(kindCounts, "datasource").toLocaleString(), countKind(kindCounts, "datasource") > 0 ? "good" : "muted"),
        metric("Latest", latest ? formatTimestamp(latest) : "none", latest ? "good" : "muted")
      ],
      rows: compactRows([
        row("Server", metadataString(findKind(states, "server_status"), ["server_name", "server_uuid", "version"]) ?? "unknown"),
        row("Aircraft", countKind(kindCounts, "aircraft").toLocaleString()),
        row("BLE", (countKind(kindCounts, "ble_device") + countKind(kindCounts, "bluetooth_device")).toLocaleString())
      ])
    };
  }
  if (source === "unifi") {
    return {
      metrics: [
        metric("Clients", countKind(kindCounts, "client").toLocaleString(), countKind(kindCounts, "client") > 0 ? "good" : "muted"),
        metric("Devices", countKind(kindCounts, "device").toLocaleString(), countKind(kindCounts, "device") > 0 ? "good" : "muted"),
        metric("Latest", latest ? formatTimestamp(latest) : "none", latest ? "good" : "muted")
      ],
      rows: compactRows([
        row("Network", metadataString(findKind(states, "client"), ["network", "network_name", "essid"]) ?? "unknown"),
        row("Access Point", metadataString(findKind(states, "client"), ["access_point", "ap_name"]) ?? "unknown"),
        row("Latest Client", identityOrValue(findKind(states, "client")) ?? "unknown")
      ])
    };
  }
  return {
    metrics: [
      metric("Leases", countKind(kindCounts, "dhcp_lease").toLocaleString(), countKind(kindCounts, "dhcp_lease") > 0 ? "good" : "muted"),
      metric("Hosts", countKind(kindCounts, "host").toLocaleString(), countKind(kindCounts, "host") > 0 ? "good" : "muted"),
      metric("Latest", latest ? formatTimestamp(latest) : "none", latest ? "good" : "muted")
    ],
    rows: compactRows([
      row("Router", metadataString(findKind(states, "router_status"), ["hostname", "model", "version"]) ?? "unknown"),
      row("Latest Lease", identityOrValue(findKind(states, "dhcp_lease")) ?? "unknown"),
      row("Interfaces", countKind(kindCounts, "interface").toLocaleString())
    ])
  };
}

function sourceHardware(
  source: SituationSourceId,
  states: CurrentStateItem[],
  packets: number,
  retryAttempts: number
): { metrics: OperatorInspectorMetric[]; rows: OperatorInspectorRow[] } {
  const hardwareKinds = source === "intercept" ? ["sdr_device", "subghz_status", "server_status"] : ["datasource", "device", "server_status", "router_status", "interface"];
  const hardwareItems = states.filter((item) => hardwareKinds.includes(item.kind));
  return {
    metrics: [
      metric("Packets", packets > 0 ? packets.toLocaleString() : "unknown", packets > 0 ? "good" : "muted"),
      metric("Retries", retryAttempts.toLocaleString(), retryAttempts > 0 ? "warn" : "good"),
      metric("Hardware", hardwareItems.length.toLocaleString(), hardwareItems.length > 0 ? "good" : "muted")
    ],
    rows: uniqueRowLabels(hardwareItems.slice(0, 4).map((item) => row(hardwareLabel(item.kind), identityOrValue(item) ?? "unknown")))
  };
}

function sourceEvents(alerts: InfrastructureAlert[]): { metrics: OperatorInspectorMetric[]; rows: OperatorInspectorRow[] } {
  return {
    metrics: [
      metric("Events", alerts.length.toLocaleString(), alerts.length > 0 ? "hot" : "muted")
    ],
    rows: alerts.length > 0
      ? alerts.slice(0, 4).map((alert) => row(`${alert.severity.toUpperCase()} ${cleanLabel(alert.type)}`, eventSummaryValue(alert)))
      : [row("Status", "No active source events")]
  };
}

function eventSummaryValue(alert: InfrastructureAlert): string {
  return [
    alert.summary,
    alert.details.slice(0, 4).join(" / "),
    formatTimestamp(alert.createdAt)
  ].filter(Boolean).join(" / ");
}

function sourceDiagnostics(states: CurrentStateItem[], latest: string | null): { metrics: OperatorInspectorMetric[]; rows: OperatorInspectorRow[] } {
  const kindCounts = countBy(states, (item) => item.kind);
  return {
    metrics: [
      metric("State Records", states.length.toLocaleString(), states.length > 0 ? "neutral" : "muted"),
      metric("Kinds", Object.keys(kindCounts).length.toLocaleString(), Object.keys(kindCounts).length > 0 ? "neutral" : "muted")
    ],
    rows: compactRows([
      row("Latest State", latest ? formatTimestamp(latest) : "none"),
      row("Top Kinds", Object.entries(kindCounts).slice(0, 4).map(([kind, count]) => `${kind}:${count}`).join(", ") || "none"),
      row("Sample Keys", states.slice(0, 2).map((item) => trimMiddle(item.state_key, 30)).join(", ") || "none")
    ])
  };
}

function evidenceRows(client: NetworkClient): OperatorInspectorRow[] {
  if (client.evidence.length === 0) {
    return [row("Status", "No source evidence attached")];
  }
  return compactRows(client.evidence.slice(0, 4).map((evidence) => {
    const value = [
      evidence.ip_address,
      normalizedConnectionType(evidence.connection_type) ?? defaultNetworkLabel(evidence.connection_type),
      evidence.access_point ? formatAccessPoint(evidence.access_point) : null
    ].filter(Boolean).join(" / ") || evidence.kind;
    return row(sourceLabel(evidence.source), value);
  }));
}

function valueRow(label: string, value: string | null): OperatorInspectorRow {
  return row(label, value ?? "unknown");
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value.toString();
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
  }
  return null;
}

function formatRssi(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)} dBm`;
}

function formatFrequency(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  return `${Number.isInteger(value) ? value.toString() : value.toString()} MHz`;
}

function formatBoolean(value: boolean | null): string | null {
  return value === null ? null : value ? "true" : "false";
}

function compactTags(tags: Array<OperatorInspectorTag | null>): OperatorInspectorTag[] {
  return tags.filter((tag): tag is OperatorInspectorTag => Boolean(tag));
}

function signalTone(rssi: number): OperatorInspectorTone {
  if (rssi >= -45) {
    return "hot";
  }
  if (rssi >= -65) {
    return "good";
  }
  if (rssi >= -80) {
    return "warn";
  }
  return "muted";
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function sourceLabel(value: string): string {
  const labels: Record<string, string> = {
    openwrt: "OpenWrt",
    unifi: "UniFi",
    kismet: "Kismet",
    intercept: "Intercept"
  };
  return labels[value] ?? titleCase(value);
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "unknown";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().replace(".000Z", "Z");
}

function latestSeen(states: CurrentStateItem[]): string | null {
  return states
    .map((state) => state.last_seen_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function sumMetadataNumber(states: CurrentStateItem[], key: string): number {
  return states.reduce((sum, state) => {
    const value = state.metadata[key];
    return typeof value === "number" && Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function countKind(kindCounts: Record<string, number>, kind: string): number {
  return kindCounts[kind] ?? 0;
}

function findKind(states: CurrentStateItem[], kind: string): CurrentStateItem | undefined {
  return states.find((item) => item.kind === kind);
}

function hardwareLabel(kind: string): string {
  const labels: Record<string, string> = {
    datasource: "Datasource",
    device: "Device",
    interface: "Interface",
    router_status: "Router",
    sdr_device: "SDR",
    server_status: "Server",
    subghz_status: "Sub-GHz"
  };
  return labels[kind] ?? cleanLabel(kind);
}

function identityOrValue(item: CurrentStateItem | undefined): string | null {
  if (!item) {
    return null;
  }
  return metadataString(item, ["name", "display_name", "hostname", "model", "status"]) ?? item.identity_hint ?? trimMiddle(item.state_key, 40);
}

function metadataString(item: CurrentStateItem | undefined, keys: string[]): string | null {
  if (!item) {
    return null;
  }
  for (const key of keys) {
    const value = item.metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value.toString();
    }
  }
  return null;
}

function strongestSpectrumPeak(states: CurrentStateItem[]): { frequency: number; power: number } | null {
  const peaks = states
    .filter((item) => item.kind === "spectrum_peak")
    .map((item) => {
      const frequency = item.metadata.frequency_mhz;
      const power = item.metadata.power_dbm;
      return typeof frequency === "number" && typeof power === "number" ? { frequency, power } : null;
    })
    .filter((peak): peak is { frequency: number; power: number } => Boolean(peak))
    .sort((left, right) => right.power - left.power);
  return peaks[0] ?? null;
}

function compactRows(rows: OperatorInspectorRow[]): OperatorInspectorRow[] {
  const seen = new Set<string>();
  return rows.filter((item) => {
    const key = `${item.label}:${item.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueRowLabels(rows: OperatorInspectorRow[]): OperatorInspectorRow[] {
  const counts = new Map<string, number>();
  return rows.map((item) => {
    const count = (counts.get(item.label) ?? 0) + 1;
    counts.set(item.label, count);
    return count === 1 ? item : { ...item, label: `${item.label} ${count}` };
  });
}

function conciseValue(value: string): string {
  return trimMiddle(value.replace(/\s+/g, " ").trim(), 84);
}

function cleanLabel(value: string): string {
  const labels: Record<string, string> = {
    rssi: "RSSI",
    RSSI: "RSSI"
  };
  if (labels[value]) {
    return labels[value];
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function trimMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = Math.ceil((maxLength - 3) / 2);
  const tail = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function normalizedConnectionType(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.toLowerCase() === "default" ? null : value;
}

function defaultNetworkLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.toLowerCase() === "default" ? "default network" : null;
}

function formatAccessPoint(value: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return `AP ${trimMiddle(value.toLowerCase(), 16)}`;
  }
  return conciseValue(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

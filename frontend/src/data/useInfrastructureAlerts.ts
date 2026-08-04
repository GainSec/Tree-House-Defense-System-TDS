import { useEffect, useRef, useState } from "react";
import type { TdsEvent } from "../domain/types";
import { fetchEvents, fetchOpenWrtAlarmEvents, fetchUnifiAlarmEvents } from "./api";

export type InfrastructureAlertStatus = "loading" | "live" | "empty" | "error";
export type InfrastructureAlertSource = "unifi" | "openwrt";

export interface InfrastructureAlert {
  id: string;
  source: InfrastructureAlertSource;
  type: string;
  severity: string;
  summary: string;
  zoneId: string | null;
  createdAt: string | null;
  details: string[];
}

export interface InfrastructureAlertsState {
  status: InfrastructureAlertStatus;
  alerts: InfrastructureAlert[];
  totalCount: number;
  lastUpdatedAt: string | null;
  error: string | null;
}

export interface InfrastructureAlertsOptions {
  pollIntervalMs?: number;
  maxVisibleAlerts?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_VISIBLE_ALERTS = 5;

export function useInfrastructureAlerts({
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxVisibleAlerts = DEFAULT_MAX_VISIBLE_ALERTS
}: InfrastructureAlertsOptions = {}): InfrastructureAlertsState {
  const previousAlerts = useRef<InfrastructureAlert[]>([]);
  const previousTotalCount = useRef(0);
  const [state, setState] = useState<InfrastructureAlertsState>({
    status: "loading",
    alerts: [],
    totalCount: 0,
    lastUpdatedAt: null,
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    async function refresh() {
      try {
        const [eventsResponse, unifiAlarmResponse, openWrtAlarmResponse] = await Promise.all([fetchEvents(500), fetchUnifiAlarmEvents(), fetchOpenWrtAlarmEvents()]);
        if (cancelled) {
          return;
        }
        const infrastructureAlerts = mergeEventsById([...eventsResponse.items, ...unifiAlarmResponse.items, ...openWrtAlarmResponse.items])
          .map(eventToInfrastructureAlert)
          .filter((alert): alert is InfrastructureAlert => alert !== null)
          .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
        const visibleAlerts = infrastructureAlerts.slice(0, maxVisibleAlerts);

        previousAlerts.current = visibleAlerts;
        previousTotalCount.current = infrastructureAlerts.length;
        setState({
          status: visibleAlerts.length > 0 ? "live" : "empty",
          alerts: visibleAlerts,
          totalCount: infrastructureAlerts.length,
          lastUpdatedAt: new Date().toISOString(),
          error: null
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          alerts: previousAlerts.current,
          totalCount: previousTotalCount.current,
          lastUpdatedAt: null,
          error: error instanceof Error ? error.message : "Infrastructure alert refresh failed"
        });
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(refresh, pollIntervalMs);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [maxVisibleAlerts, pollIntervalMs]);

  return state;
}

export function eventToInfrastructureAlert(event: TdsEvent): InfrastructureAlert | null {
  const source = eventSource(event);
  if (!source) {
    return null;
  }

  return {
    id: event.id,
    source,
    type: event.type,
    severity: event.severity,
    summary: event.summary,
    zoneId: event.zone_id,
    createdAt: event.created_at,
    details: alertDetails(event)
  };
}

function eventSource(event: TdsEvent): InfrastructureAlertSource | null {
  if (event.type === "unifi_alarm") {
    return "unifi";
  }
  if (event.type === "openwrt_alarm") {
    return "openwrt";
  }
  const source = stringField(event.payload, "source");
  if (source === "unifi" || source === "openwrt") {
    return source;
  }
  return null;
}

function alertDetails(event: TdsEvent): string[] {
  const normalized = objectField(event.payload, "normalized");
  const fields = [
    event.severity,
    stringField(normalized, "event_name") ?? stringField(normalized, "name") ?? stringField(event.payload, "name"),
    event.summary,
    stringField(normalized, "client_alias") ?? stringField(normalized, "client_hostname"),
    stringField(normalized, "client_mac") ?? stringField(normalized, "unifi_client_mac") ?? stringField(event.payload, "unificlientmac"),
    stringField(normalized, "client_ip"),
    stringField(normalized, "ap_name"),
    rssiLabel(numberField(normalized, "rssi")),
    stringField(normalized, "wifi_name") ?? stringField(normalized, "wifi") ?? stringField(event.payload, "uniwifiname"),
    stringField(normalized, "network_name"),
    stringField(event.payload, "protocol"),
    stringField(event.payload, "identity_hint"),
    rssiLabel(numberField(event.payload, "rssi")),
    event.zone_id
  ];

  return uniqueCompact(fields).slice(0, 8);
}

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key];
  return field && typeof field === "object" && !Array.isArray(field) ? (field as Record<string, unknown>) : {};
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function rssiLabel(value: number | null): string | null {
  return value === null ? null : `${value} dBm`;
}

function uniqueCompact(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function timestamp(value: string | null): number {
  return value ? new Date(value).getTime() || 0 : 0;
}

function mergeEventsById(events: TdsEvent[]): TdsEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

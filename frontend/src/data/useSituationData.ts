import { useEffect, useRef, useState } from "react";
import {
  fetchCollectors,
  fetchCurrentState,
  fetchDashboardSummary,
  fetchIntegrations,
  fetchNetworkClients,
  fetchRules,
  fetchSensors,
  fetchZones
} from "./api";
import { buildSituationModel, type SituationModel, type SituationSourceId } from "./situationModel";
import type { CurrentStateItem, NetworkClient } from "../domain/types";
import type { InfrastructureAlert } from "./useInfrastructureAlerts";

export type SituationDataStatus = "loading" | "live" | "error";

export interface SituationDataState {
  status: SituationDataStatus;
  model: SituationModel | null;
  clients: NetworkClient[];
  sourceStates: Partial<Record<SituationSourceId, CurrentStateItem[]>>;
  lastUpdatedAt: string | null;
  error: string | null;
}

export interface SituationDataOptions {
  pollIntervalMs?: number;
  alerts?: InfrastructureAlert[];
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_ALERTS: InfrastructureAlert[] = [];
const SOURCE_LIMITS: Record<SituationSourceId, number> = {
  openwrt: 180,
  unifi: 180,
  kismet: 220,
  intercept: 120
};

export function useSituationData(options: SituationDataOptions = {}): SituationDataState {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const alerts = options.alerts ?? DEFAULT_ALERTS;
  const previousModel = useRef<SituationModel | null>(null);
  const previousClients = useRef<NetworkClient[]>([]);
  const previousSourceStates = useRef<Partial<Record<SituationSourceId, CurrentStateItem[]>>>({});
  const [state, setState] = useState<SituationDataState>({
    status: "loading",
    model: null,
    clients: [],
    sourceStates: {},
    lastUpdatedAt: null,
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    async function refresh() {
      try {
        const [summary, openwrt, unifi, kismet, intercept, clients, zones, sensors, collectors, integrations, rules] = await Promise.all([
          fetchDashboardSummary(),
          fetchCurrentState("openwrt", SOURCE_LIMITS.openwrt),
          fetchCurrentState("unifi", SOURCE_LIMITS.unifi),
          fetchCurrentState("kismet", SOURCE_LIMITS.kismet),
          fetchCurrentState("intercept", SOURCE_LIMITS.intercept),
          fetchNetworkClients(),
          fetchZones(),
          fetchSensors(),
          fetchCollectors(),
          fetchIntegrations(),
          fetchRules()
        ]);
        if (cancelled) {
          return;
        }

        const sourceStates = {
          openwrt: openwrt.items,
          unifi: unifi.items,
          kismet: kismet.items,
          intercept: intercept.items
        };
        const model = buildSituationModel({
          summary,
          sourceStates,
          clients: clients.items,
          alerts,
          inventoryCounts: {
            zones: zones.count,
            sensors: sensors.count,
            collectors: collectors.count,
            integrations: integrations.count,
            rules: rules.count
          }
        });
        previousModel.current = model;
        previousClients.current = clients.items;
        previousSourceStates.current = sourceStates;
        setState({
          status: "live",
          model,
          clients: clients.items,
          sourceStates,
          lastUpdatedAt: new Date().toISOString(),
          error: null
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          model: previousModel.current,
          clients: previousClients.current,
          sourceStates: previousSourceStates.current,
          lastUpdatedAt: null,
          error: error instanceof Error ? error.message : "Situation refresh failed"
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
  }, [alerts, pollIntervalMs]);

  return state;
}

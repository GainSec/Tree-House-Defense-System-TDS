import { buildSceneModel } from "./sceneModel";
import type { AircraftMapFeature, RfMapFeature } from "../domain/types";

/** Built-in demo entities shown when no backend data exists. Never present these as observations. */
const demoRfFeatures: RfMapFeature[] = [
  rf("wifi-living", "Living Room Wi-Fi", "wifi", 0, 0, -42, "real"),
  rf("ble-stair", "BLE stair beacon", "ble", 0, 0, -58, "estimated"),
  rf("unknown-front", "Unknown RF front approach", "unknown_rf", 0, 0, -63, "estimated"),
  rf("infrastructure-core", "Receiver core", "infrastructure", 0, 0, null, "receiver"),
  rf("utility-rear", "Utility candidate rear", "utility", 0, 0, -67, "estimated")
];

const demoAircraft: AircraftMapFeature[] = [
  {
    identity: "A1B2C3",
    callsign: "N123AB",
    model: "C172",
    owner: "Private",
    icao_type: "C172",
    registration: "N123AB",
    country: "United States",
    squawk: "",
    latitude: 39.109,
    longitude: -77.181,
    altitude: 7500,
    speed: 215,
    heading: 92,
    source: "kismet",
    protocol: "adsb",
    first_seen_at: null,
    last_seen_at: null,
    count: 24
  },
  {
    identity: "D4E5F6",
    callsign: "UAL421",
    model: "A320",
    owner: "United",
    icao_type: "A320",
    registration: "",
    country: "",
    squawk: "",
    latitude: 39.096,
    longitude: -77.158,
    altitude: 12500,
    speed: 310,
    heading: 238,
    source: "kismet",
    protocol: "adsb",
    first_seen_at: null,
    last_seen_at: null,
    count: 9
  }
];

const demoScene = buildSceneModel({
  rf: demoRfFeatures,
  aircraft: demoAircraft,
  maxRfEntities: 20,
  maxAircraftEntities: 10
});

export { demoScene };

function rf(
  identity: string,
  label: string,
  category: RfMapFeature["category"],
  latitude: number,
  longitude: number,
  rssi: number | null,
  accuracy: RfMapFeature["location_accuracy"]
): RfMapFeature {
  return {
    identity,
    label,
    protocol: category === "unknown_rf" ? "subghz" : category,
    kind: category === "unknown_rf" ? "spectrum_peak" : "device",
    source: category === "infrastructure" ? "intercept" : "kismet",
    category,
    latitude,
    longitude,
    location_accuracy: accuracy,
    estimated: accuracy === "estimated",
    rssi,
    channel: category === "wifi" ? "6" : null,
    frequency: category === "utility" ? "433.92" : null,
    manufacturer: null,
    first_seen_at: null,
    last_seen_at: null,
    count: category === "unknown_rf" ? 5 : 1,
    freshness: "live"
  };
}

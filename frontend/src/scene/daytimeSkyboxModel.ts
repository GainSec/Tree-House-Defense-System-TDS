export const DAYTIME_SKYBOX = {
  radius: 320,
  topColor: "#020617",
  upperColor: "#071426",
  horizonColor: "#102a44",
  groundHazeColor: "#16324a",
  sunColor: "#dbeafe"
};

export function daytimeSkyColorStops(): string[] {
  return [DAYTIME_SKYBOX.topColor, DAYTIME_SKYBOX.upperColor, DAYTIME_SKYBOX.horizonColor, DAYTIME_SKYBOX.groundHazeColor];
}

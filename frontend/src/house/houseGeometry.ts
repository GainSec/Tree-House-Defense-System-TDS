export type Vec3 = [number, number, number];

export interface HouseZone {
  id: string;
  label: string;
  levelIndex: number;
  center: Vec3;
  size: [number, number];
}

export interface HouseZoneVolume {
  id: string;
  center: Vec3;
  size: Vec3;
}

export interface HouseZoneTone {
  color: string;
  opacity: number;
}

export interface HouseLevel {
  index: number;
  name: string;
  y: number;
  zones: HouseZone[];
}

export interface HouseEdge {
  id: string;
  from: Vec3;
  to: Vec3;
  role: "exterior-horizontal" | "exterior-vertical" | "interior" | "facade" | "balcony";
}

export interface TownhouseGeometry {
  levels: HouseLevel[];
  zones: HouseZone[];
  edges: HouseEdge[];
}

export const HOUSE_DIMENSIONS = {
  width: 18,
  depth: 45,
  levelHeight: 3.2,
  levels: 3
} as const;

export const HOUSE_ZONE_VOLUME_HEIGHT = 2.15;

const halfWidth = HOUSE_DIMENSIONS.width / 2;
const halfDepth = HOUSE_DIMENSIONS.depth / 2;
const totalHeight = HOUSE_DIMENSIONS.levelHeight * HOUSE_DIMENSIONS.levels;

const mainZones: HouseZone[] = [
  {
    id: "living-room",
    label: "Living Room",
    levelIndex: 1,
    center: [0, HOUSE_DIMENSIONS.levelHeight + 0.04, -9.5],
    size: [16.8, 16.5]
  },
  {
    id: "dining-kitchen",
    label: "Dining / Kitchen",
    levelIndex: 1,
    center: [1.2, HOUSE_DIMENSIONS.levelHeight + 0.05, 9],
    size: [14.4, 18]
  },
  {
    id: "bath",
    label: "Bath",
    levelIndex: 1,
    center: [-5.8, HOUSE_DIMENSIONS.levelHeight + 0.06, 17.2],
    size: [4.4, 4.6]
  },
  {
    id: "stair",
    label: "Stair",
    levelIndex: 1,
    center: [-5.5, HOUSE_DIMENSIONS.levelHeight + 0.07, 3.2],
    size: [4.6, 12.5]
  },
  {
    id: "balcony",
    label: "Balcony",
    levelIndex: 1,
    center: [0, HOUSE_DIMENSIONS.levelHeight + 0.08, 26.2],
    size: [16, 6.4]
  }
];

export const townhouseGeometry: TownhouseGeometry = {
  levels: [
    inferredLevel(0, "Lower Level"),
    {
      index: 1,
      name: "Main SIGINT Level",
      y: HOUSE_DIMENSIONS.levelHeight,
      zones: mainZones
    },
    inferredLevel(2, "Upper Level")
  ],
  zones: mainZones,
  edges: [
    ...levelRectEdges(0),
    ...levelRectEdges(HOUSE_DIMENSIONS.levelHeight),
    ...levelRectEdges(HOUSE_DIMENSIONS.levelHeight * 2),
    ...levelRectEdges(totalHeight),
    ...verticalShellEdges(),
    ...interiorEdges(),
    ...facadeEdges(),
    ...balconyEdges()
  ]
};

export function houseZoneVolume(zone: HouseZone): HouseZoneVolume {
  return {
    id: `${zone.id}-volume`,
    center: [zone.center[0], zone.center[1] + HOUSE_ZONE_VOLUME_HEIGHT / 2, zone.center[2]],
    size: [zone.size[0], HOUSE_ZONE_VOLUME_HEIGHT, zone.size[1]]
  };
}

export function houseZoneTone(zoneId: string): HouseZoneTone {
  switch (zoneId) {
    case "living-room":
      return { color: "#1dd3c7", opacity: 0.1 };
    case "dining-kitchen":
      return { color: "#7df2e6", opacity: 0.085 };
    case "bath":
      return { color: "#ffd166", opacity: 0.075 };
    case "stair":
      return { color: "#8dff9b", opacity: 0.08 };
    case "balcony":
      return { color: "#9bdcff", opacity: 0.04 };
    default:
      return { color: "#7df2e6", opacity: 0.06 };
  }
}

function inferredLevel(index: number, name: string): HouseLevel {
  const y = index * HOUSE_DIMENSIONS.levelHeight;
  return {
    index,
    name,
    y,
    zones: [
      {
        id: `${name.toLowerCase().replaceAll(" ", "-")}-volume`,
        label: name,
        levelIndex: index,
        center: [0, y + 0.05, 0],
        size: [HOUSE_DIMENSIONS.width - 1.2, HOUSE_DIMENSIONS.depth - 1.2]
      }
    ]
  };
}

function levelRectEdges(y: number): HouseEdge[] {
  const points: Vec3[] = [
    [-halfWidth, y, -halfDepth],
    [halfWidth, y, -halfDepth],
    [halfWidth, y, halfDepth],
    [-halfWidth, y, halfDepth]
  ];
  return [
    edge(`level-${y}-front`, points[0], points[1], "exterior-horizontal"),
    edge(`level-${y}-right`, points[1], points[2], "exterior-horizontal"),
    edge(`level-${y}-rear`, points[2], points[3], "exterior-horizontal"),
    edge(`level-${y}-left`, points[3], points[0], "exterior-horizontal")
  ];
}

function verticalShellEdges(): HouseEdge[] {
  const corners: Vec3[] = [
    [-halfWidth, 0, -halfDepth],
    [halfWidth, 0, -halfDepth],
    [halfWidth, 0, halfDepth],
    [-halfWidth, 0, halfDepth]
  ];
  return [0, 1].flatMap((offset) =>
    corners.map((corner, index) =>
      edge(
        `vertical-${offset}-${index}`,
        [corner[0] - offset * 0.001, 0, corner[2] - offset * 0.001],
        [corner[0] - offset * 0.001, totalHeight, corner[2] - offset * 0.001],
        "exterior-vertical"
      )
    )
  );
}

function interiorEdges(): HouseEdge[] {
  const y = HOUSE_DIMENSIONS.levelHeight + 0.08;
  return [
    edge("main-room-split", [-halfWidth, y, -1.2], [halfWidth, y, -1.2], "interior"),
    edge("kitchen-bath-split", [-2.7, y, 11.8], [-2.7, y, halfDepth], "interior"),
    edge("stair-wall-right", [-3.1, y, -3.4], [-3.1, y, 9.8], "interior"),
    edge("stair-wall-front", [-halfWidth, y, -3.4], [-3.1, y, -3.4], "interior"),
    edge("bath-wall-front", [-halfWidth, y, 14.9], [-2.7, y, 14.9], "interior")
  ];
}

function facadeEdges(): HouseEdge[] {
  const frontZ = -halfDepth - 0.02;
  return [
    edge("front-door-left", [-2, 0, frontZ], [-2, 2.2, frontZ], "facade"),
    edge("front-door-right", [2, 0, frontZ], [2, 2.2, frontZ], "facade"),
    edge("front-door-top", [-2, 2.2, frontZ], [2, 2.2, frontZ], "facade"),
    edge("front-window-lower-left", [-7, 0.8, frontZ], [-3.8, 0.8, frontZ], "facade"),
    edge("front-window-lower-right", [3.8, 0.8, frontZ], [7, 0.8, frontZ], "facade"),
    edge("front-window-mid", [-7, 4.5, frontZ], [7, 4.5, frontZ], "facade"),
    edge("front-window-upper", [-7, 7.7, frontZ], [7, 7.7, frontZ], "facade")
  ];
}

function balconyEdges(): HouseEdge[] {
  const y = HOUSE_DIMENSIONS.levelHeight + 0.14;
  const front = halfDepth;
  const rear = halfDepth + 6.4;
  return [
    edge("balcony-left", [-8, y, front], [-8, y, rear], "balcony"),
    edge("balcony-right", [8, y, front], [8, y, rear], "balcony"),
    edge("balcony-rear", [-8, y, rear], [8, y, rear], "balcony"),
    edge("balcony-rail-left", [-8, y + 1, rear], [8, y + 1, rear], "balcony")
  ];
}

function edge(id: string, from: Vec3, to: Vec3, role: HouseEdge["role"]): HouseEdge {
  return { id, from, to, role };
}

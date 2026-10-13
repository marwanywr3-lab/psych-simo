export const scenes = {
  attendance: { src: "assets/scenes/attendance.png", width: 1280, height: 720 },
  corridor: { src: "assets/scenes/corridor.png", width: 1280, height: 720 },
  clinic: { src: "assets/scenes/clinic.png", width: 1280, height: 720 },
} as const;
// All rectangles are normalized to the original 1280 × 720 image, not the viewport.
export const hotspots = {
  device: { left: 45.7, top: 17.2, width: 23.2, height: 39.5 },
  screen: { left: 48.3, top: 24.5, width: 11.7, height: 13.5 },
  entrance: { left: 0, top: 4, width: 16.8, height: 88 },
  clinicDoor: { left: 88.5, top: 1, width: 11.5, height: 87 },
  clinicSign: { left: 91.5, top: 23, width: 6.8, height: 6 },
  chair: { left: 34.5, top: 40, width: 31, height: 31 },
};
export const rect = (r: {
  left: number;
  top: number;
  width: number;
  height: number;
}) => ({
  left: r.left + "%",
  top: r.top + "%",
  width: r.width + "%",
  height: r.height + "%",
});

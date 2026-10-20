import { describe, expect, it } from "vitest";
import { ThreeLod } from "./ThreeLod";

describe("adapted Three.js LOD selection", () => {
  it("orders distances and preserves boundary hysteresis", () => {
    const lod = new ThreeLod();
    lod.addLevel({ visible: false }, 20, .1).addLevel({ visible: false }, 0).addLevel({ visible: false }, -10, .1);
    expect(lod.levels.map(level => level.distance)).toEqual([0, 10, 20]);
    for (const [distance, expected] of [[9, 0], [10, 1], [9.5, 1], [8.9, 0], [25, 2], [19, 2], [17.9, 1], [0, 0]]) {
      lod.update(distance!);
      expect(lod.getCurrentLevel()).toBe(expected);
      expect(lod.levels.map(level => level.object.visible)).toEqual([0, 1, 2].map(level => level === expected));
    }
  });
  it("keeps independent camera histories", () => {
    const first = new ThreeLod(), second = new ThreeLod();
    for (const lod of [first, second]) for (const distance of [0, 10, 20]) lod.addLevel({ visible: false }, distance, .1);
    first.update(25); second.update(5);
    expect(first.getCurrentLevel()).toBe(2); expect(second.getCurrentLevel()).toBe(0);
    first.update(19); second.update(9.5);
    expect(first.getCurrentLevel()).toBe(2); expect(second.getCurrentLevel()).toBe(0);
  });
});

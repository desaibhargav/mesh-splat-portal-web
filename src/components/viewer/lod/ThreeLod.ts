// Adapted from three.js r180, src/objects/LOD.js (addLevel/update).
// https://github.com/mrdoob/three.js/blob/r180/src/objects/LOD.js
// Copyright 2010-2025 three.js authors. MIT; see public/licenses/threejs.txt.
// Local changes: TypeScript; omit Object3D ownership/serialization/raycasting;
// accept a precomputed distance so PlayCanvas perspective/orthographic/XR cameras
// can supply their metric. Keep sorting, visibility and hysteresis logic intact.
export class ThreeLod {
  readonly levels: { object: { visible: boolean }; distance: number; hysteresis: number }[] = [];
  private _currentLevel = 0;

  addLevel(object: { visible: boolean }, distance = 0, hysteresis = 0) {
    distance = Math.abs(distance);
    const levels = this.levels;
    let l;
    for (l = 0; l < levels.length; l++) {
      if (distance < levels[l]!.distance) break;
    }
    levels.splice(l, 0, { distance, hysteresis, object });
    return this;
  }

  getCurrentLevel() { return this._currentLevel; }

  update(distance: number) {
    const levels = this.levels;
    if (levels.length > 1) {
      levels[0]!.object.visible = true;
      let i, l;
      for (i = 1, l = levels.length; i < l; i++) {
        let levelDistance = levels[i]!.distance;
        if (levels[i]!.object.visible) {
          levelDistance -= levelDistance * levels[i]!.hysteresis;
        }
        if (distance >= levelDistance) {
          levels[i - 1]!.object.visible = false;
          levels[i]!.object.visible = true;
        } else break;
      }
      this._currentLevel = i - 1;
      for (; i < l; i++) levels[i]!.object.visible = false;
    }
  }
}

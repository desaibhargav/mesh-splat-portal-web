# Mesh environment lighting

`studio-small-08.png` is a prefiltered 512 × 512 RGBP environment atlas derived from [Studio Small 08](https://polyhaven.com/a/studio_small_08) by Sergej Majboroda, published by Poly Haven under [CC0](https://polyhaven.com/license).

Source: [1K Radiance HDR](https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_08_1k.hdr).
Source SHA-256: `f6a989f89432eb4eee3191364a9c1ceed195c4ec3544173a3c04fd96cb91d0ba`.

The atlas was generated with the installed PlayCanvas 2.21.4 engine using its default prefilter settings:

```js
const source = EnvLighting.generateLightingSource(hdrTexture);
const atlas = EnvLighting.generateAtlas(source);
const rgba = await atlas.read(0, 0, atlas.width, atlas.height);
```

The RGBA bytes were saved losslessly as PNG, retaining their row order and RGBP alpha channel. A reload through PlayCanvas with `type: TEXTURETYPE_RGBP` and `mipmaps: false` was verified to reproduce the atlas bytes exactly. The HDR source and browser preparation scripts are not needed at runtime.

The mesh viewer uses the atlas through `useEnvAtlas` and `Environment`, with the skybox hidden. There are no extra directional lights or per-asset exposure adjustments. This provides a consistent, soft studio presentation; it does not calibrate colors or remove lighting baked into scan textures. Splat rendering and existing thumbnails are unchanged.

# Native Algorithm Tests

Run the current native checks from `quiqvu-extensions/reassign`:

```sh
yarn test:region-grow
```

Or directly from the repository root:

```sh
cmake -S quiqvu-extensions/reassign/native/region-grow -B quiqvu-extensions/reassign/native/region-grow/build
cmake --build quiqvu-extensions/reassign/native/region-grow/build --config Release
ctest --test-dir quiqvu-extensions/reassign/native/region-grow/build --output-on-failure -C Release
```

## Current Coverage

- Positive-only traces write only a small circular seed disk.
- Positive and negative seeds split a 1D slice through BFS Voronoi classification.
- Voxels belonging to unrelated segments are protected.
- A 512x512 performance smoke test classifies a full slice and prints elapsed time.

## Next Validity Tests

- Intensity gate: verify candidates outside a sampled intensity suitability range are rejected or strongly deprioritized.
- Edge stop: create a synthetic image with a sharp intensity step and verify growth stops near the step.
- Compactness: with equal suitability everywhere, verify nearer candidates win over distant ones.
- Roominess: compare a broad synthetic chamber with a one-voxel corridor and verify the corridor is penalized.
- 2D/3D parity: on a single-slice volume, verify 2D and 3D modes produce the same result when Z-neighbors are unavailable.
- Locked/protected labels: verify locked labels and unrelated segment labels are never overwritten.

## Next Performance Tests

- 512x512 2D slice with sparse seeds.
- 1024x1024 2D slice with sparse seeds.
- 256x256x128 3D ROI with a compact seed region.
- Worst-case uniform suitability where the frontier expands through the whole ROI.
- Roominess cache stress: repeated queries in the same ROI should be materially faster after cache warmup.
- Edge-map cache stress: repeated growth over the same image should avoid recomputing edge maps.

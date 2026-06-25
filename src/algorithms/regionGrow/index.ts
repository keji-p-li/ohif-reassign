import createRegionGrowModule from './generated/regionGrowWasm.js';

export type GridPoint = [number, number];

export type ReassignSliceRegionGrowInput = {
  scalarData: ArrayLike<number> & { [index: number]: number };
  intensityData?: ArrayLike<number> & { [index: number]: number };
  intensityDimensions?: number[];
  dimensions: number[];
  sliceAxis: number;
  sliceIndex: number;
  posSeedsGrid: GridPoint[];
  negSeedsGrid: GridPoint[];
  segmentIndex: number;
  seedRadius?: number;
};

export type ReassignSliceRegionGrowResult = {
  changedVoxels: number;
  classifiedVoxels: number;
  width: number;
  height: number;
};

let modulePromise: Promise<any> | null = null;

function getRegionGrowModule() {
  modulePromise ??= createRegionGrowModule();
  return modulePromise;
}

/**
 * Runs the native 2D reassign growth kernel on one extracted labelmap slice.
 * The adapter owns all memory copies between OHIF's 3D scalar arrays and WASM's flat 2D buffers.
 */
export async function runReassignSliceRegionGrow2D({
  scalarData,
  intensityData,
  intensityDimensions,
  dimensions,
  sliceAxis,
  sliceIndex,
  posSeedsGrid,
  negSeedsGrid,
  segmentIndex,
  seedRadius = 2,
}: ReassignSliceRegionGrowInput): Promise<ReassignSliceRegionGrowResult> {
  const module = await getRegionGrowModule();
  const [xDim, yDim] = dimensions;
  const [intensityXDim, intensityYDim] = intensityDimensions ?? dimensions;
  const { width, height } = getSliceDimensions(dimensions, sliceAxis);
  const voxelCount = width * height;

  const labelBytes = voxelCount * Uint16Array.BYTES_PER_ELEMENT;
  const intensityBytes = intensityData ? voxelCount * Float32Array.BYTES_PER_ELEMENT : 0;
  const posBytes = posSeedsGrid.length * 2 * Int32Array.BYTES_PER_ELEMENT;
  const negBytes = negSeedsGrid.length * 2 * Int32Array.BYTES_PER_ELEMENT;
  const outBytes = 2 * Int32Array.BYTES_PER_ELEMENT;

  const labelPtr = module._malloc(labelBytes);
  const intensityPtr = intensityBytes ? module._malloc(intensityBytes) : 0;
  const posPtr = posBytes ? module._malloc(posBytes) : 0;
  const negPtr = negBytes ? module._malloc(negBytes) : 0;
  const outPtr = module._malloc(outBytes);

  try {
    const labels = new Uint16Array(voxelCount);
    let idx2d = 0;
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        const ijk = uvToIjk(u, v, sliceAxis, sliceIndex);
        const scalarIdx = ijk[0] + ijk[1] * xDim + ijk[2] * xDim * yDim;
        labels[idx2d++] = scalarData[scalarIdx];
      }
    }

    module.HEAPU16.set(labels, labelPtr / Uint16Array.BYTES_PER_ELEMENT);

    if (intensityData && intensityPtr) {
      const intensities = new Float32Array(voxelCount);
      const sourceDimensions = intensityDimensions ?? dimensions;
      idx2d = 0;
      for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
          const ijk = uvToIjk(u, v, sliceAxis, sliceIndex);
          const clampedIjk = clampIjk(ijk, sourceDimensions);
          const scalarIdx =
            clampedIjk[0] + clampedIjk[1] * intensityXDim + clampedIjk[2] * intensityXDim * intensityYDim;
          intensities[idx2d++] = intensityData[scalarIdx];
        }
      }
      module.HEAPF32.set(intensities, intensityPtr / Float32Array.BYTES_PER_ELEMENT);
    }

    if (posBytes) {
      module.HEAP32.set(flattenSeeds(posSeedsGrid), posPtr / Int32Array.BYTES_PER_ELEMENT);
    }
    if (negBytes) {
      module.HEAP32.set(flattenSeeds(negSeedsGrid), negPtr / Int32Array.BYTES_PER_ELEMENT);
    }

    const ok = module._rg_run_reassign_slice_region_grow_2d(
      labelPtr,
      intensityPtr,
      width,
      height,
      segmentIndex,
      seedRadius,
      posPtr,
      posSeedsGrid.length,
      negPtr,
      negSeedsGrid.length,
      outPtr,
      outPtr + Int32Array.BYTES_PER_ELEMENT
    );

    if (!ok) {
      return { changedVoxels: 0, classifiedVoxels: 0, width, height };
    }

    const outputLabels = module.HEAPU16.subarray(
      labelPtr / Uint16Array.BYTES_PER_ELEMENT,
      labelPtr / Uint16Array.BYTES_PER_ELEMENT + voxelCount
    );

    idx2d = 0;
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        const ijk = uvToIjk(u, v, sliceAxis, sliceIndex);
        const scalarIdx = ijk[0] + ijk[1] * xDim + ijk[2] * xDim * yDim;
        scalarData[scalarIdx] = outputLabels[idx2d++];
      }
    }

    const outIndex = outPtr / Int32Array.BYTES_PER_ELEMENT;
    return {
      changedVoxels: module.HEAP32[outIndex],
      classifiedVoxels: module.HEAP32[outIndex + 1],
      width,
      height,
    };
  } finally {
    module._free(labelPtr);
    if (intensityPtr) {
      module._free(intensityPtr);
    }
    if (posPtr) {
      module._free(posPtr);
    }
    if (negPtr) {
      module._free(negPtr);
    }
    module._free(outPtr);
  }
}

function flattenSeeds(seeds: GridPoint[]) {
  const flattened = new Int32Array(seeds.length * 2);
  seeds.forEach(([u, v], index) => {
    flattened[index * 2] = u;
    flattened[index * 2 + 1] = v;
  });
  return flattened;
}

function getSliceDimensions(dimensions: number[], sliceAxis: number) {
  if (sliceAxis === 0) {
    return { width: dimensions[1], height: dimensions[2] };
  }
  if (sliceAxis === 1) {
    return { width: dimensions[0], height: dimensions[2] };
  }
  return { width: dimensions[0], height: dimensions[1] };
}

function uvToIjk(u: number, v: number, sliceAxis: number, sliceIndex: number): [number, number, number] {
  if (sliceAxis === 0) {
    return [sliceIndex, u, v];
  }
  if (sliceAxis === 1) {
    return [u, sliceIndex, v];
  }
  return [u, v, sliceIndex];
}

function clampIjk(ijk: [number, number, number], dimensions: number[]): [number, number, number] {
  return [
    Math.max(0, Math.min(dimensions[0] - 1, ijk[0])),
    Math.max(0, Math.min(dimensions[1] - 1, ijk[1])),
    Math.max(0, Math.min(dimensions[2] - 1, ijk[2])),
  ];
}

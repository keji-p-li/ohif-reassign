#include "region_grow/region_grow.h"

#include <cstdint>
#include <vector>

using quiqvu::region_grow::GridPoint;
using quiqvu::region_grow::ReassignSliceRegionGrowInput;
using quiqvu::region_grow::runReassignSliceRegionGrow2D;

extern "C" {

int rg_run_reassign_slice_region_grow_2d(
  std::uint16_t* labels,
  const float* intensities,
  int width,
  int height,
  std::uint16_t segmentIndex,
  int seedRadius,
  const int* positiveSeeds,
  int positiveSeedCount,
  const int* negativeSeeds,
  int negativeSeedCount,
  int* outChangedVoxels,
  int* outClassifiedVoxels)
{
  if (!labels || width <= 0 || height <= 0) {
    return 0;
  }

  std::vector<std::uint16_t> labelVector(labels, labels + width * height);

  ReassignSliceRegionGrowInput input;
  input.width = width;
  input.height = height;
  input.segmentIndex = segmentIndex;
  input.seedRadius = seedRadius;
  input.intensities = intensities;
  input.intensityCount = intensities ? width * height : 0;

  input.positiveSeeds.reserve(positiveSeedCount);
  for (int i = 0; i < positiveSeedCount; ++i) {
    input.positiveSeeds.push_back(GridPoint{positiveSeeds[i * 2], positiveSeeds[i * 2 + 1]});
  }

  input.negativeSeeds.reserve(negativeSeedCount);
  for (int i = 0; i < negativeSeedCount; ++i) {
    input.negativeSeeds.push_back(GridPoint{negativeSeeds[i * 2], negativeSeeds[i * 2 + 1]});
  }

  const auto result = runReassignSliceRegionGrow2D(labelVector, input);

  for (int i = 0; i < width * height; ++i) {
    labels[i] = labelVector[i];
  }

  if (outChangedVoxels) {
    *outChangedVoxels = result.changedVoxels;
  }
  if (outClassifiedVoxels) {
    *outClassifiedVoxels = result.classifiedVoxels;
  }

  return 1;
}

} // extern "C"

#pragma once

#include <cstdint>
#include <vector>

namespace quiqvu::region_grow {

struct GridPoint {
  int u = 0;
  int v = 0;
};

/// Parameters for a single-slice reassign growth pass.
struct ReassignSliceRegionGrowInput {
  int width = 0;
  int height = 0;
  std::uint16_t segmentIndex = 1;
  int seedRadius = 2;
  const float* intensities = nullptr;
  int intensityCount = 0;
  std::vector<GridPoint> positiveSeeds;
  std::vector<GridPoint> negativeSeeds;
};

/// Minimal execution summary returned to UI code for testing and diagnostics.
struct ReassignSliceRegionGrowResult {
  int changedVoxels = 0;
  int classifiedVoxels = 0;
};

/// Grows or removes the active segment on one 2D slice from positive and negative seed traces.
ReassignSliceRegionGrowResult runReassignSliceRegionGrow2D(
  std::vector<std::uint16_t>& labels,
  const ReassignSliceRegionGrowInput& input);

} // namespace quiqvu::region_grow

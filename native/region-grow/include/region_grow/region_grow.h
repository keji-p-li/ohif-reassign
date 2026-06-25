#pragma once

#include <cstdint>
#include <vector>

namespace quiqvu::region_grow {

struct GridPoint {
  int u = 0;
  int v = 0;
};

struct ReassignVoronoiInput {
  int width = 0;
  int height = 0;
  std::uint16_t segmentIndex = 1;
  int seedRadius = 2;
  const float* intensities = nullptr;
  int intensityCount = 0;
  std::vector<GridPoint> positiveSeeds;
  std::vector<GridPoint> negativeSeeds;
};

struct ReassignVoronoiResult {
  int changedVoxels = 0;
  int classifiedVoxels = 0;
};

ReassignVoronoiResult runReassignVoronoi2D(
  std::vector<std::uint16_t>& labels,
  const ReassignVoronoiInput& input);

} // namespace quiqvu::region_grow

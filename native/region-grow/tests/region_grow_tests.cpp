#include "region_grow/region_grow.h"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using quiqvu::region_grow::GridPoint;
using quiqvu::region_grow::ReassignVoronoiInput;
using quiqvu::region_grow::runReassignVoronoi2D;

namespace {

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

int idx(int u, int v, int width) {
  return u + v * width;
}

void testPositiveOnlyAppliesSeedDisk() {
  const int width = 9;
  const int height = 9;
  std::vector<std::uint16_t> labels(width * height, 0);

  ReassignVoronoiInput input;
  input.width = width;
  input.height = height;
  input.segmentIndex = 3;
  input.seedRadius = 1;
  input.positiveSeeds = {{4, 4}};

  const auto result = runReassignVoronoi2D(labels, input);

  require(labels[idx(4, 4, width)] == 3, "positive center was not written");
  require(labels[idx(3, 4, width)] == 3, "positive left neighbor was not written");
  require(labels[idx(4, 3, width)] == 3, "positive upper neighbor was not written");
  require(labels[idx(3, 3, width)] == 0, "seed radius should be circular, not square");
  require(result.classifiedVoxels == 0, "positive-only case should skip voronoi classification");
}

void testVoronoiSplitsBetweenPositiveAndNegative() {
  const int width = 11;
  const int height = 1;
  std::vector<std::uint16_t> labels(width * height, 0);

  ReassignVoronoiInput input;
  input.width = width;
  input.height = height;
  input.segmentIndex = 2;
  input.seedRadius = 0;
  input.positiveSeeds = {{1, 0}};
  input.negativeSeeds = {{9, 0}};

  const auto result = runReassignVoronoi2D(labels, input);

  require(labels[idx(0, 0, width)] == 2, "left side should be positive");
  require(labels[idx(4, 0, width)] == 2, "left middle should be positive");
  require(labels[idx(8, 0, width)] == 0, "right side should be negative");
  require(result.classifiedVoxels == width, "all pixels should be classified");
}

void testOtherSegmentsAreProtected() {
  const int width = 7;
  const int height = 1;
  std::vector<std::uint16_t> labels(width * height, 0);
  labels[idx(3, 0, width)] = 99;

  ReassignVoronoiInput input;
  input.width = width;
  input.height = height;
  input.segmentIndex = 4;
  input.seedRadius = 0;
  input.positiveSeeds = {{0, 0}};
  input.negativeSeeds = {{6, 0}};

  runReassignVoronoi2D(labels, input);

  require(labels[idx(3, 0, width)] == 99, "existing unrelated segment must be protected");
}

void testIntensityModelStopsAtSharpBoundary() {
  const int width = 21;
  const int height = 5;
  std::vector<std::uint16_t> labels(width * height, 0);
  std::vector<float> intensities(width * height, 0.0f);

  for (int v = 0; v < height; ++v) {
    for (int u = 0; u < width; ++u) {
      intensities[idx(u, v, width)] = u < 10 ? 10.0f : 100.0f;
    }
  }

  ReassignVoronoiInput input;
  input.width = width;
  input.height = height;
  input.segmentIndex = 6;
  input.seedRadius = 0;
  input.intensities = intensities.data();
  input.intensityCount = int(intensities.size());
  input.positiveSeeds = {{2, 2}, {3, 2}, {4, 2}};
  input.negativeSeeds = {{18, 2}, {17, 2}, {16, 2}};

  const auto result = runReassignVoronoi2D(labels, input);

  require(result.classifiedVoxels > 0, "intensity growth should accept include-like voxels");
  require(labels[idx(2, 2, width)] == 6, "include seed should remain segment");
  require(labels[idx(8, 2, width)] == 6, "include-like side should grow");
  require(labels[idx(12, 2, width)] == 0, "exclude-like side should remain background");
}

void runPerformanceSmoke() {
  const int width = 512;
  const int height = 512;
  std::vector<std::uint16_t> labels(width * height, 0);

  ReassignVoronoiInput input;
  input.width = width;
  input.height = height;
  input.segmentIndex = 5;
  input.seedRadius = 2;
  input.positiveSeeds = {{128, 128}, {130, 128}, {128, 130}};
  input.negativeSeeds = {{384, 384}, {386, 384}, {384, 386}};

  const auto start = std::chrono::steady_clock::now();
  const auto result = runReassignVoronoi2D(labels, input);
  const auto end = std::chrono::steady_clock::now();
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();

  require(result.classifiedVoxels == width * height, "performance smoke should classify whole grid");
  std::cout << "performance smoke 512x512: " << ms << " ms\n";
}

void runIntensityPerformanceSmoke() {
  const int width = 512;
  const int height = 512;
  std::vector<std::uint16_t> labels(width * height, 0);
  std::vector<float> intensities(width * height, 0.0f);

  for (int v = 0; v < height; ++v) {
    for (int u = 0; u < width; ++u) {
      intensities[idx(u, v, width)] = u < width / 2 ? 20.0f : 120.0f;
    }
  }

  ReassignVoronoiInput input;
  input.width = width;
  input.height = height;
  input.segmentIndex = 7;
  input.seedRadius = 2;
  input.intensities = intensities.data();
  input.intensityCount = int(intensities.size());
  input.positiveSeeds = {{128, 128}, {130, 128}, {128, 130}};
  input.negativeSeeds = {{384, 384}, {386, 384}, {384, 386}};

  const auto start = std::chrono::steady_clock::now();
  const auto result = runReassignVoronoi2D(labels, input);
  const auto end = std::chrono::steady_clock::now();
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();

  require(result.classifiedVoxels > 1000, "intensity performance smoke should grow a region");
  require(labels[idx(128, 128, width)] == 7, "positive region should be segmented");
  require(labels[idx(384, 384, width)] == 0, "negative region should stay background");
  std::cout << "intensity performance smoke 512x512: " << ms << " ms\n";
}

} // namespace

int main() {
  try {
    testPositiveOnlyAppliesSeedDisk();
    testVoronoiSplitsBetweenPositiveAndNegative();
    testOtherSegmentsAreProtected();
    testIntensityModelStopsAtSharpBoundary();
    runPerformanceSmoke();
    runIntensityPerformanceSmoke();
  } catch (const std::exception& error) {
    std::cerr << "FAILED: " << error.what() << "\n";
    return EXIT_FAILURE;
  }

  std::cout << "region_grow_tests passed\n";
  return EXIT_SUCCESS;
}

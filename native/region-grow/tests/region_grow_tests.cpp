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

} // namespace

int main() {
  try {
    testPositiveOnlyAppliesSeedDisk();
    testVoronoiSplitsBetweenPositiveAndNegative();
    testOtherSegmentsAreProtected();
    runPerformanceSmoke();
  } catch (const std::exception& error) {
    std::cerr << "FAILED: " << error.what() << "\n";
    return EXIT_FAILURE;
  }

  std::cout << "region_grow_tests passed\n";
  return EXIT_SUCCESS;
}

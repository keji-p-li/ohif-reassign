#include "region_grow/region_grow.h"

#include <cmath>
#include <limits>
#include <queue>

namespace quiqvu::region_grow {

namespace {

bool inBounds(int u, int v, int width, int height) {
  return u >= 0 && u < width && v >= 0 && v < height;
}

int indexOf(int u, int v, int width) {
  return u + v * width;
}

} // namespace

ReassignVoronoiResult runReassignVoronoi2D(
  std::vector<std::uint16_t>& labels,
  const ReassignVoronoiInput& input)
{
  ReassignVoronoiResult result;
  const int width = input.width;
  const int height = input.height;

  if (width <= 0 || height <= 0 || labels.size() != static_cast<std::size_t>(width * height)) {
    return result;
  }

  const auto applySeed = [&](const GridPoint& seed, std::uint16_t value) {
    for (int dv = -input.seedRadius; dv <= input.seedRadius; ++dv) {
      for (int du = -input.seedRadius; du <= input.seedRadius; ++du) {
        if (du * du + dv * dv > input.seedRadius * input.seedRadius) {
          continue;
        }

        const int u = seed.u + du;
        const int v = seed.v + dv;
        if (!inBounds(u, v, width, height)) {
          continue;
        }

        const int idx = indexOf(u, v, width);
        const auto current = labels[idx];
        if (current == 0 || current == input.segmentIndex) {
          if (current != value) {
            ++result.changedVoxels;
          }
          labels[idx] = value;
        }
      }
    }
  };

  for (const auto& seed : input.positiveSeeds) {
    applySeed(seed, input.segmentIndex);
  }
  for (const auto& seed : input.negativeSeeds) {
    applySeed(seed, 0);
  }

  if (input.positiveSeeds.empty() || input.negativeSeeds.empty()) {
    return result;
  }

  std::vector<float> dist(width * height, std::numeric_limits<float>::infinity());
  std::vector<std::uint8_t> classification(width * height, 0);
  std::queue<int> queue;

  const auto pushSeed = [&](const GridPoint& seed, std::uint8_t seedLabel) {
    if (!inBounds(seed.u, seed.v, width, height)) {
      return;
    }

    const int idx = indexOf(seed.u, seed.v, width);
    dist[idx] = 0.0f;
    classification[idx] = seedLabel;
    queue.push(idx);
  };

  for (const auto& seed : input.positiveSeeds) {
    pushSeed(seed, 1);
  }
  for (const auto& seed : input.negativeSeeds) {
    pushSeed(seed, 2);
  }

  constexpr int dirs[4][2] = {
    {-1, 0},
    {1, 0},
    {0, -1},
    {0, 1},
  };

  while (!queue.empty()) {
    const int currIdx = queue.front();
    queue.pop();

    const int u = currIdx % width;
    const int v = currIdx / width;
    const float currDist = dist[currIdx];
    const auto currLabel = classification[currIdx];

    for (const auto& dir : dirs) {
      const int nu = u + dir[0];
      const int nv = v + dir[1];
      if (!inBounds(nu, nv, width, height)) {
        continue;
      }

      const int nidx = indexOf(nu, nv, width);
      if (std::isfinite(dist[nidx])) {
        continue;
      }

      dist[nidx] = currDist + 1.0f;
      classification[nidx] = currLabel;
      queue.push(nidx);
    }
  }

  for (int idx = 0; idx < width * height; ++idx) {
    const auto current = labels[idx];
    if (current != 0 && current != input.segmentIndex) {
      continue;
    }

    std::uint16_t next = current;
    if (classification[idx] == 1) {
      next = input.segmentIndex;
    } else if (classification[idx] == 2) {
      next = 0;
    }

    if (classification[idx]) {
      ++result.classifiedVoxels;
    }
    if (next != current) {
      ++result.changedVoxels;
    }
    labels[idx] = next;
  }

  return result;
}

} // namespace quiqvu::region_grow

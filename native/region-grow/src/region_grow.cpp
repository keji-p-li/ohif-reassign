#include "region_grow/region_grow.h"

#include <cmath>
#include <algorithm>
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

        struct Stats {
            float mean = 0.0f;
            float sigma = 1.0f;
        };

        Stats sampleStats(const float* intensities, const std::vector<GridPoint>& seeds, int width, int height) {
            double sum = 0.0;
            double sumSq = 0.0;
            int count = 0;

            for (const auto& seed : seeds) {
                if (!inBounds(seed.u, seed.v, width, height)) {
                    continue;
                }
                const auto value = intensities[indexOf(seed.u, seed.v, width)];
                sum += value;
                sumSq += double(value) * double(value);
                ++count;
            }

            if (!count) {
                return {};
            }

            const double mean = sum / count;
            const double variance = std::max(1.0, sumSq / count - mean * mean);
            return Stats{float(mean), float(std::sqrt(variance))};
        }

        float gaussianSimilarity(float value, const Stats& stats) {
            const float z = (value - stats.mean) / stats.sigma;
            return std::exp(-0.5f * z * z);
        }

        std::vector<float> computeGradient(const float* intensities, int width, int height) {
            std::vector<float> gradient(width * height, 0.0f);
            float maxGradient = 0.0f;

            for (int v = 0; v < height; ++v) {
                for (int u = 0; u < width; ++u) {
                    const int left = std::max(0, u - 1);
                    const int right = std::min(width - 1, u + 1);
                    const int up = std::max(0, v - 1);
                    const int down = std::min(height - 1, v + 1);
                    const float dx = intensities[indexOf(right, v, width)] - intensities[indexOf(left, v, width)];
                    const float dy = intensities[indexOf(u, down, width)] - intensities[indexOf(u, up, width)];
                    const float g = std::sqrt(dx * dx + dy * dy);
                    gradient[indexOf(u, v, width)] = g;
                    maxGradient = std::max(maxGradient, g);
                }
            }

            if (maxGradient > 0.0f) {
                for (auto& g : gradient) {
                    g /= maxGradient;
                }
            }

            return gradient;
        }

        bool hasIntensityModel(const ReassignVoronoiInput& input) {
            return input.intensities && input.intensityCount == input.width * input.height;
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

        if (!hasIntensityModel(input)) {
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

        const auto includeStats = sampleStats(input.intensities, input.positiveSeeds, width, height);
        const auto excludeStats = sampleStats(input.intensities, input.negativeSeeds, width, height);
        const auto gradient = computeGradient(input.intensities, width, height);

        std::vector<std::uint8_t> blocked(width * height, 0);
        for (const auto& seed : input.negativeSeeds) {
            for (int dv = -input.seedRadius; dv <= input.seedRadius; ++dv) {
                for (int du = -input.seedRadius; du <= input.seedRadius; ++du) {
                    if (du * du + dv * dv > input.seedRadius * input.seedRadius) {
                        continue;
                    }
                    const int u = seed.u + du;
                    const int v = seed.v + dv;
                    if (inBounds(u, v, width, height)) {
                        blocked[indexOf(u, v, width)] = 1;
                    }
                }
            }
        }

        struct Candidate {
            float priority;
            float confidence;
            int idx;
            bool operator<(const Candidate& rhs) const {
                return priority > rhs.priority;
            }
        };

        std::vector<float> best(width * height, std::numeric_limits<float>::infinity());
        std::vector<float> confidence(width * height, 0.0f);
        std::vector<std::uint8_t> accepted(width * height, 0);
        std::priority_queue<Candidate> queue;

        const auto pushCandidate = [&](int idx, float priority, float nextConfidence) {
            if (priority >= best[idx]) {
                return;
            }
            best[idx] = priority;
            confidence[idx] = std::max(0.0f, std::min(1.0f, nextConfidence));
            queue.push(Candidate{priority, confidence[idx], idx});
        };

        double centerU = 0.0;
        double centerV = 0.0;
        int centerCount = 0;
        for (const auto& seed : input.positiveSeeds) {
            if (!inBounds(seed.u, seed.v, width, height)) {
                continue;
            }
            const int idx = indexOf(seed.u, seed.v, width);
            pushCandidate(idx, 0.0f, 1.0f);
            centerU += seed.u;
            centerV += seed.v;
            ++centerCount;
        }
        if (centerCount) {
            centerU /= centerCount;
            centerV /= centerCount;
        }

        constexpr int dirs[4][2] = {
            {-1, 0},
            {1, 0},
            {0, -1},
            {0, 1},
        };

        const float maxDistance = std::max(1.0f, std::sqrt(float(width * width + height * height)));
        constexpr float includeThreshold = 0.12f;
        constexpr float edgeWeight = 0.35f;
        constexpr float excludeWeight = 0.75f;
        constexpr float compactnessWeight = 0.08f;
        constexpr float confidenceDecay = 0.92f;
        constexpr float confidenceEdgePenalty = 0.25f;
        constexpr float confidenceExcludeOverride = 0.35f;

        while (!queue.empty()) {
            const auto candidate = queue.top();
            queue.pop();
            const int currIdx = candidate.idx;
            if (candidate.priority != best[currIdx] || accepted[currIdx]) {
                continue;
            }
            const float parentConfidence = confidence[currIdx];

            if (!blocked[currIdx]) {
                accepted[currIdx] = 1;
            }

            const int u = currIdx % width;
            const int v = currIdx / width;

            for (const auto& dir : dirs) {
                const int nu = u + dir[0];
                const int nv = v + dir[1];
                if (!inBounds(nu, nv, width, height)) {
                    continue;
                }

                const int nidx = indexOf(nu, nv, width);
                if (blocked[nidx] || accepted[nidx]) {
                    continue;
                }
                const auto current = labels[nidx];
                if (current != 0 && current != input.segmentIndex) {
                    continue;
                }

                const float value = input.intensities[nidx];
                const float includeSimilarity = gaussianSimilarity(value, includeStats);
                const float excludeSimilarity = gaussianSimilarity(value, excludeStats);
                const float spatialSupport = parentConfidence * confidenceDecay;
                const float effectiveInclude = std::max(includeSimilarity, spatialSupport);
                if (effectiveInclude < includeThreshold) {
                    continue;
                }
                if (
                    excludeSimilarity > effectiveInclude * 1.15f &&
                    spatialSupport < confidenceExcludeOverride) {
                    continue;
                }

                const float edge = std::max(gradient[currIdx], gradient[nidx]);
                const float compactness =
                    std::sqrt(float((nu - centerU) * (nu - centerU) + (nv - centerV) * (nv - centerV))) /
                    maxDistance;
                const float effectiveExclude =
                    excludeSimilarity * std::max(0.0f, 1.0f - 0.7f * spatialSupport);
                const float localCost =
                    (1.0f - effectiveInclude) +
                    excludeWeight * effectiveExclude +
                    edgeWeight * edge +
                    compactnessWeight * compactness;
                const float nextConfidence =
                    effectiveInclude * std::max(0.0f, 1.0f - confidenceEdgePenalty * edge);

                pushCandidate(nidx, candidate.priority + std::max(0.001f, localCost), nextConfidence);
            }
        }

        for (int idx = 0; idx < width * height; ++idx) {
            const auto current = labels[idx];
            if (current != 0 && current != input.segmentIndex) {
                continue;
            }

            const std::uint16_t next = accepted[idx] ? input.segmentIndex : 0;
            if (accepted[idx]) {
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

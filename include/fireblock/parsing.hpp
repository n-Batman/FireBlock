#pragma once
#include "fireblock/controller.hpp"
#include "fireblock/csv.hpp"
#include <cstdint>

namespace fireblock {
struct ParseStats {
    uint64_t accepted = 0, rejected = 0;
    std::vector<std::string> diagnostics;
};
class ParsingController {
public:
    static void validate(const Json& config);
    static ParseStats parseFirms(const std::filesystem::path& input,
                                const std::filesystem::path& output,
                                const Json& options,
                                const std::string& sourceName);
    static ParseStats parseCopernicus(const std::filesystem::path& input,
                                     const std::filesystem::path& output,
                                     const std::string& sourceName);
    // Reads the existing ingestion directory layout. A supplied Controller is
    // required only when storage.enabled=true. Uploads artifacts and the run
    // manifest through the existing B2 layer; never retries ambiguous uploads.
    Json run(const Json& config, Controller* storage = nullptr) const;
};
}

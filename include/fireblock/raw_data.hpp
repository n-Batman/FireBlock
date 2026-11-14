#pragma once
#include "fireblock/ingest.hpp"

namespace fireblock {
// Storage contract for raw datasets. Independent of parser implementation.
class RawDataController {
public:
    explicit RawDataController(Controller& storage) : storage_(storage) {}
    Json scrape(const Json& ingestionConfig, const std::filesystem::path& workRoot,
                const std::string& bucket, const std::string& prefix = "raw",
                Transport sourceTransport = windowsHttp);
    Json publish(const std::filesystem::path& inputRoot, const std::string& bucket,
                 const std::string& prefix = "raw");
    // destination must not exist. It becomes visible only after all checks pass.
    Json pull(const std::string& manifestFileId, const std::filesystem::path& destination);
private:
    Controller& storage_;
};
}

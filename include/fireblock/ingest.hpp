#pragma once
#include "fireblock/controller.hpp"

namespace fireblock {
// Dates use a UTC half-open interval [start, end); bbox is west,south,east,north.
// No credentials are written into metadata or diagnostics.
class Ingestor {
public:
    using ReuseAsset = std::function<bool(const std::string&,const std::string&)>;
    explicit Ingestor(Transport transport = windowsHttp, ReuseAsset reuse = {});
    void run(const Json& config);
    static void validate(const Json& config);
private:
    Response request(Request input);
    Json getJson(const std::string& url);
    void authenticate();
    void download(const std::string& url, const std::filesystem::path& destination,
                  bool authorized = false, uintmax_t expectedBytes = 0);
    void copernicus(const Json& config);
    void firms(const Json& config);
    Transport transport_;
    std::string token_;
    ReuseAsset reuse_;
};
}

#include "fireblock/ingest.hpp"
#include <windows.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <thread>

namespace fireblock {
namespace {
constexpr const char* catalogue = "https://catalogue.dataspace.copernicus.eu/odata/v1/";
constexpr const char* tokenUrl = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
int monthDays(int y, int m) {
    static const int days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
    return days[m-1] + (m == 2 && y % 4 == 0 && (y % 100 != 0 || y % 400 == 0));
}
void date(const std::string& s) {
    if (!std::regex_match(s, std::regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")))
        throw std::runtime_error("Dates must use YYYY-MM-DD");
    int y = std::stoi(s.substr(0,4)), m = std::stoi(s.substr(5,2)), d = std::stoi(s.substr(8,2));
    if (y < 1900 || y > 9998 || m < 1 || m > 12 || d < 1 || d > monthDays(y,m))
        throw std::runtime_error("Invalid calendar date");
}
std::string nextDay(const std::string& s) {
    int y = std::stoi(s.substr(0,4)), m = std::stoi(s.substr(5,2)), d = std::stoi(s.substr(8,2));
    if (++d > monthDays(y,m)) { d = 1; if (++m > 12) { m = 1; ++y; } }
    std::ostringstream out; out << std::setfill('0') << std::setw(4) << y << '-'
        << std::setw(2) << m << '-' << std::setw(2) << d;
    return out.str();
}
void commit(const std::filesystem::path& part, const std::filesystem::path& target) {
    if (!MoveFileExW(part.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
        throw std::runtime_error("Cannot commit output file");
}
void save(const std::filesystem::path& target, const Json& data) {
    std::filesystem::create_directories(target.parent_path());
    auto part = target; part += ".part";
    std::ofstream out(part, std::ios::binary | std::ios::trunc);
    out << data.dump(2) << '\n'; out.close();
    if (!out) throw std::runtime_error("Cannot write metadata");
    commit(part, target);
}
std::string quote(std::string s) {
    for (size_t p = 0; (p = s.find('\'',p)) != std::string::npos; p += 2) s.insert(p, 1, '\'');
    return "'" + s + "'";
}
bool cdseUrl(const std::string& url) {
    return url.rfind("https://catalogue.dataspace.copernicus.eu/",0) == 0 ||
           url.rfind("https://download.dataspace.copernicus.eu/",0) == 0;
}
bool cached(const std::filesystem::path& path, uintmax_t expected) {
    if (!std::filesystem::is_regular_file(path)) return false;
    try {
        std::ifstream in(path.u8string() + ".complete.json");
        auto metadata = Json::parse(in);
        auto size = std::filesystem::file_size(path);
        return size > 0 && size == metadata.at("bytes").get<uintmax_t>() && (!expected || size == expected);
    } catch (...) { return false; }
}
std::string bboxText(const Json& box) {
    std::ostringstream out; out << std::setprecision(12);
    for (size_t i = 0; i < 4; ++i) { if (i) out << ','; out << box[i].get<double>(); }
    return out.str();
}
void checkCsv(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary); std::string header;
    std::getline(in, header);
    if (header.rfind("latitude,longitude,", 0) != 0)
        throw std::runtime_error("FIRMS returned an error or unexpected CSV schema; check key, source and data availability");
}
}
Ingestor::Ingestor(Transport t) : transport_(std::move(t)) {}
void Ingestor::validate(const Json& c) {
    if (!c.is_object()) throw std::runtime_error("Configuration must be an object");
    date(c.at("start").get<std::string>()); date(c.at("end").get<std::string>());
    if (c.at("start").get<std::string>() >= c.at("end").get<std::string>()) throw std::runtime_error("end must be after start");
    const auto& b = c.at("bbox");
    if (!b.is_array() || b.size() != 4) throw std::runtime_error("bbox must be [west,south,east,north]");
    std::array<double,4> v;
    for (size_t i=0; i<4; ++i) { v[i] = b[i].get<double>(); if (!std::isfinite(v[i])) throw std::runtime_error("Non-finite coordinate"); }
    if (v[0] < -180 || v[2] > 180 || v[1] < -90 || v[3] > 90 || v[0] >= v[2] || v[1] >= v[3])
        throw std::runtime_error("Invalid bbox; split antimeridian regions into separate runs");
    if (c.at("output").get<std::string>().empty()) throw std::runtime_error("output is required");
    const auto& cp = c.at("copernicus"); const auto& f = c.at("firms");
    if (!cp.at("enabled").get<bool>() && !f.at("enabled").get<bool>()) throw std::runtime_error("Enable at least one provider");
    if (cp.at("enabled").get<bool>()) {
        if (cp.at("collection").get<std::string>().empty()) throw std::runtime_error("collection is required");
        int limit = cp.value("max_products", 20);
        if (limit < 1 || limit > 10000) throw std::runtime_error("max_products must be 1..10000");
        cp.value("products", false); cp.value("quicklooks", true);
        if (cp.contains("cloud_cover_max")) {
            double cloud = cp.at("cloud_cover_max").get<double>();
            if (!std::isfinite(cloud) || cloud < 0 || cloud > 100) throw std::runtime_error("cloud_cover_max must be 0..100");
        }
    }
    if (f.at("enabled").get<bool>()) {
        static const std::set<std::string> sources{"LANDSAT_NRT","MODIS_NRT","MODIS_SP","VIIRS_NOAA20_NRT","VIIRS_NOAA20_SP","VIIRS_NOAA21_NRT","VIIRS_NOAA21_SP","VIIRS_SNPP_NRT","VIIRS_SNPP_SP"};
        if (!f.at("sources").is_array() || f.at("sources").empty()) throw std::runtime_error("firms.sources must be a nonempty array");
        std::set<std::string> seen;
        for (const auto& s : f.at("sources")) {
            auto name = s.get<std::string>();
            if (!sources.count(name) || !seen.insert(name).second) throw std::runtime_error("Unknown or duplicate FIRMS source");
        }
    }
}
Response Ingestor::request(Request input) {
    for (int attempt=0; attempt<4; ++attempt) {
        Response r;
        try { r = transport_(input); }
        catch (...) {
            if (attempt == 3) throw;
            std::this_thread::sleep_for(std::chrono::seconds(1 << attempt)); continue;
        }
        if (r.status != 429 && r.status != 408 && (r.status < 500 || r.status > 599)) return r;
        if (attempt == 3) return r;
        std::this_thread::sleep_for(std::chrono::seconds(2 << attempt));
    }
    throw std::runtime_error("Request retries exhausted");
}
Json Ingestor::getJson(const std::string& url) {
    auto r = request({"GET",url,{},"",{}, {}});
    if (r.status != 200) throw std::runtime_error("Catalogue HTTP " + std::to_string(r.status));
    auto data = Json::parse(r.body,nullptr,false);
    if (!data.is_object() || !data.contains("value") || !data.at("value").is_array())
        throw std::runtime_error("Invalid catalogue JSON response");
    return data;
}
void Ingestor::authenticate() {
    auto user = environment("CDSE_USERNAME"), password = environment("CDSE_PASSWORD");
    if (user.empty() || password.empty()) throw std::runtime_error("Set CDSE_USERNAME and CDSE_PASSWORD to download full products");
    std::string body = "client_id=cdse-public&grant_type=password&username=" + encode(user) + "&password=" + encode(password);
    auto totp = environment("CDSE_TOTP"); if (!totp.empty()) body += "&totp=" + encode(totp);
    auto r = request({"POST",tokenUrl,{{"Content-Type","application/x-www-form-urlencoded"}},body,{}, {}});
    if (r.status != 200) throw std::runtime_error("Copernicus authentication HTTP " + std::to_string(r.status));
    auto data = Json::parse(r.body,nullptr,false);
    if (!data.is_object() || !data.contains("access_token") || !data.at("access_token").is_string() || data.at("access_token").get<std::string>().empty())
        throw std::runtime_error("Invalid Copernicus authentication response");
    token_ = data.at("access_token").get<std::string>();
}
void Ingestor::download(const std::string& url, const std::filesystem::path& path, bool auth, uintmax_t expected) {
    if (cached(path, expected)) { std::cout << "Reusing completed file: " << path.filename().u8string() << '\n'; return; }
    std::cout << "Downloading: " << path.filename().u8string() << '\n';
    std::filesystem::create_directories(path.parent_path());
    auto part = path; part += ".part";
    try {
        std::string current = url; bool refreshed = false;
        for (int redirect=0; redirect<10; ++redirect) {
            Request req{"GET",current,{},"",{},part};
            if (auth && cdseUrl(current)) {
                if (token_.empty()) authenticate();
                req.headers.emplace_back("Authorization","Bearer " + token_);
            }
            auto r = request(req);
            if (r.status == 401 && auth && cdseUrl(current) && !refreshed) {
                authenticate(); refreshed = true; continue;
            }
            if (r.status == 301 || r.status == 302 || r.status == 303 || r.status == 307 || r.status == 308) {
                if (r.location.rfind("/",0) == 0 && r.location.rfind("//",0) != 0) {
                    auto originEnd = current.find('/',8); current = current.substr(0,originEnd) + r.location;
                } else current = r.location;
                if (current.rfind("https://",0) != 0) throw std::runtime_error("Download requires an HTTPS redirect");
                continue;
            }
            if (r.status != 200) throw std::runtime_error("Download HTTP " + std::to_string(r.status));
            auto size = std::filesystem::file_size(part);
            if (!size || (expected && size != expected)) throw std::runtime_error("Downloaded size does not match catalogue");
            if (path.extension() == ".csv") checkCsv(part);
            commit(part,path);
            save(path.u8string() + ".complete.json", {{"bytes",size}});
            std::cout << "Downloaded: " << path.filename().u8string() << " (" << size << " bytes)\n";
            return;
        }
        throw std::runtime_error("Too many redirects");
    } catch (...) { std::error_code ec; std::filesystem::remove(part,ec); throw; }
}
void Ingestor::copernicus(const Json& c) {
    auto opts = c.at("copernicus"); const auto& b = c.at("bbox");
    std::ostringstream poly; poly << std::setprecision(12);
    auto point = [&](int x,int y) { poly << b[x].get<double>() << ' ' << b[y].get<double>(); };
    point(0,1); poly << ','; point(2,1); poly << ','; point(2,3); poly << ','; point(0,3); poly << ','; point(0,1);
    std::string filter = "Collection/Name eq " + quote(opts.at("collection").get<std::string>()) +
        " and OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((" + poly.str() + "))')" +
        " and ContentDate/Start ge " + c.at("start").get<std::string>() + "T00:00:00.000Z" +
        " and ContentDate/Start lt " + c.at("end").get<std::string>() + "T00:00:00.000Z";
    if (opts.contains("product_type")) filter += " and Attributes/OData.CSC.StringAttribute/any(a:a/Name eq 'productType' and a/OData.CSC.StringAttribute/Value eq " + quote(opts.at("product_type").get<std::string>()) + ")";
    if (opts.contains("cloud_cover_max")) filter += " and Attributes/OData.CSC.DoubleAttribute/any(a:a/Name eq 'cloudCover' and a/OData.CSC.DoubleAttribute/Value le " + opts.at("cloud_cover_max").dump() + ")";
    int limit = opts.value("max_products",20);
    std::string url = std::string(catalogue) + "Products?$filter=" + encode(filter) + "&$expand=Assets&$expand=Attributes&$orderby=ContentDate/Start%20asc&$top=" + std::to_string((std::min)(100,limit));
    auto root = std::filesystem::u8path(c.at("output").get<std::string>()) / "copernicus";
    Json products = Json::array(); std::set<std::string> seen, pages;
    while (!url.empty() && products.size() < static_cast<size_t>(limit)) {
        if (url.rfind(catalogue,0) != 0 || !pages.insert(url).second) throw std::runtime_error("Invalid catalogue pagination URL");
        auto page = getJson(url);
        for (const auto& product : page.at("value")) {
            auto id = product.at("Id").get<std::string>();
            if (!std::regex_match(id,std::regex("[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"))) throw std::runtime_error("Invalid product UUID");
            if (!seen.insert(id).second) continue;
            products.push_back(product);
            save(root / "catalogue.json",products);
            save(root / id / "metadata.json",product);
            if (opts.value("quicklooks",true) && product.contains("Assets")) {
                for (const auto& asset : product.at("Assets")) {
                    auto type = asset.value("Type","");
                    std::transform(type.begin(),type.end(),type.begin(),[](unsigned char ch){return static_cast<char>(std::tolower(ch));});
                    if (type != "quicklook") continue;
                    auto link = asset.at("DownloadLink").get<std::string>();
                    if (!cdseUrl(link)) throw std::runtime_error("Unexpected quicklook host");
                    download(link,root / id / "quicklook.image"); break;
                }
            }
            if (opts.value("products",false) && product.value("Online",false)) {
                auto name = product.value("Name","");
                auto ext = name.size() >= 3 && name.substr(name.size()-3) == ".nc" ? ".nc" : ".zip";
                download("https://download.dataspace.copernicus.eu/odata/v1/Products(" + id + ")/$value",
                         root / id / ("product" + std::string(ext)),true);
            } else if (opts.value("products",false)) std::cerr << "Offline product skipped: " << id << '\n';
            if (products.size() == static_cast<size_t>(limit)) break;
        }
        url = page.value("@odata.nextLink","");
    }
    save(root / "catalogue.json",products);
    std::cout << "Copernicus: " << products.size() << " products catalogued (limit " << limit << ")\n";
}
void Ingestor::firms(const Json& c) {
    auto key = environment("FIRMS_MAP_KEY");
    if (key.empty()) throw std::runtime_error("Set FIRMS_MAP_KEY");
    auto root = std::filesystem::u8path(c.at("output").get<std::string>()) / "firms";
    for (const auto& source : c.at("firms").at("sources")) {
        std::string start = c.at("start"), end = c.at("end");
        while (start < end) {
            auto stop = start; int days = 0;
            while (stop < end && days < 5) { stop = nextDay(stop); ++days; }
            auto name = source.get<std::string>();
            auto path = root / (name + "_" + start + "_" + stop + ".csv");
            // FIRMS near-real-time observations change: always refresh this provider.
            auto receipt = path; receipt += ".complete.json";
            std::error_code ec; std::filesystem::remove(receipt,ec);
            download("https://firms.modaps.eosdis.nasa.gov/api/area/csv/" + encode(key) + "/" + name + "/" + bboxText(c.at("bbox")) + "/" + std::to_string(days) + "/" + start,path);
            save(path.u8string() + ".metadata.json",{{"provider","NASA FIRMS"},{"source",name},{"start",start},{"end_exclusive",stop},{"bbox",c.at("bbox")}});
            std::cout << "FIRMS: " << name << ' ' << start << " through " << stop << " (exclusive)\n";
            start = stop;
        }
    }
}
void Ingestor::run(const Json& c) {
    std::cout << std::unitbuf;
    validate(c); bool failed = false;
    for (const auto& provider : {std::string("copernicus"),std::string("firms")}) {
        if (!c.at(provider).at("enabled").get<bool>()) continue;
        try { std::cout << "Starting provider: " << provider << '\n'; if (provider == "copernicus") copernicus(c); else firms(c); }
        catch (const std::exception& e) { failed = true; std::cerr << provider << ": " << e.what() << '\n'; }
    }
    if (failed) throw std::runtime_error("One or more providers failed; successful downloads are retained");
}
}

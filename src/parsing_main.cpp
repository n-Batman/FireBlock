#include "fireblock/parsing.hpp"
#include "fireblock/ingest.hpp"
#include <fstream>
#include <cwchar>
#include <iostream>
#include <memory>
#include <set>
#include <stdexcept>

namespace {
fireblock::Json readConfig(const std::string& path) {
    std::ifstream in(std::filesystem::u8path(path));
    if (!in) throw std::runtime_error("Cannot open configuration file");
    auto result=fireblock::Json::parse(in,nullptr,false);
    if (!result.is_object()) throw std::runtime_error("Configuration must be valid JSON object");
    return result;
}
}
int main(int argc,char** argv) {
    if (argc==1 || std::string(argv[1])=="--help" || std::string(argv[1])=="help") {
        std::cout << "FireBlock parsing controller\n"
            "Usage: fireblock_parse CONFIG.json [--validate] [--env FILE] [--ingest CONFIG.json]\n"
            "Parses existing data/firms CSVs and data/copernicus product metadata into NDJSON.\n"
            "Optionally ingests first, then uploads artifacts/assets and a manifest to Backblaze B2.\n"
            "--validate checks configuration only; no network or output writes.\n";
        return 0;
    }
    try {
        bool validate=false; std::string env=".env", ingest;
        std::set<std::string> seen;
        for (int i=2;i<argc;++i) {
            std::string arg=argv[i];
            if (!seen.insert(arg).second) throw std::runtime_error("Duplicate command option");
            if (arg=="--validate") validate=true;
            else if ((arg=="--env" || arg=="--ingest") && i+1<argc) {
                auto value=std::string(argv[++i]); if (arg=="--env") env=value; else ingest=value;
            } else throw std::runtime_error("Unknown option or missing value; run fireblock_parse --help");
        }
        auto config=readConfig(argv[1]);
        if (config.contains("storage") && config["storage"].value("enabled",false) &&
            config["storage"].value("bucket",std::string()).empty()) {
            // Existing credential loader only recognizes B2 settings.
            fireblock::loadEnv(std::filesystem::u8path(env));
            config["storage"]["bucket"]=fireblock::environment("B2_BUCKET_NAME");
        }
        fireblock::ParsingController::validate(config);
        auto ingestion=ingest.empty() ? fireblock::Json() : readConfig(ingest);
        if (!ingest.empty()) {
            fireblock::Ingestor::validate(ingestion);
            auto produced=std::filesystem::weakly_canonical(std::filesystem::u8path(ingestion.at("output").get<std::string>()));
            auto consumed=std::filesystem::weakly_canonical(std::filesystem::u8path(config.at("input_root").get<std::string>()));
            if (_wcsicmp(produced.c_str(),consumed.c_str())!=0) throw std::runtime_error("Ingestion output must match parsing input_root");
        }
        if (validate) { std::cout << "Parsing configuration valid\n"; return 0; }
        std::unique_ptr<fireblock::Controller> storage;
        if (config.at("storage").at("enabled").get<bool>()) {
            if (seen.count("--env") && !std::filesystem::exists(std::filesystem::u8path(env)))
                throw std::runtime_error("Specified credential file does not exist");
            fireblock::loadEnv(std::filesystem::u8path(env));
            storage=std::make_unique<fireblock::Controller>(fireblock::environment("B2_APPLICATION_KEY_ID"),fireblock::environment("B2_APPLICATION_KEY"));
        }
        if (!ingest.empty()) fireblock::Ingestor{}.run(ingestion);
        auto manifest=fireblock::ParsingController{}.run(config,storage.get());
        auto path=std::filesystem::u8path(config.at("output_root").get<std::string>()) / manifest.at("run_id").get<std::string>() / "manifest.json";
        std::cout << "Parsed " << manifest.at("artifacts").size() << " files. Manifest: " << path.u8string() << '\n';
        if (manifest.contains("storage")) std::cout << "Backblaze manifest: " << manifest.at("storage").at("manifest_key").get<std::string>() << '\n';
        return 0;
    } catch (const std::exception& e) { std::cerr << "Parsing failed: " << e.what() << '\n'; return 1; }
}

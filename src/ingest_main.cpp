#include "fireblock/ingest.hpp"
#include <fstream>
#include <iostream>
#include <stdexcept>

int main(int argc, char** argv) {
    if (argc == 1 || (argc == 2 && (std::string(argv[1]) == "--help" || std::string(argv[1]) == "help"))) {
        std::cout << "FireBlock satellite/fire data ingestion\n"
            "Usage: fireblock_ingest CONFIG.json [--validate]\n"
            "Credentials are read from CDSE_USERNAME, CDSE_PASSWORD, optional CDSE_TOTP,\n"
            "and FIRMS_MAP_KEY environment variables. See config/ingest.example.json.\n"
            "Dates are UTC [start, end); bbox is west,south,east,north.\n"
            "--validate checks configuration without network access.\n";
        return 0;
    }
    try {
        if (argc > 3 || (argc == 3 && std::string(argv[2]) != "--validate"))
            throw std::runtime_error("Usage: fireblock_ingest CONFIG.json [--validate]");
        std::ifstream input(std::filesystem::u8path(argv[1]));
        if (!input) throw std::runtime_error("Cannot open configuration file");
        auto config = fireblock::Json::parse(input);
        fireblock::Ingestor::validate(config);
        if (argc == 3) { std::cout << "Configuration valid\n"; return 0; }
        fireblock::Ingestor{}.run(config);
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "Ingestion failed: " << e.what() << '\n'; return 1;
    }
}

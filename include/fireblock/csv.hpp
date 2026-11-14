#pragma once
#include <cstddef>
#include <istream>
#include <string>
#include <vector>

namespace fireblock {
// Streaming CSV tokenizer; malformed structural input always throws.
bool readCsvRecord(std::istream& input, std::vector<std::string>& fields,
                   size_t maxRecordBytes = 1024 * 1024);
}

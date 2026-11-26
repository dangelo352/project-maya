#include "ik2_draft_metadata.hpp"

#include <cstdio>
#include <initializer_list>

int main() {
    if (!ik2::draft::gguf_window_matches_inkling_draft(1024)) {
        std::puts("FAIL legacy Maya window encoding");
        return 1;
    }
    if (!ik2::draft::gguf_window_matches_inkling_draft(1025)) {
        std::puts("FAIL llama.cpp DSpark window encoding");
        return 1;
    }
    for (const double value : std::initializer_list<double>{0, 1023, 1024.5, 1026}) {
        if (ik2::draft::gguf_window_matches_inkling_draft(value)) {
            std::printf("FAIL unexpected window encoding accepted: %g\n", value);
            return 1;
        }
    }
    std::puts("ik2_draft_window_test: ok");
    return 0;
}

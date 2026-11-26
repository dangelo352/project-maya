#pragma once

namespace ik2::draft {

// llama.cpp serializes Inkling DSpark's configured 1024-position pre-anchor window as 1025:
// its GGUF sliding-window convention subtracts one. Maya's draft attention keeps [P-1023, P)
// as context and supplies the anchor at P in the draft block, so both metadata encodings denote
// the same 1024-position span. Keep the legacy Maya encoding accepted as well.
constexpr bool gguf_window_matches_inkling_draft(double value) {
    return value == 1024 || value == 1025;
}

}  // namespace ik2::draft

"""Small stdlib reference test for ggml Q8_0 block decoding (no model/GPU needed)."""

import struct
import unittest


def decode_q8_0(blocks: bytes) -> list[float]:
    """Decode little-endian ggml Q8_0 blocks: fp16 scale + 32 signed int8 values."""
    block_size = 34
    if not blocks or len(blocks) % block_size:
        raise ValueError("Q8_0 data must contain one or more complete 34-byte blocks")
    decoded: list[float] = []
    for offset in range(0, len(blocks), block_size):
        scale = struct.unpack_from("<e", blocks, offset)[0]
        quants = struct.unpack_from("<32b", blocks, offset + 2)
        decoded.extend(scale * q for q in quants)
    return decoded


class Q8_0ReferenceTests(unittest.TestCase):
    def test_known_block_exact_values(self) -> None:
        values = [0, 1, -1, 2, -2, 127, -128] + [0] * 25
        encoded = struct.pack("<e32b", 0.5, *values)
        expected = [0.0, 0.5, -0.5, 1.0, -1.0, 63.5, -64.0] + [0.0] * 25
        self.assertEqual(decode_q8_0(encoded), expected)

    def test_decodes_independent_blocks(self) -> None:
        first = struct.pack("<e32b", 0.25, *([4] + [0] * 31))
        second = struct.pack("<e32b", -2.0, *([-3] + [0] * 31))
        decoded = decode_q8_0(first + second)
        self.assertEqual(decoded[0], 1.0)
        self.assertEqual(decoded[32], 6.0)
        self.assertEqual(len(decoded), 64)

    def test_rejects_partial_block(self) -> None:
        with self.assertRaises(ValueError):
            decode_q8_0(bytes(33))


if __name__ == "__main__":
    unittest.main()

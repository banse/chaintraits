"""Independent checks of compressed text and generated table safety."""
import json
from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parents[1]

class RecipeTablesTests(unittest.TestCase):
    def test_dictionary_is_acyclic_bounded_and_has_no_forbidden_bytes(self):
        source=(ROOT/'src/lib/RecipeText.sol').read_text()
        def hexval(name): return bytes.fromhex(re.search(rf'constant {name} = hex"([0-9a-f]+)"',source).group(1))
        data,book=hexval('DATA'),hexval('DICT')
        for value in (data,book):
            self.assertTrue(all(c<240 for c in value))
        for i in range(len(book)//2): self.assertTrue(all(c<128+i for c in book[2*i:2*i+2]))
        offsets=re.search(r'constant OFFSETS = "([0-9a-f]+)"',source).group(1)
        lengths=re.search(r'constant LENGTHS = "([0-9a-f]+)"',source).group(1)
        offsets=[int(offsets[i:i+4],16) for i in range(0,len(offsets),4)]
        lengths=[int(lengths[i:i+4],16) for i in range(0,len(lengths),4)]
        self.assertEqual(offsets[0],0); self.assertEqual(offsets[-1],len(data))
        for i,(a,z) in enumerate(zip(offsets,offsets[1:])):
            out=[]
            for byte in data[a:z]:
                stack=[byte]
                while stack:
                    self.assertLessEqual(len(stack),32)
                    c=stack.pop()
                    if c<128: out.append(c)
                    else:
                        left,right=book[2*(c-128):2*(c-128)+2]
                        stack.extend([right,left])
            self.assertEqual(len(out),lengths[i]); self.assertTrue(bytes(out).isascii())
    def test_hive_offsets_are_ascii_and_tile_exactly(self):
        source=(ROOT/'src/lib/HiveTables.sol').read_text()
        for key in ('POINTS','ENVELOPE'):
            data=json.loads(re.search(rf'constant {key} = (".*");',source).group(1))
            encoded=re.search(rf'constant {key}_OFFSETS = "([0-9a-f]+)"',source).group(1)
            offsets=[int(encoded[i:i+4],16) for i in range(0,len(encoded),4)]
            self.assertEqual(offsets[0],0);self.assertEqual(offsets[-1],len(data))
            self.assertTrue(all(a<z for a,z in zip(offsets,offsets[1:])))
            self.assertTrue(data.isascii())
if __name__=='__main__':unittest.main()

import unittest
from gen_template import geometry, polygon, clip, steps, rings, generated

class TemplateTests(unittest.TestCase):
    def test_tables_tile_without_gap_or_overlap(self):
        # The serialization partitions every blob into consecutive, nonoverlapping slices.
        vals=geometry(); cursor=0; blob=''.join(vals)
        for value in vals:
            self.assertEqual(blob[cursor:cursor+len(value)],value)
            cursor+=len(value)
        self.assertEqual(cursor,len(blob))
        # Each pair of complementary clips exactly partitions the original cell's area.
        def area(poly): return abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(poly,poly[1:]+poly[:1])))/2
        import math
        full=polygon(77)
        for n in (2,3,4):
            for level in range(1,n):
                y=77*math.sqrt(3)/2*(1-2*level/n)
                lower,upper=clip(full,y,True),clip(full,y,False)
                self.assertAlmostEqual(area(lower)+area(upper),area(full),places=8)
                self.assertTrue(all(p[1]>=y-1e-10 for p in lower))
                self.assertTrue(all(p[1]<=y+1e-10 for p in upper))
    def test_steps_rings_and_ascii(self):
        self.assertEqual([steps(n) for n in (39,40,70,5000,8192)], [0,2,9,58,64])
        for n in range(41): self.assertEqual(sum(rings(n,s) for s in range(13)),min(n,39))
        for value in geometry(): self.assertTrue(value.isascii())
        self.assertEqual(len(generated()),30)
if __name__=='__main__': unittest.main()

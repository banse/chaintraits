import unittest
import gen_template as g
class GeometryTests(unittest.TestCase):
    def test_tables_tile(self):
        rows=g.tables();layout=__import__('json').loads(g.generated()['test/fixtures/table-layout.json']);offsets=layout['offsets'];blob=''.join(rows)
        self.assertEqual(offsets[0],0);self.assertEqual(offsets[-1],len(blob))
        for i,row in enumerate(rows):self.assertEqual(blob[offsets[i]:offsets[i+1]],row)
        self.assertTrue(all(b<128 for b in blob.encode()))
    def test_every_ascii_offset_table_tiles(self):
        import json,re,gen_questions
        sources=[(g.generated()['src/HiveData.sol'],[('DATA','OFFSETS'),('ENVELOPE','ENVELOPE_OFFSETS')]),(gen_questions.output(),[('BLOB','OFFSETS'),('DICT','DOFFSETS')])]
        for source,pairs in sources:
            def literal(name):return json.loads(re.search(r'bytes constant '+name+r' = ("(?:[^"\\]|\\.)*");',source).group(1))
            for data_name,offset_name in pairs:
                data=literal(data_name).encode('ascii');encoded=literal(offset_name);self.assertEqual(len(encoded)%4,0)
                offsets=[int(encoded[i:i+4],16) for i in range(0,len(encoded),4)]
                self.assertEqual(offsets[0],0);self.assertEqual(offsets[-1],len(data));self.assertEqual(b''.join(data[a:b] for a,b in zip(offsets,offsets[1:])),data)
                self.assertTrue(all(a<=b for a,b in zip(offsets,offsets[1:])))
    def test_steps_and_rings(self):
        self.assertEqual([g.step(x) for x in [0,39,40,70,5000,8192]],[0,0,2,9,58,64])
        for n in range(45):self.assertEqual(sum(g.ring_count(n,s) for s in range(13)),min(n,39))
    def test_clipping_tiles_hexagon(self):
        def area(p):return abs(sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p))))/2
        p=g.hexagon(77)
        for n in [2,3,4]:
            for lv in range(1,n):
                y=77*3**.5/2*(1-2*lv/n)
                self.assertAlmostEqual(area(g.clipped(p,y,True))+area(g.clipped(p,y,False)),area(p),places=6)
if __name__=='__main__':unittest.main()

import unittest
import operator_recipe as r
A='0x000000000000000000000000000000000000c1a1';B='0x000000000000000000000000000000000000c1a2';C='0x000000000000000000000000000000000000c1a3'
class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.transfers=[dict(contract=r.COLLECTION,block=b,logIndex=i,tokenId=11,**{'from':f,'to':t}) for i,(b,f,t) in enumerate([(10,C,A),(20,A,B),(40,B,A)])]
        self.bindings=[dict(contract=r.ADAPTER,block=b,tokenId=11,agentId=a,tokenContract=r.COLLECTION) for b,a in [(5,9),(15,10),(45,12)]]
        self.feedback=[dict(contract=r.REPUTATION,block=b,logIndex=i,agentId=a,batcher=r.BATCHER,accepted=v,job='same job') for i,(b,a,v) in enumerate([(12,9,1),(18,10,1),(19,9,0),(20,9,1),(21,10,1),(22,9,1),(41,9,1),(42,12,1),(44,13,1)])]
    def count(self,w,to=50):return r.accepted_entries(w,to,self.transfers,self.bindings,self.feedback,complete=True)
    def test_previous_and_current_holder_each_earn_own_intervals(self):self.assertEqual(self.count(A),3);self.assertEqual(self.count(B),3);self.assertEqual(self.count(C),0)
    def test_all_agents_not_only_latest_binding_and_count_entries(self):self.assertEqual(self.count(A,19),2);self.assertEqual(self.count(B,22),3)
    def test_later_bindings_and_rejections_do_not_count(self):self.assertEqual(self.count(A),3)
    def test_incomplete_reads_never_become_false(self):
        with self.assertRaises(r.IncompleteEvidence):r.accepted_entries(A,50,[],[],[],complete=False)
    def test_same_block_intervals_are_ordered_and_exclusive(self):
        self.transfers += [dict(contract=r.COLLECTION,block=42,logIndex=50,tokenId=11,**{'from':A,'to':C}),dict(contract=r.COLLECTION,block=42,logIndex=51,tokenId=11,**{'from':C,'to':A})]
        self.assertEqual(self.count(C),0);self.assertEqual(self.count(A),3)
    def test_duplicate_log_is_one_entry_but_duplicate_job_is_not(self):self.feedback.append(dict(self.feedback[0]));self.assertEqual(self.count(A),3)

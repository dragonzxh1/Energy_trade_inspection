from __future__ import annotations

import unittest

from intelligence.market_pipeline.section_granularity import plan_section_merges


class SectionGranularityTest(unittest.TestCase):
    def test_merges_adjacent_same_page_title_short_sections(self):
        rows=[
            {"id":"1","source_document_id":"A","section_index":0,"section_title":"Gasoline","page_start":1,"section_text":"a"*100},
            {"id":"2","source_document_id":"A","section_index":1,"section_title":"Gasoline","page_start":1,"section_text":"b"*200},
        ]
        groups=plan_section_merges(rows)
        self.assertEqual(groups[0].member_ids,["1","2"])

    def test_does_not_merge_across_page_title_or_document(self):
        rows=[
            {"id":"1","source_document_id":"A","section_index":0,"section_title":"Gasoline","page_start":1,"section_text":"a"*100},
            {"id":"2","source_document_id":"A","section_index":1,"section_title":"Diesel","page_start":1,"section_text":"b"*100},
            {"id":"3","source_document_id":"B","section_index":2,"section_title":"Diesel","page_start":1,"section_text":"c"*100},
        ]
        self.assertEqual(plan_section_merges(rows),[])

    def test_respects_maximum_merged_length(self):
        rows=[
            {"id":"1","source_document_id":"A","section_index":0,"section_title":"LNG","page_start":1,"section_text":"a"*170},
            {"id":"2","source_document_id":"A","section_index":1,"section_title":"LNG","page_start":1,"section_text":"b"*2990},
        ]
        self.assertEqual(plan_section_merges(rows),[])


if __name__=="__main__": unittest.main()

from __future__ import annotations

import unittest
from unittest.mock import Mock,patch

from intelligence.market_pipeline.dify_knowledge_sync import _document_payload,sync_commodity_cards


class DifyKnowledgeSyncTest(unittest.TestCase):
    def test_payload_uses_economy_text_index(self):
        payload=_document_payload("naphtha.md","content")
        self.assertEqual(payload["indexing_technique"],"economy")
        self.assertEqual(payload["doc_form"],"text_model")
        self.assertEqual(payload["process_rule"],{"mode":"automatic"})

    @patch("intelligence.market_pipeline.dify_knowledge_sync.httpx.post")
    @patch("intelligence.market_pipeline.dify_knowledge_sync.httpx.get")
    def test_sync_updates_existing_and_creates_missing(self,get,post):
        get_response=Mock(); get_response.json.return_value={"data":[{"name":"naphtha.md","id":"doc-1"}]}; get.return_value=get_response
        post.return_value=Mock()
        result=sync_commodity_cards("http://dify","dataset-key","dataset-1")
        self.assertEqual(result["total"],10)
        self.assertEqual(result["updated"],1)
        self.assertEqual(result["created"],9)
        self.assertEqual(result["document_ids"],{"naphtha.md":"doc-1"})
        self.assertEqual(post.call_count,10)
        urls=[call.args[0] for call in post.call_args_list]
        self.assertTrue(any("doc-1/update-by-text" in url for url in urls))


if __name__=="__main__": unittest.main()

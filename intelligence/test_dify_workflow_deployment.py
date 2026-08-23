from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "deploy_dify_workflows_v2.py"
sys.modules.setdefault("psycopg2", types.SimpleNamespace())
SPEC = importlib.util.spec_from_file_location("deploy_dify_workflows_v2", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DifyWorkflowDeploymentTests(unittest.TestCase):
    @staticmethod
    def _simple_graph(*, review: bool = False) -> dict:
        variables = []
        if review:
            variables = [
                {"variable": "mode"}, {"variable": "date"},
                {"variable": "report_markdown"}, {"variable": "extractions"},
                {"variable": "previous_review"},
            ]
        return {
            "nodes": [
                {"id": "start", "data": {"type": "start", "variables": variables}},
                {
                    "id": "llm",
                    "data": {
                        "type": "llm", "model": {"name": "old", "completion_params": {}},
                        "prompt_template": [{"text": "unchanged"}],
                    },
                },
                {"id": "end", "data": {"type": "end", "outputs": []}},
            ],
            "edges": [],
        }

    def test_extract_disables_thinking_and_requires_json(self) -> None:
        graph = {
            "nodes": [
                {"id": "start", "data": {"type": "start"}},
                {
                    "id": "llm",
                    "data": {
                        "type": "llm",
                        "model": {"completion_params": {}},
                        "prompt_template": [{"text": "unchanged"}],
                    },
                },
                {"id": "code", "data": {"type": "code", "code": ""}},
                {"id": "end", "data": {"type": "end", "outputs": []}},
            ],
            "edges": [],
        }

        patched = MODULE.patch_extract(graph)
        model = MODULE.nodes_by_type(patched)["llm"]["data"]["model"]

        self.assertEqual(
            model["completion_params"],
            {
                "max_tokens": 6000,
                "temperature": 0,
                "thinking": False,
                "response_format": "json_object",
            },
        )

    def test_writer_uses_story_brief_prompt_and_publication_temperature(self) -> None:
        patched = MODULE.patch_writer(self._simple_graph())
        llm = MODULE.nodes_by_type(patched)["llm"]["data"]
        self.assertEqual(llm["model"]["completion_params"]["temperature"], 0.4)
        self.assertFalse(llm["model"]["completion_params"]["thinking"])
        self.assertIn("StoryBrief", llm["prompt_template"][0]["text"])
        self.assertIn("不强制使用固定栏目", llm["prompt_template"][0]["text"])

    def test_review_uses_flash_and_semantic_coverage(self) -> None:
        with patch.dict("os.environ", {"DIFY_FLASH_MODEL_NAME": "deepseek-flash-test"}):
            patched = MODULE.patch_review(self._simple_graph(review=True))
        llm = MODULE.nodes_by_type(patched)["llm"]["data"]
        self.assertEqual(llm["model"]["name"], "deepseek-flash-test")
        self.assertFalse(llm["model"]["completion_params"]["thinking"])
        self.assertIn("语义覆盖", llm["prompt_template"][0]["text"])
        self.assertNotIn("required_sections", llm["prompt_template"][0]["text"])

    def test_review_revision_salvages_markdown_with_unescaped_quotes(self) -> None:
        namespace: dict[str, object] = {}
        exec(MODULE.REVIEW_CODE, namespace)
        malformed = '{"revised_markdown":"# 标题\n\n他说："中断不可避免"。\n\n## 参考资料\n- WSJ"}'

        result = namespace["main"](malformed, "revise")

        self.assertIn('他说："中断不可避免"。', result["revised_markdown"])
        self.assertTrue(result["revised_markdown"].endswith("- WSJ"))


if __name__ == "__main__":
    unittest.main()

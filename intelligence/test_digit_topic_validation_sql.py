from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]


def _compact_sql(path: Path) -> str:
    return " ".join(path.read_text(encoding="utf-8").lower().split())


def _success_ids_satisfy_contract(
    publication_status: str,
    media_id: str | None,
    publish_id: str | None,
) -> bool:
    if publication_status == "draft_created":
        return bool(media_id and media_id.strip())
    if publication_status == "published":
        return bool(publish_id and publish_id.strip())
    return True


class DigitTopicValidationSqlTests(unittest.TestCase):
    def test_validation_rejects_empty_or_whitespace_only_success_ids(self) -> None:
        validation_sql = _compact_sql(
            ROOT / "db" / "validation" / "058_digit_topic_publications.sql"
        )

        self.assertIn(
            "publication_status = 'draft_created' "
            "and nullif(btrim(media_id), '') is null",
            validation_sql,
        )
        self.assertIn(
            "publication_status = 'published' "
            "and nullif(btrim(publish_id), '') is null",
            validation_sql,
        )
        self.assertNotIn("nullif(media_id, '') is null", validation_sql)
        self.assertNotIn("nullif(publish_id, '') is null", validation_sql)

    def test_migration_enforces_status_specific_nonblank_ids(self) -> None:
        migration_sql = _compact_sql(
            ROOT / "db" / "migrations" / "058_digit_topic_publications.sql"
        )

        self.assertIn(
            "check ( publication_status <> 'draft_created' "
            "or nullif(btrim(media_id), '') is not null )",
            migration_sql,
        )
        self.assertIn(
            "check ( publication_status <> 'published' "
            "or nullif(btrim(publish_id), '') is not null )",
            migration_sql,
        )

    def test_status_specific_id_fixture_semantics(self) -> None:
        invalid_ids = (None, "", "   ")
        valid_ids = ("MEDIA-1", "  MEDIA-1  ")

        for media_id in invalid_ids:
            with self.subTest(status="draft_created", media_id=media_id):
                self.assertFalse(
                    _success_ids_satisfy_contract("draft_created", media_id, None)
                )
        for media_id in valid_ids:
            with self.subTest(status="draft_created", media_id=media_id):
                self.assertTrue(
                    _success_ids_satisfy_contract("draft_created", media_id, None)
                )

        for publish_id in invalid_ids:
            with self.subTest(status="published", publish_id=publish_id):
                self.assertFalse(
                    _success_ids_satisfy_contract("published", None, publish_id)
                )
        for publish_id in valid_ids:
            with self.subTest(status="published", publish_id=publish_id):
                self.assertTrue(
                    _success_ids_satisfy_contract("published", None, publish_id)
                )

        for publication_status in (
            "generation_failed",
            "review_rejected",
            "shadow_saved",
            "publish_failed",
        ):
            with self.subTest(status=publication_status):
                self.assertTrue(
                    _success_ids_satisfy_contract(publication_status, None, None)
                )


if __name__ == "__main__":
    unittest.main()

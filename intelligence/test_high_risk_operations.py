from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]


class HighRiskOperationsTests(unittest.TestCase):
    def test_sanctions_runner_has_nonblocking_process_lock(self) -> None:
        runner = (ROOT / "scripts" / "cron-runner.sh").read_text(encoding="utf-8")

        self.assertIn("exec 13>/tmp/eti-sync-sanctions.lock", runner)
        self.assertIn("flock -xn 13", runner)
        self.assertIn("sync-sanctions skipped: lock busy", runner)

    def test_sanctions_sync_has_database_lock_and_unique_workspaces(self) -> None:
        sync = (ROOT / "scripts" / "sync-opensanctions.mjs").read_text(encoding="utf-8")

        self.assertIn("pg_try_advisory_lock", sync)
        self.assertIn("pg_advisory_unlock", sync)
        self.assertIn("sanctions_staging_${process.pid}_${Date.now()}", sync)
        self.assertIn("fs.mkdtempSync", sync)
        self.assertNotIn("const TEMP_FILE", sync)
        self.assertNotIn("CREATE TABLE sanctions_staging (", sync)

    def test_sanctions_psql_does_not_receive_database_url_in_argv(self) -> None:
        sync = (ROOT / "scripts" / "sync-opensanctions.mjs").read_text(encoding="utf-8")

        self.assertIn("PGPASSWORD: password", sync)
        self.assertIn("delete env.DATABASE_URL", sync)
        self.assertIn("execFileSync(PSQL, ['-v', 'ON_ERROR_STOP=1', '-c', sql]", sync)
        self.assertNotIn("execFileSync(PSQL, [dbUrl", sync)
        self.assertNotIn("eti_password", sync)

    def test_database_backup_is_locked_and_restore_verified(self) -> None:
        backup = (ROOT / "scripts" / "backup-database.sh").read_text(encoding="utf-8")

        self.assertIn("flock -n 9", backup)
        self.assertIn("pg_restore --list", backup)
        self.assertIn("sha256sum --check SHA256SUMS", backup)
        self.assertIn("unset DATABASE_URL", backup)
        self.assertIn("unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE", backup)
        self.assertIn("offsite=not_configured", backup)
        self.assertNotIn("rm -rf", backup)
        self.assertNotIn('pg_dump "$DATABASE_URL"', backup)
        self.assertNotIn('python3 - "$DATABASE_URL"', backup)

    def test_database_backup_timer_is_persistent_and_reports_failures(self) -> None:
        service = (ROOT / "deploy" / "systemd" / "eti-database-backup.service").read_text(encoding="utf-8")
        timer = (ROOT / "deploy" / "systemd" / "eti-database-backup.timer").read_text(encoding="utf-8")
        installer = (ROOT / "scripts" / "install-database-backup.sh").read_text(encoding="utf-8")

        self.assertIn("OnFailure=eti-database-backup-failure.service", service)
        self.assertIn("ProtectSystem=strict", service)
        self.assertIn("Persistent=true", timer)
        self.assertIn("Asia/Singapore", timer)
        self.assertIn("/usr/local/lib/eti-backup/backup-database.sh", installer)
        self.assertIn("-o root -g root -m 0755", installer)


if __name__ == "__main__":
    unittest.main()

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

    def test_runtime_manifest_mounts_wechat_config_only_after_build(self) -> None:
        manifest = (ROOT / "deploy" / "runtime-resources.tsv").read_text(encoding="utf-8")
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")

        self.assertIn(
            "post-build\tfile\t600\tubuntu:ubuntu\t.env.local"
            "\t/var/www/eti/shared/.env.local\tenv",
            manifest,
        )
        self.assertIn(
            "post-build\tfile\t600\tubuntu:ubuntu\t.env.web-research-agent"
            "\t/var/www/eti/shared/.env.web-research-agent\tenv",
            manifest,
        )
        self.assertNotIn("pre-build\tfile\t600\tubuntu:ubuntu\t.env", manifest)
        self.assertIn(
            "post-build\tfile\t600\tubuntu:ubuntu\tintelligence/wechat_publish.json"
            "\t/var/www/eti/shared/wechat_publish.json\tjson:appsecret",
            manifest,
        )
        self.assertIn("intelligence/wechat_publish.json", gitignore.splitlines())
        self.assertNotIn("WECHAT_MP_APP_SECRET=", manifest)

    def test_web_agent_uses_minimal_environment_file(self) -> None:
        unit = (ROOT / "deploy" / "systemd" / "eti-web-research-agent.service").read_text(
            encoding="utf-8"
        )
        installer = (ROOT / "scripts" / "install-web-research-agent.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("EnvironmentFile=/var/www/eti/Energy_trade_inspection/.env.web-research-agent", unit)
        self.assertNotIn("EnvironmentFile=/var/www/eti/Energy_trade_inspection/.env.local", unit)
        self.assertIn('ENV_FILE="$REPO_ROOT/.env.web-research-agent"', installer)
        self.assertNotIn('grep -qE \'^FIRECRAWL_API_KEY=.+$\' "$REPO_ROOT/.env.local"', installer)

    def test_runtime_installer_links_without_reading_or_copying_secrets(self) -> None:
        installer = (ROOT / "scripts" / "install-runtime-resources.sh").read_text(encoding="utf-8")

        self.assertIn('ln -s "$SOURCE_REAL" "$DESTINATION_PATH"', installer)
        self.assertIn("Refusing to overwrite non-symlink", installer)
        self.assertIn('"$SHARED_REAL"/*', installer)
        self.assertNotIn('cat "$SOURCE_REAL"', installer)
        self.assertNotIn('cp "$SOURCE_REAL"', installer)

    def test_runtime_verifier_scans_build_logs_and_process_arguments(self) -> None:
        verifier = (ROOT / "scripts" / "verify-runtime-resources.py").read_text(encoding="utf-8")

        self.assertIn('"git_tracked": git_tracked_files(release)', verifier)
        self.assertIn('"next_build": [build]', verifier)
        self.assertIn('scopes["web_agent_build"]', verifier)
        self.assertIn('scopes["historical_next_builds"]', verifier)
        self.assertIn('scopes["historical_web_agent_builds"]', verifier)
        self.assertIn('scopes["logs"]', verifier)
        self.assertIn('["ps", "-eo", "args="]', verifier)
        self.assertIn("verify_backup_secret_permissions", verifier)
        self.assertIn("labels=", verifier)
        self.assertNotIn("print(value)", verifier)

    def test_production_build_uses_only_isolated_placeholders(self) -> None:
        build = (ROOT / "scripts" / "build-production-release.sh").read_text(encoding="utf-8")

        self.assertIn("env -i", build)
        self.assertIn("Refusing credential-isolated build", build)
        self.assertIn("postgresql://build:build@127.0.0.1:1/build", build)
        self.assertIn("sk_test_build_only_not_a_real_key_000000", build)
        self.assertIn('find "$CACHE_PATH" -depth -delete', build)
        self.assertNotIn("source .env", build)
        self.assertNotIn("/var/www/eti/shared/.env", build)

    def test_legacy_deploy_entrypoint_cannot_build_active_release(self) -> None:
        deploy = (ROOT / "scripts" / "deploy.sh").read_text(encoding="utf-8")

        self.assertIn("Refusing in-place deployment of the active production release", deploy)
        self.assertIn("bash scripts/build-production-release.sh", deploy)
        self.assertIn("npm test --prefix web-research-agent", deploy)
        self.assertIn("bash scripts/install-runtime-resources.sh --phase post-build", deploy)
        self.assertIn("python3 scripts/verify-runtime-resources.py", deploy)
        self.assertNotIn("git pull", deploy)
        self.assertNotIn("npm run build\n", deploy)


if __name__ == "__main__":
    unittest.main()

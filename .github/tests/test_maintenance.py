import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from datetime import datetime, timedelta, timezone


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / '.github/workflows/watchlist.yml').read_text()
MAINTENANCE_STEP = WORKFLOW.split('      - name: Update automated maintenance date\n')[1]
SCRIPT = textwrap.dedent(MAINTENANCE_STEP.split('        run: |\n')[1])
MARKER = '**Last successful automated update:** '


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.remote = self.directory / 'remote.git'
        self.checkout = self.directory / 'checkout'
        self.branch = 'custom-default'
        self.today = datetime.now(timezone.utc).date()
        self.environment = {
            **os.environ,
            'GIT_CONFIG_GLOBAL': os.devnull,
            'GIT_CONFIG_NOSYSTEM': '1',
            'DEFAULT_BRANCH': self.branch,
            'TZ': 'Pacific/Honolulu'
        }
        self.git('init', '--bare', f'--initial-branch={self.branch}', str(self.remote))
        self.git('clone', str(self.remote), str(self.checkout))
        self.git('config', 'user.name', 'Test Author', cwd=self.checkout)
        self.git('config', 'user.email', 'test@example.com', cwd=self.checkout)

    def git(self, *arguments, cwd=None):
        return subprocess.run(
            ['git', *arguments], cwd=cwd or self.directory, env=self.environment,
            check=True, text=True, capture_output=True
        ).stdout.strip()

    def seed(self, age=0, content=None):
        self.original = content if content is not None else (
            '# Runner\n\n' + MARKER + str(self.today - timedelta(days=age))
            + '\n\nAnother date: 2000-01-01\n'
        )
        (self.checkout / 'README.md').write_text(self.original)
        self.git('add', 'README.md', cwd=self.checkout)
        self.git('commit', '-m', 'test: seed repository', cwd=self.checkout)
        self.git('push', 'origin', self.branch, cwd=self.checkout)
        self.initial_commit = self.git('rev-parse', 'HEAD', cwd=self.checkout)

    def maintain(self, checkout=None, succeeds=True):
        result = subprocess.run(
            ['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', SCRIPT],
            cwd=checkout or self.checkout, env=self.environment, text=True, capture_output=True
        )
        self.assertEqual(result.returncode == 0, succeeds, result.stdout + result.stderr)
        return result

    def assert_unchanged(self):
        self.assertEqual((self.checkout / 'README.md').read_text(), self.original)
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.checkout), self.initial_commit)
        self.assertEqual(self.git('status', '--porcelain', cwd=self.checkout), '')

    def test_recent_date_does_not_modify_or_commit(self):
        self.seed(age=29)
        self.maintain()
        self.assert_unchanged()

    def test_thirty_days_updates_only_date_and_pushes_one_bot_commit(self):
        self.seed(age=30)
        self.maintain()
        expected = self.original.replace(
            MARKER + str(self.today - timedelta(days=30)), MARKER + str(self.today)
        )
        self.assertEqual((self.checkout / 'README.md').read_text(), expected)
        self.assertEqual(self.git('rev-list', '--count', 'HEAD', cwd=self.checkout), '2')
        self.assertEqual(self.git('diff', '--name-only', 'HEAD~', 'HEAD', cwd=self.checkout), 'README.md')
        self.assertEqual(self.git('log', '-1', '--format=%an <%ae>', cwd=self.checkout),
                         'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>')
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.checkout),
                         self.git('rev-parse', f'refs/heads/{self.branch}', cwd=self.remote))
        self.maintain()
        self.assertEqual(self.git('rev-list', '--count', 'HEAD', cwd=self.checkout), '2')
        self.assertEqual(self.git('status', '--porcelain', cwd=self.checkout), '')

    def test_overdue_date_updates(self):
        self.seed(age=65)
        self.maintain()
        self.assertIn(MARKER + str(self.today), (self.checkout / 'README.md').read_text())

    def test_future_date_does_not_modify_or_commit(self):
        self.seed(age=-1)
        self.maintain()
        self.assert_unchanged()

    def test_invalid_date_fails_without_changes(self):
        self.seed(content=MARKER + '2026-02-30\n')
        self.maintain(succeeds=False)
        self.assert_unchanged()

    def test_missing_marker_fails_without_changes(self):
        self.seed(content='# README without maintenance date\n')
        self.maintain(succeeds=False)
        self.assert_unchanged()

    def test_duplicate_marker_fails_without_changes(self):
        self.seed(content=(MARKER + '2000-01-01\n') * 2)
        self.maintain(succeeds=False)
        self.assert_unchanged()

    def test_stale_shallow_checkout_reads_remote_date_before_committing(self):
        self.seed(age=30)
        stale = self.directory / 'stale'
        self.git('clone', '--depth=1', self.remote.as_uri(), str(stale))
        self.maintain()
        self.maintain(checkout=stale)
        self.assertEqual(self.git('rev-list', '--count', 'HEAD', cwd=stale), '2')
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=stale),
                         self.git('rev-parse', 'HEAD', cwd=self.checkout))

    def test_failed_or_manual_work_is_excluded_by_workflow_guard(self):
        self.assertIn(
            "if: ${{ success() && github.event_name == 'schedule' && steps.watchlist.outcome == 'success' }}",
            MAINTENANCE_STEP
        )
        self.assertIn('id: watchlist\n', WORKFLOW)
        self.assertNotIn('continue-on-error:', WORKFLOW)


if __name__ == '__main__':
    unittest.main()

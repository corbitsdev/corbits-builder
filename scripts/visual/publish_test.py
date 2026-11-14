import copy
import io
import unittest
import zipfile
from unittest.mock import patch, mock_open

import publish


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.run = {"id": 10, "run_attempt": 1, "head_sha": "b" * 40,
                    "head_repository": {"id": 2}, "conclusion": "success"}
        self.pr = {"number": 3, "state": "open", "base": {"sha": "a" * 40, "repo": {"full_name": "owner/repo"}},
                   "head": {"sha": "b" * 40, "repo": {"id": 2}}}
        self.report = {"base": "a" * 40, "head": "b" * 40, "seconds": 12, "pairs": [
            {"id": "story--one", "variant": variant, "status": "unchanged", "pixels": 0,
             "before": f"before/story--one-{variant}.png", "after": f"after/story--one-{variant}.png", "diff": None}
            for variant in sorted(publish.VARIANTS)]}

    def test_same_repository_and_fork_origins_are_bound_to_head_repository(self):
        self.assertTrue(publish.current_pr(self.run, self.pr, "owner/repo"))
        self.pr["head"]["repo"]["id"] = 1
        self.assertFalse(publish.current_pr(self.run, self.pr, "owner/repo"))
        self.run["head_repository"]["id"] = 1
        self.assertTrue(publish.current_pr(self.run, self.pr, "owner/repo"))
        self.pr["head"]["sha"] = "c" * 40
        self.assertFalse(publish.current_pr(self.run, self.pr, "owner/repo"))

    def test_report_rejects_other_commits_paths_mentions_and_missing_variants(self):
        publish.validate_report(self.report, self.pr["base"]["sha"], self.pr["head"]["sha"])
        for field, value in [("id", "@everyone"), ("before", "../../secret"), ("status", "unknown"), ("pixels", -1)]:
            report = copy.deepcopy(self.report)
            report["pairs"][0][field] = value
            with self.assertRaises(ValueError):
                publish.validate_report(report, self.pr["base"]["sha"], self.pr["head"]["sha"])
        with self.assertRaises(ValueError):
            publish.validate_report(self.report, "c" * 40, self.pr["head"]["sha"])
        self.report["pairs"].pop()
        with self.assertRaises(ValueError):
            publish.validate_report(self.report, self.pr["base"]["sha"], self.pr["head"]["sha"])

    def test_one_marked_bot_comment_is_updated_and_stale_runs_are_rejected(self):
        comment = {"id": 5, "user": {"login": "github-actions[bot]", "type": "Bot"},
                   "body": publish.MARKER + "\n<!-- visual-run:10:1 -->"}
        self.assertIsNone(publish.existing_comment([], self.run))
        self.assertEqual(publish.existing_comment([comment], self.run)["id"], 5)
        self.run["run_attempt"] = 2
        self.assertEqual(publish.existing_comment([comment], self.run)["id"], 5)
        self.run["id"] = 9
        with self.assertRaises(ValueError):
            publish.existing_comment([comment], self.run)
        comment["user"]["login"] = "contributor"
        self.assertIsNone(publish.existing_comment([comment], self.run))

    def test_summary_links_artifacts_without_unchanged_images(self):
        body = publish.comment_body(self.run, self.pr, {"id": 42}, self.report, "owner/repo")
        self.assertIn("/actions/runs/10/artifacts/42", body)
        self.assertIn("4 unchanged", body)
        self.assertNotIn("![", body)
        self.assertNotIn("story--one", body)

    def test_zip_reads_only_bounded_json_without_extracting_files(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("report.json", '{"hello": "world"}')
            archive.writestr("../../publish.py", "raise RuntimeError('untrusted')")
        with patch("zipfile.ZipFile.extractall", side_effect=AssertionError("must not extract")):
            self.assertEqual(publish.read_report(stream.getvalue()), {"hello": "world"})
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("report.json", "x" * (1024 * 1024 + 1))
        with self.assertRaises(ValueError):
            publish.read_report(stream.getvalue())

    def test_publisher_upserts_across_pushes_and_skips_superseded_heads(self):
        import json
        self.run.update(repository={"full_name": "owner/repo"}, workflow_id=7,
                        path=publish.WORKFLOW, event="pull_request", status="completed")
        artifact = {"id": 42, "name": publish.ARTIFACT, "expired": False,
                    "size_in_bytes": 100, "workflow_run": {"id": 10, "head_sha": "b" * 40}}
        comments = []
        writes = []

        def fake_api(path, method="GET", body=None):
            if method != "GET":
                writes.append((path, method))
                comment = {"id": 99, "body": body["body"], "user": {"login": "github-actions[bot]", "type": "Bot"}}
                comments[:] = [comment]
                return comment
            if path == "repos/owner/repo/actions/workflows/visual.yml":
                return {"id": 7}
            if path == f"repos/owner/repo/actions/runs/{self.run['id']}":
                return self.run
            if path == "repos/owner/repo/pulls/3":
                return self.pr
            raise AssertionError(path)

        def fake_pages(path, field=None):
            if "/commits/" in path:
                return [self.pr]
            if "/actions/workflows/" in path:
                return [self.run]
            if path.endswith("/artifacts"):
                return [artifact]
            if path.endswith("/comments"):
                return comments
            raise AssertionError(path)

        def invoke():
            event = json.dumps({"workflow_run": {"id": self.run["id"], "run_attempt": 1}})
            with patch.dict("os.environ", {"GITHUB_REPOSITORY": "owner/repo", "GITHUB_EVENT_PATH": "event.json"}), patch("builtins.open", mock_open(read_data=event)), patch.object(publish, "api", side_effect=fake_api), patch.object(publish, "pages", side_effect=fake_pages), patch.object(publish.subprocess, "run") as download, patch.object(publish, "read_report", return_value=self.report):
                download.return_value.stdout = b"archive"
                publish.main()

        invoke()
        self.assertEqual(writes[-1], ("repos/owner/repo/issues/3/comments", "POST"))
        self.run["id"] = 11
        artifact["workflow_run"]["id"] = 11
        invoke()
        self.assertEqual(writes[-1], ("repos/owner/repo/issues/comments/99", "PATCH"))
        self.assertEqual(len(comments), 1)
        self.pr["head"]["sha"] = "c" * 40
        invoke()
        self.assertEqual(len(writes), 2)
        self.pr["head"]["sha"] = "b" * 40
        self.run["path"] = ".github/workflows/unrelated.yml"
        with self.assertRaises(ValueError):
            invoke()
        self.assertEqual(len(writes), 2)


if __name__ == "__main__":
    unittest.main()

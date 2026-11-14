"""Publish only validated report data; never extract or execute PR artifacts."""

import io
import json
import math
import os
import re
import subprocess
import zipfile

MARKER = "<!-- builder-visual-evidence -->"
WORKFLOW = ".github/workflows/visual.yml"
ARTIFACT = "ui-visual-evidence"
LIMIT = 100 * 1024 * 1024
VARIANTS = {"desktop-light", "desktop-dark", "mobile-light", "mobile-dark"}


def api(path, method="GET", body=None):
    args = ["gh", "api", path, "--method", method]
    if body is not None:
        args.extend(["--input", "-"])
    result = subprocess.run(
        args, input=None if body is None else json.dumps(body).encode(),
        stdout=subprocess.PIPE, check=True,
    )
    return json.loads(result.stdout)


def pages(path, field=None):
    result = []
    for page in range(1, 101):
        separator = "&" if "?" in path else "?"
        value = api(f"{path}{separator}per_page=100&page={page}")
        items = value[field] if field else value
        result.extend(items)
        if len(items) < 100:
            return result
    raise ValueError("Pagination limit exceeded")


def read_report(archive):
    with zipfile.ZipFile(io.BytesIO(archive)) as files:
        names = files.namelist()
        if names.count("report.json") != 1:
            raise ValueError("Expected exactly one report.json")
        info = files.getinfo("report.json")
        if info.file_size > 1024 * 1024:
            raise ValueError("Report too large")
        return json.loads(files.read(info))


def validate_report(report, base, head):
    if report["base"] != base or report["head"] != head:
        raise ValueError("Report does not match current PR commits")
    seconds = report["seconds"]
    if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 <= seconds <= 3600:
        raise ValueError("Invalid duration")
    pairs = report["pairs"]
    if not isinstance(pairs, list) or not 1 <= len(pairs) <= 2000:
        raise ValueError("Invalid capture count")
    seen = set()
    for pair in pairs:
        story, variant, status = pair["id"], pair["variant"], pair["status"]
        if not isinstance(story, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,199}", story):
            raise ValueError("Invalid story ID")
        if variant not in VARIANTS or status not in {"changed", "unchanged", "added", "removed"}:
            raise ValueError("Invalid variant or status")
        if (story, variant) in seen:
            raise ValueError("Duplicate capture")
        seen.add((story, variant))
        if type(pair["pixels"]) is not int or pair["pixels"] < 0:
            raise ValueError("Invalid pixel count")
        for side in ("before", "after", "diff"):
            expected = f"{side}/{story}-{variant}.png"
            required = side == "before" and status != "added" or side == "after" and status != "removed" or side == "diff" and status == "changed"
            if pair[side] != (expected if required else None):
                raise ValueError("Invalid capture path")
    for story, _ in seen:
        if {variant for name, variant in seen if name == story} != VARIANTS:
            raise ValueError("Missing viewport/theme combination")
    return pairs


def current_pr(run, pr, repository):
    return (
        pr["state"] == "open"
        and pr["base"]["repo"]["full_name"] == repository
        and pr["head"]["sha"] == run["head_sha"]
        and pr["head"]["repo"] is not None
        and pr["head"]["repo"]["id"] == run["head_repository"]["id"]
    )


def comment_body(run, pr, artifact, report, repository):
    url = f"https://github.com/{repository}/actions/runs/{run['id']}"
    lines = [MARKER, f"<!-- visual-run:{run['id']}:{run['run_attempt']} -->", "## UI visual evidence", "",
             f"Base: `{pr['base']['sha']}`", f"Proposed: `{pr['head']['sha']}`", "",
             f"[Capture run]({url}) · Result: **{run['conclusion']}**", ""]
    if artifact:
        lines.extend([f"[Download report and captures]({url}/artifacts/{artifact['id']}) (retained for 30 days).",
                      "Extract the ZIP and open `index.html` for before/after pairs and highlighted differences.", ""])
    if report is None:
        if run["conclusion"] == "success":
            lines.append("No capture artifact was produced; no relevant UI changes were selected.")
        else:
            lines.append("Capture did not complete. Check the run and available build/capture logs; no visual result is claimed.")
    else:
        pairs = report["pairs"]
        counts = {status: sum(pair["status"] == status for pair in pairs) for status in ("changed", "added", "removed", "unchanged")}
        lines.extend([", ".join(f"{count} {status}" for status, count in counts.items()) + " captures.",
                      f"Capture and comparison: {report['seconds']:.1f} seconds. Full job timing is on the run.", "",
                      "Pixel changes are evidence for human review, not an approval gate.", ""])
        changed = [pair for pair in pairs if pair["status"] != "unchanged"]
        for pair in changed[:100]:
            lines.append(f"- `{pair['id']}` / {pair['variant']}: **{pair['status']}**")
        if len(changed) > 100:
            lines.append("Additional changed captures are in the complete report.")
    return "\n".join(lines)


def existing_comment(comments, run):
    matches = [comment for comment in comments if comment["user"]["login"] == "github-actions[bot]" and comment["user"]["type"] == "Bot" and comment["body"].startswith(MARKER)]
    if len(matches) > 1:
        raise ValueError("Multiple visual comments; refusing an ambiguous update")
    if not matches:
        return None
    comment = matches[0]
    previous = re.search(r"<!-- visual-run:(\d+):(\d+) -->", comment["body"])
    if previous and tuple(map(int, previous.groups())) > (run["id"], run["run_attempt"]):
        raise ValueError("A newer run has already published")
    return comment


def main():
    repository = os.environ["GITHUB_REPOSITORY"]
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as file:
        event = json.load(file)
    prefix = f"repos/{repository}"
    run = api(f"{prefix}/actions/runs/{int(event['workflow_run']['id'])}")
    workflow = api(f"{prefix}/actions/workflows/visual.yml")
    if run["repository"]["full_name"] != repository or run["workflow_id"] != workflow["id"] or run["path"] != WORKFLOW or run["event"] != "pull_request" or run["status"] != "completed":
        raise ValueError("Unexpected originating workflow")
    if run["run_attempt"] != event["workflow_run"]["run_attempt"]:
        print("Superseded attempt; skipping")
        return
    if not re.fullmatch(r"[a-f0-9]{40}", run["head_sha"]):
        raise ValueError("Invalid originating SHA")
    # Fork workflow_run payloads can omit pull_requests; the commit association
    # comes from GitHub, never from a PR-supplied artifact or branch name.
    candidates = pages(f"{prefix}/commits/{run['head_sha']}/pulls")
    candidates = [pr for pr in candidates if current_pr(run, pr, repository)]
    if len(candidates) != 1:
        print("No unique current open PR; skipping")
        return
    pr = candidates[0]
    runs = pages(f"{prefix}/actions/workflows/{workflow['id']}/runs?event=pull_request&head_sha={run['head_sha']}", "workflow_runs")
    if any(other["id"] > run["id"] and other["head_repository"]["id"] == run["head_repository"]["id"] for other in runs):
        print("Newer capture run exists; skipping")
        return
    artifacts = pages(f"{prefix}/actions/runs/{run['id']}/artifacts", "artifacts")
    artifacts = [item for item in artifacts if item["name"] == ARTIFACT and not item["expired"]]
    if len(artifacts) > 1:
        raise ValueError("Ambiguous capture artifact")
    artifact = artifacts[0] if artifacts else None
    report = None
    if artifact:
        if artifact["workflow_run"]["id"] != run["id"] or artifact["workflow_run"]["head_sha"] != run["head_sha"] or artifact["size_in_bytes"] > LIMIT:
            raise ValueError("Unexpected artifact provenance or size")
        if run["conclusion"] == "success":
            # gh follows GitHub's signed download redirect; no ZIP content is executed.
            archive = subprocess.run(["gh", "api", f"{prefix}/actions/artifacts/{artifact['id']}/zip"], stdout=subprocess.PIPE, check=True).stdout
            if len(archive) > LIMIT:
                raise ValueError("Archive too large")
            report = read_report(archive)
            validate_report(report, pr["base"]["sha"], pr["head"]["sha"])
    comments = pages(f"{prefix}/issues/{pr['number']}/comments")
    comment = existing_comment(comments, run)
    fresh = api(f"{prefix}/pulls/{pr['number']}")
    if not current_pr(run, fresh, repository) or fresh["base"]["sha"] != pr["base"]["sha"]:
        print("PR changed while preparing report; skipping")
        return
    body = {"body": comment_body(run, pr, artifact, report, repository)}
    if comment:
        api(f"{prefix}/issues/comments/{comment['id']}", "PATCH", body)
    else:
        api(f"{prefix}/issues/{pr['number']}/comments", "POST", body)


if __name__ == "__main__":
    main()
